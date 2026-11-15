import { one, type Db } from '../db.js'
import type { Copy, Suggestion, SuggestionChange } from '../types.js'
import * as versions from './versions.js'

/** Make somebody their own copy of a version. Y1. */
export async function makeCopy(
  db: Db,
  input: { project_id: string; owner: string; from_version_id: string; name?: string },
): Promise<Copy> {
  const row = one(
    await db.query<Copy>(
      `insert into copies (project_id, owner, from_version_id, name)
       values ($1, $2, $3, $4) returning *`,
      [input.project_id, input.owner, input.from_version_id, input.name ?? ''],
    ),
  )
  if (!row) throw new Error('copy insert returned nothing')
  return row
}

export async function copiesOf(db: Db, owner: string): Promise<Copy[]> {
  const { rows } = await db.query<Copy>(
    'select * from copies where owner = $1 order by created_at desc',
    [owner],
  )
  return rows
}

/** Where a copy's own files are, once its owner has kept a change. */
export async function setWorkingZip(db: Db, copyId: string, url: string): Promise<void> {
  await db.query('update copies set working_zip_url = $2 where id = $1', [copyId, url])
}

export async function copyById(db: Db, id: string): Promise<Copy | null> {
  return one(await db.query<Copy>('select * from copies where id = $1', [id]))
}

export interface NewChange {
  title: string
  before_text: string
  after_text: string
}

/** Send a change back. Y3. The changes are rows, because Y2 and Y4 read them. */
export async function offer(
  db: Db,
  input: { copy_id: string; project_id: string; author: string; note: string; changes: NewChange[] },
): Promise<{ suggestion: Suggestion; changes: SuggestionChange[] }> {
  if (input.changes.length === 0) throw new Error('a suggestion needs at least one change')
  return db.tx(async (tx) => {
    const suggestion = one(
      await tx.query<Suggestion>(
        `insert into suggestions (copy_id, project_id, author, note)
         values ($1, $2, $3, $4) returning *`,
        [input.copy_id, input.project_id, input.author, input.note],
      ),
    )
    if (!suggestion) throw new Error('suggestion insert returned nothing')
    const changes: SuggestionChange[] = []
    for (const [i, c] of input.changes.entries()) {
      const row = one(
        await tx.query<SuggestionChange>(
          `insert into suggestion_changes (suggestion_id, position, title, before_text, after_text)
           values ($1, $2, $3, $4, $5) returning *`,
          [suggestion.id, i, c.title, c.before_text, c.after_text],
        ),
      )
      if (row) changes.push(row)
    }
    return { suggestion, changes }
  })
}

export interface SuggestionDetail {
  suggestion: Suggestion
  changes: SuggestionChange[]
  author_name: string
  project_slug: string
}

export async function detail(db: Db, id: string): Promise<SuggestionDetail | null> {
  const suggestion = one(await db.query<Suggestion>('select * from suggestions where id = $1', [id]))
  if (!suggestion) return null
  const changes = (
    await db.query<SuggestionChange>(
      'select * from suggestion_changes where suggestion_id = $1 order by position',
      [id],
    )
  ).rows
  const author = one(
    await db.query<{ name: string }>('select name from users where id = $1', [suggestion.author]),
  )
  const project = one(
    await db.query<{ slug: string }>('select slug from projects where id = $1', [suggestion.project_id]),
  )
  return {
    suggestion,
    changes,
    author_name: author?.name ?? '',
    project_slug: project?.slug ?? '',
  }
}

/** The inbox, M4. Waiting first, newest first. */
export async function waitingFor(db: Db, projectId: string): Promise<SuggestionDetail[]> {
  const { rows } = await db.query<{ id: string }>(
    `select id from suggestions where project_id = $1 and state = 'waiting'
     order by created_at desc`,
    [projectId],
  )
  const out: SuggestionDetail[] = []
  for (const r of rows) {
    const d = await detail(db, r.id)
    if (d) out.push(d)
  }
  return out
}

export async function countWaitingForOwner(db: Db, owner: string): Promise<number> {
  const row = one(
    await db.query<{ n: number }>(
      `select count(*)::int as n from suggestions s
       join projects p on p.id = s.project_id
       where p.owner = $1 and s.state = 'waiting'`,
      [owner],
    ),
  )
  return row?.n ?? 0
}

/**
 * Take a suggestion. Y5. This is the only place a version gets somebody
 * else's name on it, and the two writes happen together or not at all.
 */
export async function take(
  db: Db,
  id: string,
  by: string,
  note: string,
  now = new Date(),
): Promise<{ suggestion: Suggestion; version: Awaited<ReturnType<typeof versions.append>> }> {
  return db.tx(async (tx) => {
    const s = one(
      await tx.query<Suggestion>('select * from suggestions where id = $1 for update', [id]),
    )
    if (!s) throw new Error('no such suggestion')
    if (s.state !== 'waiting') throw new Error(`that suggestion was already ${s.state}`)
    const version = await versions.append(tx, {
      project_id: s.project_id,
      note,
      created_by: by,
      suggested_by: s.author,
    })
    const updated = one(
      await tx.query<Suggestion>(
        `update suggestions set state = 'taken', taken_version_id = $2, decided_at = $3
         where id = $1 returning *`,
        [id, version.id, now.toISOString()],
      ),
    )
    if (!updated) throw new Error('suggestion update returned nothing')
    return { suggestion: updated, version }
  })
}

/** Leave it, kindly. Or, from the other side, pull it back. */
export async function settle(
  db: Db,
  id: string,
  state: 'left' | 'withdrawn',
  now = new Date(),
): Promise<Suggestion | null> {
  return one(
    await db.query<Suggestion>(
      `update suggestions set state = $2, decided_at = $3
       where id = $1 and state = 'waiting' returning *`,
      [id, state, now.toISOString()],
    ),
  )
}

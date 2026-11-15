/**
 * A copy's own version history. It lives in the same `versions` table as a
 * project's history: a row belongs to a project or to a copy, never both.
 *
 * A copy starts as version 1: the code of the project version it was made
 * from. Every change its owner keeps adds a version. Like a project's
 * versions, they are append only: going back adds a new version that points
 * at the old code, so nothing is ever lost.
 */

import { one, type Db } from '../db.js'
import type { Copy } from '../types.js'

export interface CopyVersion {
  id: string
  copy_id: string
  number: number
  note: string
  source_zip_url: string | null
  restored_from: number | null
  created_at: string
}

/** The columns of `versions` that a copy's version shows. */
const COLUMNS = 'id, copy_id, number, note, source_zip_url, restored_from, created_at'

/** A copy with where it came from, for the "Copied from" line. */
export interface CopyDetail {
  copy: Copy
  copied_from: {
    project: { slug: string; name: string }
    maker_name: string
    version_number: number
  }
  /** The copy's newest version, which is the copy as it is now. */
  current: CopyVersion
  versions: number
}

/**
 * Make sure the copy has its version 1, and return it. Version 1 is the
 * code the copy was made from; it is written the first time anything asks
 * about the copy's versions, and never again.
 */
async function start(db: Db, copy: Copy): Promise<void> {
  await db.query(
    `insert into versions (copy_id, number, note, source_zip_url, created_by, created_at)
     select $1, 1, 'Copied from version ' || v.number || ' of ' || p.name || '.', v.source_zip_url, $4, $2
     from versions v join projects p on p.id = v.project_id
     where v.id = $3
     on conflict (copy_id, number) do nothing`,
    [copy.id, copy.created_at, copy.from_version_id, copy.owner],
  )
}

/** Every version of a copy, newest first. */
export async function list(db: Db, copy: Copy): Promise<CopyVersion[]> {
  await start(db, copy)
  return (await db.query<CopyVersion>(`select ${COLUMNS} from versions where copy_id = $1 order by number desc`, [copy.id])).rows
}

/** One version of a copy by its number, or null. */
export async function byNumber(db: Db, copy: Copy, number: number): Promise<CopyVersion | null> {
  if (!Number.isInteger(number) || number < 1) return null
  await start(db, copy)
  return one(await db.query<CopyVersion>(`select ${COLUMNS} from versions where copy_id = $1 and number = $2`, [copy.id, number]))
}

/**
 * Add a version to a copy, numbered one after the newest. The copy's
 * working zip is moved along with it, so it always points at the newest code.
 */
export async function append(
  db: Db,
  copy: Copy,
  input: { note: string; source_zip_url: string | null; restored_from?: number },
): Promise<CopyVersion> {
  await start(db, copy)
  // Two saves at the same moment can pick the same number; the unique index
  // refuses the second, which then simply tries again with the next one.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const row = one(
        await db.query<CopyVersion>(
          `insert into versions (copy_id, number, note, source_zip_url, restored_from, created_by)
           values ($1, (select coalesce(max(number), 0) + 1 from versions where copy_id = $1), $2, $3, $4, $5)
           returning ${COLUMNS}`,
          [copy.id, input.note, input.source_zip_url, input.restored_from ?? null, copy.owner],
        ),
      )
      if (!row) throw new Error('copy version insert returned nothing')
      // Always the newest version's zip, whichever save finishes last.
      await db.query(
        `update copies set working_zip_url =
           (select source_zip_url from versions where copy_id = $1 order by number desc limit 1)
         where id = $1`,
        [copy.id],
      )
      return row
    } catch (error) {
      if ((error as { code?: string }).code !== '23505' || attempt >= 4) throw error
    }
  }
}

/**
 * Go back to an earlier version by adding a new one with the same code.
 * Returns null if there is no such version, or if it is already the newest.
 */
export async function restore(db: Db, copy: Copy, number: number): Promise<CopyVersion | null> {
  const target = await byNumber(db, copy, number)
  const newest = (await list(db, copy))[0]
  if (!target || !newest || target.number === newest.number) return null
  return append(db, copy, { note: `Went back to version ${target.number}.`, source_zip_url: target.source_zip_url, restored_from: target.number })
}

/** The copy, where it came from, and its newest version. */
export async function detail(db: Db, copy: Copy): Promise<CopyDetail | null> {
  const from = one(
    await db.query<{ slug: string; name: string; maker_name: string; version_number: number }>(
      `select p.slug, p.name, u.name as maker_name, v.number as version_number
       from versions v join projects p on p.id = v.project_id join users u on u.id = p.owner
       where v.id = $1`,
      [copy.from_version_id],
    ),
  )
  const all = await list(db, copy)
  const current = all[0]
  if (!from || !current) return null
  return {
    // The working zip may have moved since `copy` was read.
    copy: { ...copy, working_zip_url: current.source_zip_url },
    copied_from: { project: { slug: from.slug, name: from.name }, maker_name: from.maker_name, version_number: from.version_number },
    current,
    versions: all.length,
  }
}

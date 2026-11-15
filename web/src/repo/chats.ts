/**
 * Chats that last: which chat is whose, what was said in it, and the code
 * as it last left it. routes/chat.ts decides what happens; this only stores.
 */

import { one, type Db } from '../db.js'
import type { ChatVersion } from '../services/chat.js'

/** One saved chat, with the name and slug of the project it is about. */
export interface ChatRow {
  id: string
  owner: string
  project_id: string
  slug: string
  name: string
  /** Null when the maker is changing their own project. */
  copy_id: string | null
  from_version: number
  /** The chat service's id for the live session. */
  remote: string
  base_zip_url: string
  /** The code as the chat last left it; null until the first change. */
  working_zip_url: string | null
  /** The changes so far, as the chat page lists them. */
  versions: ChatVersion[]
  /** How many of `versions` were made before the live session began. */
  version_offset: number
  started_at: string
}

export interface ChatMessage {
  seq: number
  role: 'you' | 'assistant'
  text: string
  version_number: number | null
  created_at: string
}

const SELECT = `select c.*, p.slug, p.name from chats c join projects p on p.id = c.project_id`

export async function byId(db: Db, id: string): Promise<ChatRow | null> {
  return one(await db.query<ChatRow>(`${SELECT} where c.id = $1`, [id]))
}

/** The person's saved chat about this project or copy, if they have one. */
export async function findFor(db: Db, owner: string, projectId: string, copyId: string | null): Promise<ChatRow | null> {
  return one(
    await db.query<ChatRow>(
      `${SELECT} where c.owner = $1 and c.project_id = $2 and c.copy_id is not distinct from $3
       order by c.started_at desc limit 1`,
      [owner, projectId, copyId],
    ),
  )
}

export async function create(
  db: Db,
  input: { owner: string; project_id: string; copy_id: string | null; from_version: number; remote: string; base_zip_url: string; versions: ChatVersion[] },
): Promise<ChatRow> {
  const made = one(
    await db.query<{ id: string }>(
      `insert into chats (owner, project_id, copy_id, from_version, remote, base_zip_url, versions)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb) returning id`,
      [input.owner, input.project_id, input.copy_id, input.from_version, input.remote, input.base_zip_url, JSON.stringify(input.versions)],
    ),
  )
  const row = made ? await byId(db, made.id) : null
  if (!row) throw new Error('chat insert returned nothing')
  return row
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.query('delete from chats where id = $1', [id])
}

/** The chat was picked up again: a new live session, starting after the changes already made. */
export async function setRemote(db: Db, id: string, remote: string, versionOffset: number): Promise<void> {
  await db.query('update chats set remote = $2, version_offset = $3 where id = $1', [id, remote, versionOffset])
}

/** Save the list of changes, and (when the code changed) where its newest code is. */
export async function saveProgress(db: Db, id: string, versions: ChatVersion[], workingZipUrl?: string): Promise<void> {
  await db.query(
    'update chats set versions = $2::jsonb, working_zip_url = coalesce($3, working_zip_url) where id = $1',
    [id, JSON.stringify(versions), workingZipUrl ?? null],
  )
}

/** Everything said in a chat, oldest first. */
export async function messages(db: Db, chatId: string): Promise<ChatMessage[]> {
  const { rows } = await db.query<ChatMessage>(
    'select seq, role, text, version_number, created_at from chat_messages where chat_id = $1 order by seq',
    [chatId],
  )
  return rows
}

/** Save one exchange: what the person said, then what the AI answered. */
export async function addExchange(db: Db, chatId: string, said: string, answered: string, versionNumber: number | null): Promise<void> {
  await db.query(
    `insert into chat_messages (chat_id, role, text, version_number)
     values ($1, 'you', $2, null), ($1, 'assistant', $3, $4)`,
    [chatId, said, answered, versionNumber],
  )
}

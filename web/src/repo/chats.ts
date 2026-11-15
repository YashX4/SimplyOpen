/** The saved conversation about a copy, and the chat service session it is using. */

import { one, type Db } from '../db.js'

export interface ChatMessage {
  seq: number
  copy_id: string
  role: 'you' | 'assistant'
  text: string
  /** For an answer that changed the code: the copy version it made. */
  version_number: number | null
  created_at: string
}

export interface ChatSessionRow {
  copy_id: string
  session_id: string
  at_version: number
}

/** Everything said about a copy, oldest first. */
export async function messages(db: Db, copyId: string): Promise<ChatMessage[]> {
  return (await db.query<ChatMessage>('select * from chat_messages where copy_id = $1 order by seq', [copyId])).rows
}

/** Save one exchange: what the person said, then what the AI answered. */
export async function addExchange(
  db: Db,
  copyId: string,
  said: string,
  answered: string,
  versionNumber: number | null,
): Promise<ChatMessage[]> {
  const { rows } = await db.query<ChatMessage>(
    `insert into chat_messages (copy_id, role, text, version_number)
     values ($1, 'you', $2, null), ($1, 'assistant', $3, $4)
     returning *`,
    [copyId, said, answered, versionNumber],
  )
  return rows.sort((a, b) => Number(a.seq) - Number(b.seq))
}

export async function session(db: Db, copyId: string): Promise<ChatSessionRow | null> {
  return one(await db.query<ChatSessionRow>('select copy_id, session_id, at_version from chat_sessions where copy_id = $1', [copyId]))
}

/** Remember which chat service session a copy is using, and which version its files match. */
export async function setSession(db: Db, copyId: string, sessionId: string, atVersion: number): Promise<void> {
  await db.query(
    `insert into chat_sessions (copy_id, session_id, at_version) values ($1, $2, $3)
     on conflict (copy_id) do update set session_id = excluded.session_id, at_version = excluded.at_version, updated_at = now()`,
    [copyId, sessionId, atVersion],
  )
}

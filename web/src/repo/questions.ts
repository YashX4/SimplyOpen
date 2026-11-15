/**
 * Questions and answers on a project page. Anyone signed in can ask; the
 * project's maker answers. A question is public once it is answered. Until
 * then, only the person who asked and the maker can see it, so the page
 * never fills with unanswered or unkind questions.
 */

import { one, type Db } from '../db.js'

export interface Question {
  id: string
  text: string
  asked_by_name: string
  created_at: string
  /** Null until the maker answers. */
  answer: string | null
  answered_by_name: string | null
  answered_at: string | null
  /** Whether the person asking for this list is the one who asked it. */
  is_yours: boolean
}

/** A question as stored, for checking who may change it. */
export interface QuestionRow {
  id: string
  project_id: string
  asked_by: string
  answer: string | null
}

/** The most questions one person can have waiting for an answer on one project. */
export const MAX_WAITING_PER_PERSON = 5

/**
 * The questions a viewer may see on a project: every answered one, plus
 * unanswered ones if they asked them or they are the maker. Answered first
 * (newest answer first), then waiting ones (oldest first).
 */
export async function forProject(db: Db, projectId: string, viewerId: string | null, viewerIsMaker: boolean): Promise<Question[]> {
  const { rows } = await db.query<Question>(
    `select q.id, q.text, a.name as asked_by_name, q.created_at,
            q.answer, m.name as answered_by_name, q.answered_at,
            (q.asked_by = $2) as is_yours
     from questions q
     join users a on a.id = q.asked_by
     left join users m on m.id = q.answered_by
     where q.project_id = $1
       and (q.answer is not null or q.asked_by = $2 or $3)
     order by (q.answer is null), q.answered_at desc, q.created_at`,
    [projectId, viewerId, viewerIsMaker],
  )
  return rows.map((row) => ({ ...row, is_yours: row.is_yours === true }))
}

/** How many questions on a project are waiting for an answer (the maker's badge). */
export async function waiting(db: Db, projectId: string): Promise<number> {
  return one(await db.query<{ n: number }>('select count(*)::int as n from questions where project_id = $1 and answer is null', [projectId]))?.n ?? 0
}

/** Ask a question. Returns null if this person already has too many waiting on this project. */
export async function ask(db: Db, projectId: string, askedBy: string, text: string): Promise<{ id: string } | null> {
  const mine = one(
    await db.query<{ n: number }>('select count(*)::int as n from questions where project_id = $1 and asked_by = $2 and answer is null', [projectId, askedBy]),
  )
  if ((mine?.n ?? 0) >= MAX_WAITING_PER_PERSON) return null
  return one(await db.query<{ id: string }>('insert into questions (project_id, asked_by, text) values ($1, $2, $3) returning id', [projectId, askedBy, text]))
}

export async function byId(db: Db, id: string): Promise<QuestionRow | null> {
  return one(await db.query<QuestionRow>('select id, project_id, asked_by, answer from questions where id = $1', [id]))
}

/** Answer a question, or replace the answer it has. */
export async function answer(db: Db, id: string, answeredBy: string, text: string, now = new Date()): Promise<void> {
  await db.query('update questions set answer = $2, answered_by = $3, answered_at = $4 where id = $1', [id, text, answeredBy, now.toISOString()])
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.query('delete from questions where id = $1', [id])
}

import { randomBytes } from 'node:crypto'
import { one, type Db } from '../db.js'
import type { User } from '../types.js'

const HOUR = 60 * 60 * 1000
const MONTH = 30 * 24 * HOUR

export async function byEmail(db: Db, email: string): Promise<User | null> {
  return one(await db.query<User>('select * from users where lower(email) = lower($1)', [email]))
}

export async function byId(db: Db, id: string): Promise<User | null> {
  return one(await db.query<User>('select * from users where id = $1', [id]))
}

/** The same link signs you in and makes the account, as W9 promises. */
export async function findOrCreate(db: Db, email: string, name = ''): Promise<User> {
  const existing = await byEmail(db, email)
  if (existing) return existing
  const row = one(
    await db.query<User>('insert into users (email, name) values ($1, $2) returning *', [email, name]),
  )
  if (!row) throw new Error('user insert returned nothing')
  return row
}

export async function setName(db: Db, id: string, name: string): Promise<void> {
  await db.query('update users set name = $2 where id = $1', [id, name])
}

function token(): string {
  return randomBytes(32).toString('base64url')
}

/** Make a one time sign in link. Dead after an hour, and after one use. */
export async function startSignIn(db: Db, email: string, now = new Date()): Promise<string> {
  const t = token()
  await db.query(
    'insert into sign_in_tokens (token, email, expires_at) values ($1, $2, $3)',
    [t, email, new Date(now.getTime() + HOUR).toISOString()],
  )
  return t
}

export interface SignInResult {
  user: User
  session: string
}

/**
 * Spend a sign in token. Returns null when it never existed, was already
 * used, or has expired, and the caller shows the same message for all three
 * so a stranger cannot learn which.
 */
export async function completeSignIn(
  db: Db,
  t: string,
  now = new Date(),
): Promise<SignInResult | null> {
  return db.tx(async (tx) => {
    const found = one(
      await tx.query<{ email: string; expires_at: string; used_at: string | null }>(
        'select email, expires_at, used_at from sign_in_tokens where token = $1 for update',
        [t],
      ),
    )
    if (!found || found.used_at) return null
    if (new Date(found.expires_at).getTime() < now.getTime()) return null
    await tx.query('update sign_in_tokens set used_at = $2 where token = $1', [t, now.toISOString()])
    const user = await findOrCreate(tx, found.email)
    const session = token()
    await tx.query('insert into sessions (token, user_id, expires_at) values ($1, $2, $3)', [
      session,
      user.id,
      new Date(now.getTime() + MONTH).toISOString(),
    ])
    return { user, session }
  })
}

/** Who a session belongs to, or null. Called on every request that has a cookie. */
export async function whoIs(db: Db, session: string, now = new Date()): Promise<User | null> {
  const row = one(
    await db.query<User & { expires_at: string }>(
      `select u.*, s.expires_at from sessions s
       join users u on u.id = s.user_id
       where s.token = $1`,
      [session],
    ),
  )
  if (!row) return null
  if (new Date(row.expires_at).getTime() < now.getTime()) return null
  return row
}

export async function signOut(db: Db, session: string): Promise<void> {
  await db.query('delete from sessions where token = $1', [session])
}

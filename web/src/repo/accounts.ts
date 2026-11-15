/**
 * Accounts with a username and password, beside the emailed link in
 * users.ts. Both ways end in the same session cookie.
 *
 * What is stored: the username on the users row, and a salted scrypt hash
 * of the password in its own table. The password itself is never stored or
 * logged, and the hash never leaves this file.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { one, type Db } from '../db.js'
import type { User } from '../types.js'
import * as users from './users.js'

/** A user as the API shows them. Never includes anything about the password. */
export interface Account {
  id: string
  name: string
  email: string
  username: string | null
}

const MINUTE = 60 * 1000
const MONTH = 30 * 24 * 60 * MINUTE

/** Wrong passwords in a row before signing in by password is paused. */
export const MAX_FAILED_ATTEMPTS = 5
/** How long that pause lasts. The emailed link still works meanwhile. */
export const LOCK_MINUTES = 15

const USERNAME = /^[A-Za-z][A-Za-z0-9_-]{2,29}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8
const MAX_PASSWORD = 200

/* ------------------------------ what to check ----------------------------- */

/** Why a username can't be used, in plain words, or null if it's fine. */
export function usernameProblem(username: string): string | null {
  if (!USERNAME.test(username)) {
    return 'A username is 3 to 30 letters, numbers, dashes or underscores, and starts with a letter.'
  }
  return null
}

/** Why a password can't be used, in plain words, or null if it's fine. */
export function passwordProblem(password: string, alsoNot: string[] = []): string | null {
  if (password.length < MIN_PASSWORD) return `A password needs at least ${MIN_PASSWORD} characters.`
  if (password.length > MAX_PASSWORD) return `A password can be at most ${MAX_PASSWORD} characters.`
  if (alsoNot.some((other) => other && other.toLowerCase() === password.toLowerCase())) {
    return 'Pick a password that is not your username or email.'
  }
  return null
}

export function emailProblem(email: string): string | null {
  return EMAIL.test(email) ? null : 'That does not look like an email address.'
}

/* -------------------------------- hashing --------------------------------- */

// scrypt is built into Node and is made for passwords: slow and memory
// hungry on purpose, so a stolen table cannot be guessed through quickly.
// PASSWORD_HASH_COST lowers the work for tests only; a hash remembers the cost
// it was made with, so hashes made at any cost keep working.
const N = Number(process.env.PASSWORD_HASH_COST) >= 1024 ? Number(process.env.PASSWORD_HASH_COST) : 32768
const R = 8
const P = 1
const KEY_BYTES = 64

function derive(password: string, salt: Buffer, n: number, r: number, p: number, bytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, bytes, { N: n, r, p, maxmem: 256 * n * r }, (error, key) =>
      error ? reject(error) : resolve(key),
    )
  })
}

/** Turn a password into the text we store. A new random salt every time. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P, KEY_BYTES)
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$')
}

/** Whether a password matches a stored hash. Never throws on a bad hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false
  const expected = Buffer.from(key, 'base64url')
  try {
    const got = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p), expected.length)
    return got.length === expected.length && timingSafeEqual(got, expected)
  } catch {
    return false
  }
}

/** Checked when nobody matches, so a wrong name takes as long as a wrong password. */
const NOBODYS_HASH = hashPassword(randomBytes(16).toString('hex'))

/* ------------------------------- the actions ------------------------------ */

type Row = User & { username: string | null; email_verified_at: string | null }

function shown(user: Row): Account {
  return { id: user.id, name: user.name, email: user.email, username: user.username }
}

async function newSession(db: Db, userId: string, now: Date): Promise<string> {
  const session = randomBytes(32).toString('base64url')
  await db.query('insert into sessions (token, user_id, expires_at) values ($1, $2, $3)', [
    session,
    userId,
    new Date(now.getTime() + MONTH).toISOString(),
  ])
  return session
}

/** How a user appears with their username, for /api/me. */
export async function account(db: Db, userId: string): Promise<Account | null> {
  const row = one(await db.query<Row>('select * from users where id = $1', [userId]))
  return row ? shown(row) : null
}

export type SignUpResult =
  | { ok: true; user: Account; session: string; confirmToken: string }
  | { ok: false; code: 'USERNAME_TAKEN' | 'EMAIL_TAKEN' }

/**
 * Make an account and sign it in. The caller has already checked the
 * username, email and password with the *Problem functions above.
 *
 * The email is not proved yet: `confirmToken` is an ordinary sign in link
 * token for the caller to email. See `emailProved`.
 */
export async function signUp(
  db: Db,
  input: { username: string; email: string; password: string; name?: string },
  now = new Date(),
): Promise<SignUpResult> {
  const hash = await hashPassword(input.password)
  return db.tx(async (tx) => {
    if (one(await tx.query('select 1 from users where lower(username) = lower($1)', [input.username]))) {
      return { ok: false as const, code: 'USERNAME_TAKEN' as const }
    }
    if (await users.byEmail(tx, input.email)) return { ok: false as const, code: 'EMAIL_TAKEN' as const }
    const user = one(
      await tx.query<Row>('insert into users (email, name, username) values ($1, $2, $3) returning *', [
        input.email,
        input.name?.trim() || input.username,
        input.username,
      ]),
    )
    if (!user) throw new Error('user insert returned nothing')
    const confirmToken = await users.startSignIn(tx, input.email, now)
    await tx.query('insert into passwords (user_id, hash, confirm_token) values ($1, $2, $3)', [
      user.id,
      hash,
      confirmToken,
    ])
    return { ok: true as const, user: shown(user), session: await newSession(tx, user.id, now), confirmToken }
  })
}

export type SignInResult = { ok: true; user: Account; session: string } | { ok: false; code: 'WRONG' | 'LOCKED' }

/**
 * Sign in with a username or email, and a password.
 *
 * 'WRONG' covers no such person, no password set and a wrong password
 * alike, so a stranger cannot learn which. After MAX_FAILED_ATTEMPTS wrong
 * tries in a row, password sign in for that account pauses for LOCK_MINUTES.
 */
export async function signIn(db: Db, login: string, password: string, now = new Date()): Promise<SignInResult> {
  const found = one(
    await db.query<Row & { hash: string | null; failed_attempts: number | null; locked_until: string | null }>(
      `select u.*, p.hash, p.failed_attempts, p.locked_until
       from users u left join passwords p on p.user_id = u.id
       where lower(u.username) = lower($1) or lower(u.email) = lower($1)`,
      [login],
    ),
  )
  if (!found || !found.hash) {
    await verifyPassword(password, await NOBODYS_HASH)
    return { ok: false, code: 'WRONG' }
  }
  if (found.locked_until && new Date(found.locked_until).getTime() > now.getTime()) {
    return { ok: false, code: 'LOCKED' }
  }
  if (!(await verifyPassword(password, found.hash))) {
    const failed = (found.failed_attempts ?? 0) + 1
    const lock = failed >= MAX_FAILED_ATTEMPTS
    await db.query('update passwords set failed_attempts = $2, locked_until = $3 where user_id = $1', [
      found.id,
      lock ? 0 : failed,
      lock ? new Date(now.getTime() + LOCK_MINUTES * MINUTE).toISOString() : null,
    ])
    return { ok: false, code: 'WRONG' }
  }
  await db.query('update passwords set failed_attempts = 0, locked_until = null where user_id = $1', [found.id])
  return { ok: true, user: shown(found), session: await newSession(db, found.id, now) }
}

export type SetPasswordResult = { ok: true } | { ok: false; code: 'WRONG_CURRENT' | 'USERNAME_TAKEN' }

/**
 * Set or change the signed in person's password. If they already have one,
 * `current` must match it. Someone who came in by emailed link has none, and
 * can set one (and a username, if they have none) without it.
 *
 * Every other signed in browser is signed out, so a changed password really
 * does shut out whoever knew the old one. `keepSession` is the one asking.
 */
export async function setPassword(
  db: Db,
  input: { userId: string; password: string; current?: string; username?: string; keepSession: string },
): Promise<SetPasswordResult> {
  const existing = one(await db.query<{ hash: string }>('select hash from passwords where user_id = $1', [input.userId]))
  if (existing && !(await verifyPassword(input.current ?? '', existing.hash))) return { ok: false, code: 'WRONG_CURRENT' }
  const hash = await hashPassword(input.password)
  return db.tx(async (tx) => {
    if (input.username) {
      const taken = one(
        await tx.query('select 1 from users where lower(username) = lower($1) and id <> $2', [input.username, input.userId]),
      )
      if (taken) return { ok: false as const, code: 'USERNAME_TAKEN' as const }
      await tx.query('update users set username = $2 where id = $1 and username is null', [input.userId, input.username])
    }
    await tx.query(
      `insert into passwords (user_id, hash) values ($1, $2)
       on conflict (user_id) do update
         set hash = excluded.hash, failed_attempts = 0, locked_until = null, updated_at = now()`,
      [input.userId, hash],
    )
    await tx.query('delete from sessions where user_id = $1 and token <> $2', [input.userId, input.keepSession])
    return { ok: true as const }
  })
}

/**
 * Call when somebody has just signed in by opening an emailed link, which
 * proves the address is theirs.
 *
 * The first time that happens for an account, any password on it is only
 * kept if this is the very link sent when the password was chosen at sign
 * up. Otherwise the password was set by someone who never showed they own
 * the address, so it is removed and every other browser is signed out. The
 * real owner can then set their own.
 *
 * @param linkToken The token from the link that was opened.
 * @param session The session that link just made, which stays signed in.
 */
export async function emailProved(db: Db, userId: string, linkToken: string, session: string, now = new Date()): Promise<void> {
  await db.tx(async (tx) => {
    const user = one(await tx.query<Row>('select * from users where id = $1 for update', [userId]))
    if (!user || user.email_verified_at) return
    const password = one(await tx.query<{ confirm_token: string | null }>('select confirm_token from passwords where user_id = $1', [userId]))
    if (password && password.confirm_token !== linkToken) {
      await tx.query('delete from passwords where user_id = $1', [userId])
      await tx.query('delete from sessions where user_id = $1 and token <> $2', [userId, session])
    }
    await tx.query('update passwords set confirm_token = null where user_id = $1', [userId])
    await tx.query('update users set email_verified_at = $2 where id = $1', [userId, now.toISOString()])
  })
}

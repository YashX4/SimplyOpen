/**
 * Accounts with a username and password: signing up, signing in, changing
 * the password, and how they sit beside the emailed link.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './helpers.js'
import * as accounts from '../src/repo/accounts.js'

let h: Harness
beforeEach(async () => { h = await harness() })
afterEach(async () => { await h.close() })

const PRIYA = { username: 'priya', email: 'priya@example.com', password: 'correct horse battery' }

const post = (url: string, payload: unknown, cookie?: string) =>
  h.app.inject({ method: 'POST', url, payload: payload as object, ...(cookie ? { headers: { cookie } } : {}) })

/** The session cookie a reply set, as a Cookie header value. */
const cookieOf = (reply: { headers: Record<string, unknown> }): string => String(reply.headers['set-cookie']).split(';')[0]!

/** The token inside the newest emailed link. */
const linkToken = (): string =>
  new URL(h.mailer.sent.at(-1)!.text.split('\n').find((l) => l.includes('/sign-in/done'))!.trim()).searchParams.get('token')!

const whoAmI = async (cookie: string) => (await h.app.inject({ method: 'GET', url: '/api/account', headers: { cookie } })).json().user

describe('signing up', () => {
  it('makes the account, signs you in, and emails a confirm link', async () => {
    const made = await post('/api/auth/sign-up', PRIYA)
    expect(made.statusCode).toBe(201)
    expect(made.json().user).toMatchObject({ username: 'priya', email: 'priya@example.com', name: 'priya' })
    expect(await whoAmI(cookieOf(made))).toMatchObject({ username: 'priya' })
    expect(h.mailer.sent.at(-1)).toMatchObject({ to: 'priya@example.com', subject: 'Confirm your email for SimplyOpen' })
  })

  it('never stores or returns the password itself', async () => {
    const made = await post('/api/auth/sign-up', PRIYA)
    expect(made.body).not.toContain(PRIYA.password)
    const everything = JSON.stringify([
      (await h.db.query('select * from users')).rows,
      (await h.db.query('select * from passwords')).rows,
      (await h.db.query('select * from sessions')).rows,
    ])
    expect(everything).not.toContain(PRIYA.password)
    const { hash } = (await h.db.query<{ hash: string }>('select hash from passwords')).rows[0]!
    expect(hash).toMatch(/^scrypt\$\d+\$8\$1\$[\w-]{22}\$[\w-]{86}$/)
    // Nothing that reads a user carries the hash along.
    expect(JSON.stringify((await h.db.query('select * from users')).rows)).not.toContain(hash)
  })

  it('the same password hashes differently each time, and both verify', async () => {
    const [a, b] = [await accounts.hashPassword('same password'), await accounts.hashPassword('same password')]
    expect(a).not.toBe(b)
    expect(await accounts.verifyPassword('same password', a)).toBe(true)
    expect(await accounts.verifyPassword('same password', b)).toBe(true)
    expect(await accounts.verifyPassword('Same password', a)).toBe(false)
    expect(await accounts.verifyPassword('same password', 'not a hash')).toBe(false)
  })

  it.each([
    [{ ...PRIYA, username: 'ab' }, /username is 3 to 30/],
    [{ ...PRIYA, username: '1priya' }, /starts with a letter/],
    [{ ...PRIYA, username: 'pri ya' }, /username is 3 to 30/],
    [{ ...PRIYA, email: 'not-an-email' }, /email address/],
    [{ ...PRIYA, password: 'short' }, /at least 8/],
    [{ ...PRIYA, password: 'x'.repeat(201) }, /at most 200/],
    [{ ...PRIYA, username: 'priyaraman', password: 'PriyaRaman' }, /not your username or email/],
    [{ username: 'priya', email: 'priya@example.com' }, /at least 8/],
    [{ ...PRIYA, password: 12345678 }, /at least 8/],
  ])('refuses %j in plain words', async (body, message) => {
    const reply = await post('/api/auth/sign-up', body)
    expect(reply.statusCode).toBe(400)
    expect(reply.json().error).toMatchObject({ code: 'BAD_SIGN_UP', message: expect.stringMatching(message) })
    expect((await h.db.query('select 1 from passwords')).rows).toHaveLength(0)
  })

  it('a username or email can only be used once, whatever the capitals', async () => {
    await post('/api/auth/sign-up', PRIYA)
    expect((await post('/api/auth/sign-up', { ...PRIYA, username: 'PRIYA', email: 'other@example.com' })).json().error.code).toBe('USERNAME_TAKEN')
    expect((await post('/api/auth/sign-up', { ...PRIYA, username: 'priya2', email: 'Priya@Example.com' })).json().error.code).toBe('EMAIL_TAKEN')
  })

  it('cannot take over an account that was made by emailed link', async () => {
    await h.signIn('link@example.com')
    const reply = await post('/api/auth/sign-up', { ...PRIYA, email: 'link@example.com' })
    expect([reply.statusCode, reply.json().error.code]).toEqual([409, 'EMAIL_TAKEN'])
    expect((await h.db.query('select 1 from passwords')).rows).toHaveLength(0)
  })
})

describe('signing in', () => {
  beforeEach(async () => { await post('/api/auth/sign-up', PRIYA) })

  it('works with the username or the email, whatever the capitals', async () => {
    for (const login of ['priya', 'PRIYA', 'priya@example.com', 'Priya@Example.com']) {
      const reply = await post('/api/auth/sign-in', { login, password: PRIYA.password })
      expect(reply.statusCode).toBe(200)
      expect(await whoAmI(cookieOf(reply))).toMatchObject({ username: 'priya' })
    }
  })

  it('gives the same answer for a wrong password, an unknown name, and an account with no password', async () => {
    await h.signIn('link@example.com')
    const answers = await Promise.all([
      post('/api/auth/sign-in', { login: 'priya', password: 'wrong password' }),
      post('/api/auth/sign-in', { login: 'nobody', password: PRIYA.password }),
      post('/api/auth/sign-in', { login: 'link@example.com', password: PRIYA.password }),
    ])
    for (const reply of answers) {
      expect(reply.statusCode).toBe(401)
      expect(reply.json()).toEqual({ error: { code: 'WRONG_SIGN_IN', message: 'That username, email or password is not right.' } })
      expect(reply.headers['set-cookie']).toBeUndefined()
    }
  })

  it('pauses after five wrong tries, even for the right password, then lets you in again', async () => {
    for (let i = 0; i < accounts.MAX_FAILED_ATTEMPTS; i++) {
      expect((await post('/api/auth/sign-in', { login: 'priya', password: 'wrong password' })).statusCode).toBe(401)
    }
    const locked = await post('/api/auth/sign-in', { login: 'priya', password: PRIYA.password })
    expect([locked.statusCode, locked.json().error.code]).toEqual([429, 'TOO_MANY_TRIES'])

    const later = new Date(Date.now() + (accounts.LOCK_MINUTES + 1) * 60_000)
    expect((await accounts.signIn(h.db, 'priya', PRIYA.password, later)).ok).toBe(true)
  })

  it('a right password clears the count of wrong tries', async () => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < accounts.MAX_FAILED_ATTEMPTS - 1; i++) await post('/api/auth/sign-in', { login: 'priya', password: 'wrong password' })
      expect((await post('/api/auth/sign-in', { login: 'priya', password: PRIYA.password })).statusCode).toBe(200)
    }
  })

  it('signing out ends the session', async () => {
    const cookie = cookieOf(await post('/api/auth/sign-in', { login: 'priya', password: PRIYA.password }))
    await post('/api/auth/sign-out', {}, cookie)
    expect(await whoAmI(cookie)).toBeNull()
  })

  it('asks for both fields', async () => {
    expect((await post('/api/auth/sign-in', { login: 'priya' })).json().error.code).toBe('BAD_SIGN_IN')
    expect((await post('/api/auth/sign-in', {})).statusCode).toBe(400)
  })
})

describe('setting and changing the password', () => {
  it('changing it needs the current one, and signs out every other browser', async () => {
    const here = cookieOf(await post('/api/auth/sign-up', PRIYA))
    const elsewhere = cookieOf(await post('/api/auth/sign-in', { login: 'priya', password: PRIYA.password }))

    expect((await post('/api/auth/password', { password: 'a brand new one' }, here)).json().error.code).toBe('WRONG_PASSWORD')
    expect((await post('/api/auth/password', { password: 'a brand new one', current_password: 'nope nope' }, here)).statusCode).toBe(401)
    expect((await post('/api/auth/password', { password: 'a brand new one', current_password: PRIYA.password }, here)).statusCode).toBe(200)

    expect(await whoAmI(here)).toMatchObject({ username: 'priya' })
    expect(await whoAmI(elsewhere)).toBeNull()
    expect((await post('/api/auth/sign-in', { login: 'priya', password: PRIYA.password })).statusCode).toBe(401)
    expect((await post('/api/auth/sign-in', { login: 'priya', password: 'a brand new one' })).statusCode).toBe(200)
  })

  it('someone who came in by emailed link can add a username and password', async () => {
    const { cookie } = await h.signIn('link@example.com', 'Link Person')
    const set = await post('/api/auth/password', { username: 'linkperson', password: 'my first password' }, cookie)
    expect(set.json().user).toMatchObject({ username: 'linkperson', email: 'link@example.com', name: 'Link Person' })
    expect((await post('/api/auth/sign-in', { login: 'linkperson', password: 'my first password' })).statusCode).toBe(200)
    // A username, once chosen, stays.
    expect((await post('/api/auth/password', { username: 'other', password: 'another password', current_password: 'my first password' }, cookie)).json().error.code).toBe('HAS_USERNAME')
  })

  it('needs you signed in, a good password, and a free username', async () => {
    expect((await post('/api/auth/password', { password: 'long enough password' })).statusCode).toBe(401)
    await post('/api/auth/sign-up', PRIYA)
    const { cookie } = await h.signIn('link@example.com')
    expect((await post('/api/auth/password', { password: 'short' }, cookie)).json().error.code).toBe('BAD_PASSWORD')
    expect((await post('/api/auth/password', { username: 'Priya', password: 'long enough password' }, cookie)).json().error.code).toBe('USERNAME_TAKEN')
    expect((await h.db.query('select 1 from passwords')).rows).toHaveLength(1) // still only Priya's
  })
})

describe('passwords and emailed links together', () => {
  const openLink = (token: string) => h.app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })

  it('opening the confirm link from sign up keeps the password', async () => {
    await post('/api/auth/sign-up', PRIYA)
    expect((await openLink(linkToken())).statusCode).toBe(200)
    expect((await post('/api/auth/sign-in', { login: 'priya', password: PRIYA.password })).statusCode).toBe(200)
  })

  it('a stranger who signs up with your email loses the password the moment you prove the address is yours', async () => {
    // A stranger signs up with the owner's address and a password they chose.
    const stranger = cookieOf(await post('/api/auth/sign-up', { ...PRIYA, username: 'stranger', email: 'owner@example.com' }))
    // The owner, who never saw that, asks for an ordinary sign in link and opens it.
    await post('/api/auth/link', { email: 'owner@example.com' })
    const owner = cookieOf(await openLink(linkToken()))

    expect(await whoAmI(owner)).toMatchObject({ email: 'owner@example.com' })
    expect(await whoAmI(stranger)).toBeNull() // signed out
    expect((await post('/api/auth/sign-in', { login: 'stranger', password: PRIYA.password })).statusCode).toBe(401) // password gone
    // The owner can now set their own.
    expect((await post('/api/auth/password', { password: 'the owners password' }, owner)).statusCode).toBe(200)
  })

  it('once the address is proved, later sign in links leave the password alone', async () => {
    await post('/api/auth/sign-up', PRIYA)
    await openLink(linkToken())
    await post('/api/auth/link', { email: PRIYA.email })
    await openLink(linkToken())
    expect((await post('/api/auth/sign-in', { login: 'priya', password: PRIYA.password })).statusCode).toBe(200)
  })

  it("the emailed link still works for people who never set a password", async () => {
    await post('/api/auth/link', { email: 'plain@example.com' })
    const cookie = cookieOf(await openLink(linkToken()))
    expect(await whoAmI(cookie)).toEqual({ id: expect.any(String), name: '', email: 'plain@example.com', username: null })
  })
})

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { harness, type Harness } from './helpers.js'
import * as users from '../src/repo/users.js'

let h: Harness
beforeEach(async () => { h = await harness() })
afterEach(async () => { await h.close() })

function tokenFrom(text: string): string {
  return new URL(text.split('\n').find((l) => l.includes('/sign-in/done'))!.trim()).searchParams.get('token')!
}

describe('signing in', () => {
  it('emails a link, and the link signs you in', async () => {
    const asked = await h.app.inject({
      method: 'POST', url: '/api/auth/link', payload: { email: 'new@example.com' },
    })
    expect(asked.statusCode).toBe(200)
    expect(h.mailer.sent).toHaveLength(1)

    const token = tokenFrom(h.mailer.sent[0]!.text)
    const back = await h.app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
    expect(back.statusCode).toBe(200)
    expect(back.json().user.email).toBe('new@example.com')
    expect(back.headers['set-cookie']).toContain('so_session=')
  })

  it('makes the account on the way in, so there is no sign up', async () => {
    expect(await users.byEmail(h.db, 'brand@new.example')).toBeNull()
    await h.app.inject({ method: 'POST', url: '/api/auth/link', payload: { email: 'brand@new.example' } })
    const token = tokenFrom(h.mailer.sent[0]!.text)
    await h.app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
    expect(await users.byEmail(h.db, 'brand@new.example')).not.toBeNull()
  })

  it('a link works once', async () => {
    await h.app.inject({ method: 'POST', url: '/api/auth/link', payload: { email: 'once@example.com' } })
    const token = tokenFrom(h.mailer.sent[0]!.text)
    const first = await h.app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
    expect(first.statusCode).toBe(200)
    const second = await h.app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
    expect(second.statusCode).toBe(400)
    expect(second.json().error.code).toBe('LINK_NOT_GOOD')
  })

  it('a link dies after an hour', async () => {
    const token = await users.startSignIn(h.db, 'slow@example.com')
    const later = new Date(Date.now() + 61 * 60 * 1000)
    expect(await users.completeSignIn(h.db, token, later)).toBeNull()
  })

  it('says the same thing for a made up link as for a used one', async () => {
    const made = await h.app.inject({ method: 'GET', url: '/api/auth/callback?token=nonsense' })
    expect(made.statusCode).toBe(400)
    expect(made.json().error.code).toBe('LINK_NOT_GOOD')
  })

  it('does not say whether an address already has an account', async () => {
    const known = await h.app.inject({
      method: 'POST', url: '/api/auth/link', payload: { email: 'p.raman@leeds.ac.uk' },
    })
    const unknown = await h.app.inject({
      method: 'POST', url: '/api/auth/link', payload: { email: 'nobody@nowhere.example' },
    })
    expect(known.statusCode).toBe(unknown.statusCode)
    expect(known.body).toBe(unknown.body)
  })

  it('turns away an address that is not one', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/api/auth/link', payload: { email: 'not an email' },
    })
    expect(response.statusCode).toBe(400)
    expect(h.mailer.sent).toHaveLength(0)
  })

  it('knows who you are, and forgets when you sign out', async () => {
    const me = await h.signIn('me@example.com', 'Me')
    const before = await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: me.cookie } })
    expect(before.json().user.name).toBe('Me')

    await h.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: me.cookie } })
    const after = await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: me.cookie } })
    expect(after.json().user).toBeNull()
  })

  it('getting things never asks for a session', async () => {
    const browse = await h.app.inject({ method: 'GET', url: '/api/browse' })
    const page = await h.app.inject({ method: 'GET', url: '/api/projects/zoom-transcripts-to-nvivo' })
    expect(browse.statusCode).toBe(200)
    expect(page.statusCode).toBe(200)
  })

  it('putting something in does ask', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/me/things' })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('SIGN_IN_NEEDED')
  })
})

describe('signing up for the first time', () => {
  it('a new address makes an account with no name yet, which the person then gives', async () => {
    const h2 = await (await import('./helpers.js')).harness()
    try {
      const them = await h2.signIn('new.person@example.ac.uk')
      const before = await h2.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: them.cookie } })
      expect(before.json().user.name).toBe('')
      const named = await h2.app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie: them.cookie }, payload: { name: '  Ama   Osei ' } })
      expect(named.statusCode).toBe(200)
      const after = await h2.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: them.cookie } })
      expect(after.json().user.name).toBe('Ama Osei')
      expect((await h2.app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie: them.cookie }, payload: { name: ' ' } })).statusCode).toBe(400)
      expect((await h2.app.inject({ method: 'PATCH', url: '/api/me', payload: { name: 'X' } })).statusCode).toBe(401)
    } finally { await h2.close() }
  })

  it('never hands the link back unless the site is told to', async () => {
    const h2 = await (await import('./helpers.js')).harness()
    try {
      const res = await h2.app.inject({ method: 'POST', url: '/api/auth/link', payload: { email: 'a@example.ac.uk' } })
      expect(res.json()).toEqual({ sent: true })
    } finally { await h2.close() }
  })
})

describe('real email, through Resend', () => {
  it('sends the link to Resend with the key, and says so plainly when that fails', async () => {
    const { ResendMailer } = await import('../src/services/mailer.js')
    const calls: { url: string; init: RequestInit }[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 })
    }) as typeof fetch
    try {
      await new ResendMailer('re_test').send({ to: 'a@example.ac.uk', subject: 'Hi', text: 'Link' })
      expect(calls[0]!.url).toBe('https://api.resend.com/emails')
      expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_test')
      expect(JSON.parse(calls[0]!.init.body as string).to).toEqual(['a@example.ac.uk'])
      globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 })) as typeof fetch
      await expect(new ResendMailer('bad').send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow('API key is invalid')
    } finally {
      globalThis.fetch = real
    }
  })
})

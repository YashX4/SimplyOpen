import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { harness, type Harness } from './helpers.js'
import * as projects from '../src/repo/projects.js'
import * as users from '../src/repo/users.js'

let h: Harness
beforeEach(async () => { h = await harness() })
afterEach(async () => { await h.close() })

const SLUG = 'zoom-transcripts-to-nvivo'

async function priya() {
  const project = await projects.bySlug(h.db, SLUG)
  const row = await h.db.query<{ email: string }>('select email from users where id = $1', [project!.owner])
  const done = await users.completeSignIn(h.db, await users.startSignIn(h.db, row.rows[0]!.email))
  return `so_session=${done!.session}`
}

describe('P3, changing the name and what it does', () => {
  it('saves both for the person who made it', async () => {
    const cookie = await priya()
    const res = await h.app.inject({
      method: 'PATCH', url: `/api/projects/${SLUG}`, headers: { cookie },
      payload: { name: '  Zoom to NVivo  ', description: 'Shorter.' },
    })
    expect(res.statusCode).toBe(200)
    const after = await projects.bySlug(h.db, SLUG)
    expect(after!.name).toBe('Zoom to NVivo')
    expect(after!.description).toBe('Shorter.')
    expect(after!.slug).toBe(SLUG)
  })

  it('refuses an empty name', async () => {
    const cookie = await priya()
    const res = await h.app.inject({
      method: 'PATCH', url: `/api/projects/${SLUG}`, headers: { cookie }, payload: { name: '   ' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('is only for the person who made it', async () => {
    const other = await h.signIn('someone@example.ac.uk', 'Someone Else')
    const res = await h.app.inject({
      method: 'PATCH', url: `/api/projects/${SLUG}`, headers: { cookie: other.cookie }, payload: { name: 'Mine now' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('needs a session', async () => {
    const res = await h.app.inject({ method: 'PATCH', url: `/api/projects/${SLUG}`, payload: { name: 'X' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('the header badge', () => {
  it('comes back with who is signed in', async () => {
    const cookie = await priya()
    const res = await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    expect(res.json().user.name).toBe('Priya Raman')
    expect(res.json().waiting_suggestions).toBe(0)
  })
})

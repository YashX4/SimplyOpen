import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { harness, type Harness } from './helpers.js'
import * as projects from '../src/repo/projects.js'
import * as suggestions from '../src/repo/suggestions.js'
import * as users from '../src/repo/users.js'
import * as versions from '../src/repo/versions.js'

let h: Harness
const SLUG = 'zoom-transcripts-to-nvivo'
const SOURCE = new TextEncoder().encode('the original files')

beforeEach(async () => {
  h = await harness()
  // The seeded version has no files kept with it; give it some, as an upload would.
  const project = await projects.bySlug(h.db, SLUG)
  const latest = await versions.latest(h.db, project!.id)
  const stored = await h.storage.put('uploads/seed/project.zip', SOURCE, 'application/zip')
  await h.db.query('update versions set source_zip_url = $2 where id = $1', [latest!.id, stored.url])
})
afterEach(async () => { await h.close() })

async function priya() {
  const project = await projects.bySlug(h.db, SLUG)
  const row = await h.db.query<{ email: string }>('select email from users where id = $1', [project!.owner])
  const done = await users.completeSignIn(h.db, await users.startSignIn(h.db, row.rows[0]!.email))
  return { cookie: `so_session=${done!.session}`, project: project! }
}

const post = (url: string, cookie: string, payload: object = {}) =>
  h.app.inject({ method: 'POST', url, headers: { cookie }, payload })

describe('the maker changing it by chatting', () => {
  it('starts from the newest version’s own files', async () => {
    const { cookie } = await priya()
    const res = await post(`/api/projects/${SLUG}/chats`, cookie)
    expect(res.statusCode).toBe(201)
    expect(res.json().chat.kind).toBe('maker')
    expect(res.json().chat.from_version).toBe(5)
    expect(new TextDecoder().decode(h.chat.started[0])).toBe('the original files')
  })

  it('is only for the person who made it', async () => {
    const other = await h.signIn('someone@example.ac.uk', 'Someone')
    expect((await post(`/api/projects/${SLUG}/chats`, other.cookie)).statusCode).toBe(403)
  })

  it('passes messages through, and the privacy reminder back', async () => {
    const { cookie } = await priya()
    const id = (await post(`/api/projects/${SLUG}/chats`, cookie)).json().chat.id
    const changed = await post(`/api/chats/${id}/messages`, cookie, { message: 'please change the folder' })
    expect(changed.json().kind).toBe('reply')
    expect(changed.json().version.number).toBe(1)
    const careful = await post(`/api/chats/${id}/messages`, cookie, { message: 'email it to a@b.co' })
    expect(careful.json().kind).toBe('privacy_reminder')
  })

  it('a stranger cannot read or write somebody else’s chat', async () => {
    const { cookie } = await priya()
    const id = (await post(`/api/projects/${SLUG}/chats`, cookie)).json().chat.id
    const other = await h.signIn('someone@example.ac.uk', 'Someone')
    expect((await post(`/api/chats/${id}/messages`, other.cookie, { message: 'change it' })).statusCode).toBe(410)
    expect((await h.app.inject({ method: 'GET', url: `/api/chats/${id}`, headers: { cookie: other.cookie } })).statusCode).toBe(410)
  })

  it('making it a version builds it like an upload, with their note', async () => {
    const { cookie, project } = await priya()
    const id = (await post(`/api/projects/${SLUG}/chats`, cookie)).json().chat.id
    await post(`/api/chats/${id}/messages`, cookie, { message: 'please change the folder' })
    const made = await post(`/api/chats/${id}/release`, cookie, { note: 'Files go where you choose.' })
    expect(made.statusCode).toBe(201)
    expect(made.json().version.number).toBe(6)
    const latest = await versions.latest(h.db, project.id)
    expect(latest!.note).toBe('Files go where you choose.')
    expect(latest!.source_zip_url).toBeTruthy()
    expect(h.factory.dispatched).toHaveLength(1)
    const page = await h.app.inject({ method: 'GET', url: `/api/projects/${SLUG}` })
    expect(page.json().builds).toHaveLength(3)
  })

  it('starting again ends the chat that was already going', async () => {
    const { cookie } = await priya()
    const first = (await post(`/api/projects/${SLUG}/chats`, cookie)).json().chat.id
    await post(`/api/projects/${SLUG}/chats`, cookie)
    expect(h.chat.sessions.size).toBe(1)
    expect((await post(`/api/chats/${first}/messages`, cookie, { message: 'change it' })).statusCode).toBe(410)
  })

  it('says when the chat has ended', async () => {
    const { cookie } = await priya()
    const id = (await post(`/api/projects/${SLUG}/chats`, cookie)).json().chat.id
    h.chat.sessions.clear()
    const res = await post(`/api/chats/${id}/messages`, cookie, { message: 'change it' })
    expect(res.statusCode).toBe(410)
    expect(res.json().error.code).toBe('CHAT_ENDED')
  })
})

describe('a copy, changed and offered back', () => {
  async function copied() {
    const them = await h.signIn('tomas@example.ac.uk', 'Tomás Medina')
    const copy = (await post(`/api/projects/${SLUG}/copies`, them.cookie)).json().copy as { id: string }
    const chat = (await post(`/api/copies/${copy.id}/chats`, them.cookie)).json().chat as { id: string; kind: string }
    return { them, copy, chat }
  }

  it('starts from the version it was copied from', async () => {
    const { chat } = await copied()
    expect(chat.kind).toBe('copy')
    expect(new TextDecoder().decode(h.chat.started[0])).toBe('the original files')
  })

  it('keeping a change stores the copy’s own files, which outlive the chat', async () => {
    const { them, copy, chat } = await copied()
    await post(`/api/chats/${chat.id}/messages`, them.cookie, { message: 'change the spreadsheet' })
    expect((await post(`/api/chats/${chat.id}/keep`, them.cookie)).statusCode).toBe(200)
    const after = await suggestions.copyById(h.db, copy.id)
    expect(after!.working_zip_url).toBeTruthy()
    // The next chat on the copy starts from where it got to.
    await post(`/api/copies/${copy.id}/chats`, them.cookie)
    expect(new TextDecoder().decode(h.chat.started[1])).toBe('changed 1')
  })

  it('cannot be made a version by the person who copied it', async () => {
    const { them, chat } = await copied()
    expect((await post(`/api/chats/${chat.id}/release`, them.cookie, { note: 'mine' })).statusCode).toBe(403)
  })

  it('suggesting it back, then the maker taking it, builds the copy’s files', async () => {
    const { them, chat } = await copied()
    await post(`/api/chats/${chat.id}/messages`, them.cookie, { message: 'change the spreadsheet' })
    const sent = await post(`/api/chats/${chat.id}/suggest`, them.cookie, {
      note: 'Saves me a step.', changes: [{ title: 'It saves a spreadsheet as well.' }],
    })
    expect(sent.statusCode).toBe(201)
    const id = sent.json().suggestion.id as string

    const { cookie } = await priya()
    const taken = await post(`/api/suggestions/${id}/take`, cookie, { note: 'Also saves a spreadsheet.' })
    expect(taken.statusCode).toBe(200)
    expect(taken.json().built).toBe(true)
    expect(h.factory.dispatched).toHaveLength(1)
    const detail = await h.app.inject({ method: 'GET', url: `/api/versions/${taken.json().version.id}` })
    expect(detail.json().builds).toHaveLength(3)
    expect(detail.json().version.source_zip_url).toBeTruthy()
  })

  it('shows its owner the copy, and what was sent from it', async () => {
    const { them, copy, chat } = await copied()
    await post(`/api/chats/${chat.id}/messages`, them.cookie, { message: 'change the spreadsheet' })
    await post(`/api/chats/${chat.id}/suggest`, them.cookie, { changes: [{ title: 'A spreadsheet.' }] })
    const res = await h.app.inject({ method: 'GET', url: `/api/copies/${copy.id}`, headers: { cookie: them.cookie } })
    expect(res.json().copy.changed).toBe(true)
    expect(res.json().project.maker).toBe('Priya Raman')
    expect(res.json().suggestions).toHaveLength(1)
    expect(res.json().chat.id).toBe(chat.id)
  })
})

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { harness, type Harness } from './helpers.js'
import * as projects from '../src/repo/projects.js'
import * as versions from '../src/repo/versions.js'

let h: Harness
beforeEach(async () => { h = await harness() })
afterEach(async () => { await h.close() })

const SLUG = 'zoom-transcripts-to-nvivo'
const CHANGES = [
  {
    title: 'It saves a spreadsheet as well.',
    before: 'Only the NVivo file.',
    after: 'The NVivo file, and a .csv beside it.',
  },
  { title: 'You can turn that off.', before: 'No switch for it.', after: 'A switch in the window.' },
]

/** Priya owns the seeded project; this is whoever is copying it. */
async function copier() {
  const them = await h.signIn('tomas@example.ac.uk', 'Tomás Medina')
  const made = await h.app.inject({
    method: 'POST', url: `/api/projects/${SLUG}/copies`, headers: { cookie: them.cookie }, payload: {},
  })
  return { them, copy: made.json().copy as { id: string }, from: made.json().from_version }
}

async function maker() {
  const project = await projects.bySlug(h.db, SLUG)
  const row = await h.db.query<{ email: string }>('select email from users where id = $1', [
    project!.owner,
  ])
  const { default: users } = { default: await import('../src/repo/users.js') }
  const token = await users.startSignIn(h.db, row.rows[0]!.email)
  const done = await users.completeSignIn(h.db, token)
  return { id: project!.owner, cookie: `so_session=${done!.session}`, project: project! }
}

describe('making a copy', () => {
  it('starts from the newest version by default', async () => {
    const { from } = await copier()
    expect(from.number).toBe(5)
  })

  it('can start from an older one on purpose', async () => {
    const them = await h.signIn('tomas@example.ac.uk', 'Tomás')
    const made = await h.app.inject({
      method: 'POST', url: `/api/projects/${SLUG}/copies`,
      headers: { cookie: them.cookie }, payload: { version: 3 },
    })
    expect(made.json().from_version.number).toBe(3)
  })

  it('needs a session, because a copy belongs to somebody', async () => {
    const response = await h.app.inject({ method: 'POST', url: `/api/projects/${SLUG}/copies`, payload: {} })
    expect(response.statusCode).toBe(401)
  })
})

describe('offering a change back', () => {
  it('keeps the plain words as rows, in order', async () => {
    const { them, copy } = await copier()
    const sent = await h.app.inject({
      method: 'POST', url: `/api/copies/${copy.id}/suggestions`,
      headers: { cookie: them.cookie },
      payload: { note: 'Saves me a step every time.', changes: CHANGES },
    })
    expect(sent.statusCode).toBe(201)
    expect(sent.json().suggestion.state).toBe('waiting')
    expect(sent.json().changes.map((c: { title: string }) => c.title)).toEqual([
      'It saves a spreadsheet as well.',
      'You can turn that off.',
    ])
  })

  it('refuses an empty suggestion', async () => {
    const { them, copy } = await copier()
    const sent = await h.app.inject({
      method: 'POST', url: `/api/copies/${copy.id}/suggestions`,
      headers: { cookie: them.cookie }, payload: { note: 'nothing here', changes: [] },
    })
    expect(sent.statusCode).toBe(400)
  })

  it('will not let you send from somebody else’s copy', async () => {
    const { copy } = await copier()
    const stranger = await h.signIn('nosy@example.com', 'Nosy')
    const sent = await h.app.inject({
      method: 'POST', url: `/api/copies/${copy.id}/suggestions`,
      headers: { cookie: stranger.cookie }, payload: { changes: CHANGES },
    })
    expect(sent.statusCode).toBe(403)
  })
})

describe('the maker deciding', () => {
  async function waiting() {
    const { them, copy } = await copier()
    const sent = await h.app.inject({
      method: 'POST', url: `/api/copies/${copy.id}/suggestions`,
      headers: { cookie: them.cookie }, payload: { note: 'Please.', changes: CHANGES },
    })
    return { them, suggestion: sent.json().suggestion as { id: string } }
  }

  it('shows up in the inbox, and only for the person who made the project', async () => {
    const { them } = await waiting()
    const mine = await maker()

    const theirs = await h.app.inject({
      method: 'GET', url: `/api/projects/${SLUG}/suggestions`, headers: { cookie: them.cookie },
    })
    expect(theirs.statusCode).toBe(403)

    const inbox = await h.app.inject({
      method: 'GET', url: `/api/projects/${SLUG}/suggestions`, headers: { cookie: mine.cookie },
    })
    expect(inbox.json().suggestions).toHaveLength(1)
    expect(inbox.json().suggestions[0].changes).toHaveLength(2)
    expect(inbox.json().suggestions[0].author_name).toBe('Tomás Medina')
  })

  it('taking it makes the next version, with their name on it', async () => {
    const { them, suggestion } = await waiting()
    const mine = await maker()

    const taken = await h.app.inject({
      method: 'POST', url: `/api/suggestions/${suggestion.id}/take`,
      headers: { cookie: mine.cookie }, payload: { note: 'Also saves a spreadsheet.' },
    })
    expect(taken.statusCode).toBe(200)
    expect(taken.json().version.number).toBe(6)
    expect(taken.json().version.suggested_by).toBe(them.id)
    expect(taken.json().suggestion.state).toBe('taken')

    const latest = await versions.latest(h.db, mine.project.id)
    expect(latest!.number).toBe(6)
    expect(latest!.note).toBe('Also saves a spreadsheet.')
  })

  it('the version it made carries the plain words, which V2 shows', async () => {
    const { suggestion } = await waiting()
    const mine = await maker()
    const taken = await h.app.inject({
      method: 'POST', url: `/api/suggestions/${suggestion.id}/take`,
      headers: { cookie: mine.cookie }, payload: {},
    })
    const detail = await h.app.inject({ method: 'GET', url: `/api/versions/${taken.json().version.id}` })
    expect(detail.json().suggester_name).toBe('Tomás Medina')
    expect(detail.json().suggestion_id).toBe(suggestion.id)
    expect(detail.json().changes.map((c: { title: string }) => c.title)).toEqual(CHANGES.map((c) => c.title))
  })

  it('cannot be taken twice', async () => {
    const { suggestion } = await waiting()
    const mine = await maker()
    await h.app.inject({
      method: 'POST', url: `/api/suggestions/${suggestion.id}/take`, headers: { cookie: mine.cookie },
    })
    const again = await h.app.inject({
      method: 'POST', url: `/api/suggestions/${suggestion.id}/take`, headers: { cookie: mine.cookie },
    })
    expect(again.statusCode).toBe(409)
    const all = await versions.list(h.db, mine.project.id)
    expect(all).toHaveLength(6)
  })

  it('a stranger cannot take one', async () => {
    const { suggestion } = await waiting()
    const stranger = await h.signIn('nosy@example.com', 'Nosy')
    const response = await h.app.inject({
      method: 'POST', url: `/api/suggestions/${suggestion.id}/take`, headers: { cookie: stranger.cookie },
    })
    expect(response.statusCode).toBe(403)
  })

  it('the maker can leave it, and the sender can pull it back', async () => {
    const left = await waiting()
    const mine = await maker()
    const leaving = await h.app.inject({
      method: 'POST', url: `/api/suggestions/${left.suggestion.id}/leave`, headers: { cookie: mine.cookie },
    })
    expect(leaving.json().suggestion.state).toBe('left')

    const second = await waiting()
    const pulling = await h.app.inject({
      method: 'POST', url: `/api/suggestions/${second.suggestion.id}/leave`,
      headers: { cookie: second.them.cookie },
    })
    expect(pulling.json().suggestion.state).toBe('withdrawn')
  })

  it('counts what is waiting, which is the badge in the header', async () => {
    await waiting()
    await waiting()
    const mine = await maker()
    const things = await h.app.inject({
      method: 'GET', url: '/api/me/things', headers: { cookie: mine.cookie },
    })
    expect(things.json().waiting_suggestions).toBe(2)
    expect(things.json().made[0].waiting).toBe(2)
  })

  it('shows the copier their own copies', async () => {
    const { them } = await copier()
    const things = await h.app.inject({
      method: 'GET', url: '/api/me/things', headers: { cookie: them.cookie },
    })
    expect(things.json().copies).toHaveLength(1)
    expect(things.json().copies[0].project.slug).toBe(SLUG)
    expect(things.json().made).toHaveLength(0)
  })
})

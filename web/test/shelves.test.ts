/** The home page shelves: picks, hot, new this week, and lists made by people. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import * as projects from '../src/repo/projects.js'
import { hotScore } from '../src/repo/shelves.js'
import * as versions from '../src/repo/versions.js'
import { harness, type Harness } from './helpers.js'

const DEMO = 'zoom-transcripts-to-nvivo'
const DAY = 24 * 60 * 60 * 1000

let h: Harness
let app: Awaited<ReturnType<typeof buildApp>>
let maker: { id: string; cookie: string }

beforeEach(async () => {
  h = await harness()
  app = await buildApp({ db: h.db, analyzer: h.analyzer, storage: h.storage, factory: h.factory, mailer: h.mailer, teamEmails: ['team@simplyopen.example'] })
  maker = await h.signIn('maker@example.com', 'Marcus')
  // The seeded demo is old news, so each test decides what is new.
  await h.db.query("update projects set created_at = now() - interval '90 days' where slug = $1", [DEMO])
})
afterEach(async () => {
  await app.close()
  await h.close()
})

/** A project with one version, shared `daysAgo` days ago. */
async function make(slug: string, daysAgo = 0, visibility: 'public' | 'link' | 'private' = 'public') {
  const project = await projects.create(h.db, { owner: maker.id, slug, name: slug, visibility })
  await versions.append(h.db, { project_id: project.id, note: 'First version.', created_by: maker.id })
  await h.db.query('update projects set created_at = $2 where id = $1', [project.id, new Date(Date.now() - daysAgo * DAY).toISOString()])
  return project
}

/** `count` different people star (and optionally copy) a project, `daysAgo` days ago. */
async function react(slug: string, count: number, kind: 'star' | 'copy', daysAgo = 0) {
  for (let i = 0; i < count; i += 1) {
    const who = await h.signIn(`${kind}-${slug}-${i}-${daysAgo}@example.com`)
    await app.inject({ method: 'POST', url: `/api/projects/${slug}/${kind === 'star' ? 'star' : 'copies'}`, headers: { cookie: who.cookie }, payload: {} })
  }
  const when = new Date(Date.now() - daysAgo * DAY).toISOString()
  const table = kind === 'star' ? 'stars' : 'copies'
  await h.db.query(`update ${table} set created_at = $2 where project_id = (select id from projects where slug = $1) and created_at > now() - interval '1 minute'`, [slug, when])
}

const shelves = async () => (await app.inject({ method: 'GET', url: '/api/shelves' })).json() as {
  picks: { slug: string }[]; hot: { slug: string }[]; new_this_week: { slug: string }[]; lists: { id: string; name: string; owner_name: string; projects: number; preview: { slug: string }[] }[]
}
const slugs = (cards: { slug: string }[]): string[] => cards.map((c) => c.slug)
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, ...(cookie ? { headers: { cookie } } : {}), ...(payload ? { payload } : {}) })

describe('the home page', () => {
  it('comes in one call, needs no account, and a card says what the page shows', async () => {
    await make('photo-captions')
    await react('photo-captions', 2, 'star')
    await react('photo-captions', 1, 'copy')
    const reply = await app.inject({ method: 'GET', url: '/api/shelves' })
    expect(reply.statusCode).toBe(200)
    expect(Object.keys(reply.json())).toEqual(['picks', 'hot', 'new_this_week', 'lists'])
    expect(reply.json().new_this_week[0]).toEqual({
      slug: 'photo-captions', name: 'photo-captions', description: '', owner_name: 'Marcus',
      stars: 2, copies: 1, checked: false, network_access: false,
      created_at: expect.any(String), updated_at: expect.any(String),
    })
  })

  it('only public projects ever show, on every shelf', async () => {
    await make('open')
    await make('by-link', 0, 'link')
    await make('secret', 0, 'private')
    const all = await shelves()
    expect(slugs(all.new_this_week)).toEqual(['open'])
    expect(slugs(all.hot)).toEqual(['open'])
  })
})

describe('new this week', () => {
  it('lists what was shared in the last seven days, newest first', async () => {
    await make('six-days', 6)
    await make('today', 0)
    await make('eight-days', 8)
    await make('yesterday', 1)
    expect(slugs((await shelves()).new_this_week)).toEqual(['today', 'yesterday', 'six-days'])
  })
})

describe('hot', () => {
  it('ranks by what people did this week, fading with age', async () => {
    await make('quiet-new', 0) // brand new, nobody has reacted
    await make('loved-new', 1) // a day old, five stars this week
    await make('loved-older', 20) // older, the same five stars this week
    await make('old-fame', 25) // many stars, but all long ago
    await react('loved-new', 5, 'star')
    await react('loved-older', 5, 'star')
    await react('old-fame', 9, 'star', 15)
    expect(slugs((await shelves()).hot)).toEqual(['loved-new', 'quiet-new', 'loved-older', 'old-fame'])
  })

  it('a project older than thirty days is not "new" any more, however loved', async () => {
    await make('veteran', 31)
    await react('veteran', 6, 'star')
    await make('newcomer', 2)
    expect(slugs((await shelves()).hot)).toEqual(['newcomer'])
  })

  it('the score: stars count a little more than copies, and age pulls it down', () => {
    expect(hotScore(0, 0, 0)).toBeCloseTo(1 / 2 ** 1.5)
    expect(hotScore(1, 0, 3)).toBeGreaterThan(hotScore(0, 1, 3))
    expect(hotScore(0, 2, 3)).toBeGreaterThan(hotScore(1, 0, 3))
    expect(hotScore(4, 0, 1)).toBeGreaterThan(hotScore(4, 0, 2))
    expect(hotScore(1, 1, 0)).toBeCloseTo(6 / 2 ** 1.5)
  })
})

describe('picks from the team', () => {
  let team: { id: string; cookie: string }
  beforeEach(async () => {
    team = await h.signIn('team@simplyopen.example', 'Team')
    // The test sign in skips the emailed link's route, which is what marks an address as proved.
    await h.db.query('update users set email_verified_at = now() where id = $1', [team.id])
  })

  it('the team chooses them and their order', async () => {
    for (const slug of ['a', 'b', 'c']) await make(slug, 40)
    for (const slug of ['a', 'b', 'c']) expect((await send('PUT', `/api/picks/${slug}`, team.cookie)).statusCode).toBe(200)
    expect(slugs((await shelves()).picks)).toEqual(['a', 'b', 'c'])

    await send('PUT', '/api/picks/c', team.cookie, { position: 0 })
    expect(slugs((await shelves()).picks)).toEqual(['c', 'a', 'b'])
    await send('DELETE', '/api/picks/a', team.cookie)
    expect(slugs((await shelves()).picks)).toEqual(['c', 'b'])
  })

  it('nobody else can', async () => {
    await make('a')
    expect((await send('PUT', '/api/picks/a')).statusCode).toBe(401)
    expect([(await send('PUT', '/api/picks/a', maker.cookie)).statusCode, (await send('DELETE', '/api/picks/a', maker.cookie)).json().error.code]).toEqual([403, 'TEAM_ONLY'])
    expect((await shelves()).picks).toEqual([])
  })

  it('signing up with a team address is not enough: the address must be proved', async () => {
    // A stranger signs up with a password under another team address they do not own.
    const second = await buildApp({ db: h.db, analyzer: h.analyzer, storage: h.storage, factory: h.factory, mailer: h.mailer, teamEmails: ['boss@simplyopen.example'] })
    const made = await second.inject({ method: 'POST', url: '/api/auth/sign-up', payload: { username: 'sneaky', email: 'boss@simplyopen.example', password: 'a long password' } })
    const cookie = String(made.headers['set-cookie']).split(';')[0]!
    await make('a')
    expect((await second.inject({ method: 'PUT', url: '/api/picks/a', headers: { cookie } })).statusCode).toBe(403)
    await second.close()
  })

  it('only a public project can be picked, and it leaves the shelf if it stops being public', async () => {
    await make('hidden', 0, 'private')
    expect((await send('PUT', '/api/picks/hidden', team.cookie)).statusCode).toBe(404)
    await make('shown')
    await send('PUT', '/api/picks/shown', team.cookie)
    await h.db.query("update projects set visibility = 'private' where slug = 'shown'")
    expect((await shelves()).picks).toEqual([])
    expect((await send('PUT', '/api/picks/shown', team.cookie, { position: 1.5 })).statusCode).toBe(404)
  })

  it('a position must be a whole number', async () => {
    await make('a')
    expect((await send('PUT', '/api/picks/a', team.cookie, { position: 'first' })).json().error.code).toBe('BAD_POSITION')
  })
})

describe('the team row on browse', () => {
  const browse = async () =>
    ((await app.inject({ method: 'GET', url: '/api/browse' })).json() as { projects: { slug: string; featured: boolean }[] }).projects
  const featured = async () => (await browse()).filter((p) => p.featured).map((p) => p.slug)

  /** A project with one version, made by `owner`. */
  async function makeBy(owner: string, slug: string, visibility: 'public' | 'private' = 'public') {
    const project = await projects.create(h.db, { owner, slug, name: slug, visibility })
    await versions.append(h.db, { project_id: project.id, note: 'First version.', created_by: owner })
  }

  it('everything someone on the team shares is on it, with no picking needed, and only public things', async () => {
    const team = await h.signIn('Team@SimplyOpen.example', 'Tess')
    await h.db.query('update users set email_verified_at = now() where id = $1', [team.id])
    await makeBy(team.id, 'ours')
    await makeBy(team.id, 'ours-hidden', 'private')
    await make('theirs')
    expect(await featured()).toEqual(['ours'])
    expect((await browse()).map((p) => p.slug)).not.toContain('ours-hidden')
  })

  it('an address only counts once its owner has proved it', async () => {
    const made = await app.inject({ method: 'POST', url: '/api/auth/sign-up', payload: { username: 'sneaky', email: 'team@simplyopen.example', password: 'a long password' } })
    await makeBy(made.json().user.id, 'sneaky-thing')
    expect(await featured()).toEqual([])
  })

  it('a team pick is on it too, whoever made it', async () => {
    const team = await h.signIn('team@simplyopen.example', 'Tess')
    await h.db.query('update users set email_verified_at = now() where id = $1', [team.id])
    await make('theirs')
    await send('PUT', '/api/picks/theirs', team.cookie)
    expect(await featured()).toEqual(['theirs'])
  })
})

describe('lists made by people', () => {
  let priya: { id: string; cookie: string }
  let listId: string
  beforeEach(async () => {
    priya = await h.signIn('priya@example.com', 'Priya')
    for (const slug of ['one', 'two', 'three', 'four']) await make(slug, 50)
    listId = (await send('POST', '/api/lists', priya.cookie, { name: '  Research   helpers ' })).json().list.id
  })

  it('anyone signed in can make a list and fill it; it shows with its maker, size and a peek', async () => {
    expect((await shelves()).lists).toEqual([]) // an empty list is not shown
    for (const slug of ['one', 'two', 'three', 'four', 'one']) await send('PUT', `/api/lists/${listId}/projects/${slug}`, priya.cookie)
    expect((await shelves()).lists).toEqual([
      { id: listId, name: 'Research helpers', owner_name: 'Priya', projects: 4, preview: [{ slug: 'one', name: 'one' }, { slug: 'two', name: 'two' }, { slug: 'three', name: 'three' }] },
    ])
    const page = (await app.inject({ method: 'GET', url: `/api/lists/${listId}` })).json()
    expect([page.list.name, slugs(page.projects), page.can_edit]).toEqual(['Research helpers', ['one', 'two', 'three', 'four'], false])
    expect((await app.inject({ method: 'GET', url: `/api/lists/${listId}`, headers: { cookie: priya.cookie } })).json().can_edit).toBe(true)
  })

  it('projects can be taken out, and the list deleted', async () => {
    await send('PUT', `/api/lists/${listId}/projects/one`, priya.cookie)
    await send('PUT', `/api/lists/${listId}/projects/two`, priya.cookie)
    expect(slugs((await send('DELETE', `/api/lists/${listId}/projects/one`, priya.cookie)).json().projects)).toEqual(['two'])
    expect((await send('DELETE', `/api/lists/${listId}`, priya.cookie)).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/api/lists/${listId}` })).statusCode).toBe(404)
  })

  it('only its maker can change a list', async () => {
    await send('PUT', `/api/lists/${listId}/projects/one`, priya.cookie)
    for (const reply of [
      await send('PUT', `/api/lists/${listId}/projects/two`, maker.cookie),
      await send('DELETE', `/api/lists/${listId}/projects/one`, maker.cookie),
      await send('DELETE', `/api/lists/${listId}`, maker.cookie),
    ]) expect([reply.statusCode, reply.json().error.code]).toEqual([403, 'NOT_YOUR_LIST'])
    expect((await send('PUT', `/api/lists/${listId}/projects/two`)).statusCode).toBe(401)
    expect((await shelves()).lists[0]!.projects).toBe(1)
  })

  it('a private project cannot be added, and one that turns private drops out of sight', async () => {
    await make('secret', 0, 'private')
    expect((await send('PUT', `/api/lists/${listId}/projects/secret`, priya.cookie)).statusCode).toBe(404)
    await send('PUT', `/api/lists/${listId}/projects/one`, priya.cookie)
    await send('PUT', `/api/lists/${listId}/projects/two`, priya.cookie)
    await h.db.query("update projects set visibility = 'private' where slug = 'one'")
    expect((await shelves()).lists[0]).toMatchObject({ projects: 1, preview: [{ slug: 'two' }] })
    expect(slugs((await app.inject({ method: 'GET', url: `/api/lists/${listId}` })).json().projects)).toEqual(['two'])
  })

  it('a list needs a name of a sensible length, and an id that is an id', async () => {
    expect((await send('POST', '/api/lists', priya.cookie, { name: '  ' })).json().error.code).toBe('NO_NAME')
    expect((await send('POST', '/api/lists', priya.cookie, { name: 'x'.repeat(61) })).json().error.code).toBe('NAME_TOO_LONG')
    expect((await send('POST', '/api/lists', undefined, { name: 'Mine' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/lists/not-an-id' })).statusCode).toBe(404)
  })
})

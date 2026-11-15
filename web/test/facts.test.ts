/** The facts around a project: counts, systems, what it touches, and "you". */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { harness, manifest, type Harness } from './helpers.js'
import { touchesFrom } from '../src/repo/facts.js'
import * as builds from '../src/repo/builds.js'
import * as projects from '../src/repo/projects.js'
import * as versions from '../src/repo/versions.js'

let h: Harness
beforeEach(async () => { h = await harness() })
afterEach(async () => { await h.close() })

const DEMO = 'zoom-transcripts-to-nvivo' // seeded: public, five versions, three ready builds each

const facts = (slug: string, cookie?: string) =>
  h.app.inject({ method: 'GET', url: `/api/projects/${slug}/facts`, ...(cookie ? { headers: { cookie } } : {}) })

describe('project facts', () => {
  it('counts stars, copies and versions, and lists the systems, with no account needed', async () => {
    const [a, b] = [await h.signIn('a@example.com'), await h.signIn('b@example.com')]
    for (const who of [a, b]) await h.app.inject({ method: 'POST', url: `/api/projects/${DEMO}/star`, headers: { cookie: who.cookie } })
    await h.app.inject({ method: 'POST', url: `/api/projects/${DEMO}/copies`, headers: { cookie: a.cookie }, payload: {} })

    const reply = await facts(DEMO)
    expect(reply.statusCode).toBe(200)
    expect(reply.json()).toMatchObject({
      stars: 2,
      copies: 1,
      versions: 5,
      waiting_suggestions: 0,
      latest_version: { number: 5 },
      systems: [
        { platform: 'mac', status: 'ready', size_bytes: 25165824 },
        { platform: 'windows', status: 'ready', size_bytes: 25165824 },
        { platform: 'linux', status: 'ready', size_bytes: 25165824 },
      ],
      checked: true,
      touches: null, // the seeded check has no manifest, so nothing is claimed
      you: null,
    })
    expect(reply.json().updated_at).toBe(reply.json().latest_version.created_at)
  })

  it('tells a signed in person what is theirs: star, copies, ownership', async () => {
    const a = await h.signIn('a@example.com')
    expect((await facts(DEMO, a.cookie)).json().you).toEqual({ starred: false, copy_ids: [], is_owner: false })

    await h.app.inject({ method: 'POST', url: `/api/projects/${DEMO}/star`, headers: { cookie: a.cookie } })
    const copy = (await h.app.inject({ method: 'POST', url: `/api/projects/${DEMO}/copies`, headers: { cookie: a.cookie }, payload: {} })).json().copy
    expect((await facts(DEMO, a.cookie)).json().you).toEqual({ starred: true, copy_ids: [copy.id], is_owner: false })
    // Someone else's star and copy are not yours.
    expect((await facts(DEMO, (await h.signIn('b@example.com')).cookie)).json().you).toEqual({ starred: false, copy_ids: [], is_owner: false })
  })

  it('a star can be taken back, once', async () => {
    const a = await h.signIn('a@example.com')
    const star = { url: `/api/projects/${DEMO}/star`, headers: { cookie: a.cookie } }
    // Someone else stars it too: taking yours back must leave theirs.
    await h.app.inject({ method: 'POST', url: star.url, headers: { cookie: (await h.signIn('b@example.com')).cookie } })
    expect((await h.app.inject({ method: 'POST', ...star })).json()).toEqual({ stars: 2 })
    expect((await h.app.inject({ method: 'DELETE', ...star })).json()).toEqual({ stars: 1 })
    expect((await h.app.inject({ method: 'DELETE', ...star })).json()).toEqual({ stars: 1 })
    expect((await h.app.inject({ method: 'DELETE', url: star.url })).statusCode).toBe(401)
  })

  it('a private project answers like one that does not exist, except to its owner', async () => {
    const owner = await h.signIn('owner@example.com')
    const project = await projects.create(h.db, { owner: owner.id, slug: 'secret', name: 'Secret', visibility: 'private' })
    await versions.append(h.db, { project_id: project.id, note: 'First version.', created_by: owner.id })

    const stranger = await h.signIn('stranger@example.com')
    for (const reply of [await facts('secret'), await facts('secret', stranger.cookie), await facts('no-such-project')]) {
      expect([reply.statusCode, reply.json()]).toEqual([404, { error: { code: 'NO_SUCH_PROJECT', message: 'There is nothing here.' } }])
    }
    expect((await h.app.inject({ method: 'DELETE', url: '/api/projects/secret/star', headers: { cookie: stranger.cookie } })).statusCode).toBe(404)
    // It has never been checked, so it is not "checked" and nothing is said about what it touches.
    expect((await facts('secret', owner.cookie)).json()).toMatchObject({ versions: 1, checked: false, touches: null, systems: [], you: { is_owner: true } })
  })

  it('reads what it touches from the latest version\'s manifest', async () => {
    const owner = await h.signIn('owner@example.com')
    const project = await projects.create(h.db, { owner: owner.id, slug: 'touchy', name: 'Touchy', visibility: 'public' })
    const version = await versions.append(h.db, { project_id: project.id, note: 'First version.', created_by: owner.id })
    await builds.recordCheck(h.db, {
      version_id: version.id,
      status: 'passed',
      summary: '',
      manifest: manifest({
        inputs: [{ kind: 'file', label: 'Zoom transcripts' }, { kind: 'text', label: 'Name for the set' }],
        outputs: [{ kind: 'folder', label: 'NVivo files' }, { kind: 'console', label: 'Progress' }],
      }),
      network_access: false,
      operating_systems: ['macos'],
      confidence: 'high',
    })
    expect((await facts('touchy')).json().touches).toEqual({
      reads: ['Zoom transcripts'],
      saves: ['NVivo files'],
      internet: false,
      other: { runs_other_programs: false, reads_settings: [], reaches_other_files: false },
    })
  })
})

describe('touchesFrom', () => {
  it('reports each thing a manifest says it touches', () => {
    const m = manifest({
      capabilities: { network_access: true, filesystem_access: 'broad', reads_env_vars: ['API_KEY'], runs_other_programs: true },
    })
    expect(touchesFrom(m, true)).toEqual({
      reads: [],
      saves: [],
      internet: true,
      other: { runs_other_programs: true, reads_settings: ['API_KEY'], reaches_other_files: true },
    })
  })

  it('the internet is on if either the manifest or the lifted column says so', () => {
    const off = manifest()
    expect(touchesFrom(off, false).internet).toBe(false)
    expect(touchesFrom(off, true).internet).toBe(true)
    expect(touchesFrom(manifest({ capabilities: { network_access: true } }), false).internet).toBe(true)
  })

  it.each([[null], ['nonsense'], [{}], [{ capabilities: 'x', inputs: 'y', outputs: [1, null, { kind: 'file' }] }]])(
    'an unclear manifest (%j) never claims "nothing else"',
    (broken) => {
      expect(touchesFrom(broken, false)).toEqual({
        reads: [],
        saves: [],
        internet: false,
        other: { runs_other_programs: true, reads_settings: [], reaches_other_files: true },
      })
    },
  )
})

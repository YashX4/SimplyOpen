import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { harness, SOME_ZIP, type Harness } from './helpers.js'
import { publish, refresh } from '../src/services/pipeline.js'
import { platformFromName, statusFromJob } from '../src/services/factory.js'
import * as projects from '../src/repo/projects.js'

let h: Harness
beforeEach(async () => { h = await harness() })
afterEach(async () => { await h.close() })

const deps = () => ({ db: h.db, analyzer: h.analyzer, storage: h.storage, factory: h.factory })

async function published() {
  const me = await h.signIn('maker@example.com', 'Maker')
  const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
  await projects.setVisibility(h.db, made.project.id, 'public')
  h.factory.state = {
    found: true, finished: true,
    platforms: [
      { platform: 'mac', status: 'ready', message: '' },
      { platform: 'windows', status: 'failed', message: 'The build did not finish on this system.' },
      { platform: 'linux', status: 'ready', message: '' },
    ],
    artifacts: [
      { platform: 'mac', name: 'app-Mac', id: 11, size: 24 },
      { platform: 'linux', name: 'app-Linux', id: 13, size: 24 },
    ],
  }
  await refresh(deps(), made.version.id)
  return { me, made }
}

describe('getting the app', () => {
  it('sends a stranger straight to the file, with no account', async () => {
    const { made } = await published()
    const response = await h.app.inject({
      method: 'GET', url: `/api/download/${made.version.id}/mac`,
    })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toContain('mac.zip')
  })

  it('explains itself when that system has no build', async () => {
    const { made } = await published()
    const response = await h.app.inject({
      method: 'GET', url: `/api/download/${made.version.id}/windows`,
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toContain('did not finish')
  })

  it('turns down a system that does not exist', async () => {
    const { made } = await published()
    const response = await h.app.inject({
      method: 'GET', url: `/api/download/${made.version.id}/amiga`,
    })
    expect(response.statusCode).toBe(400)
  })

  it('will not hand out a private project to a stranger', async () => {
    const { me, made } = await published()
    await projects.setVisibility(h.db, made.project.id, 'private')
    const stranger = await h.app.inject({
      method: 'GET', url: `/api/download/${made.version.id}/mac`,
    })
    expect(stranger.statusCode).toBe(404)
    const owner = await h.app.inject({
      method: 'GET', url: `/api/download/${made.version.id}/mac`, headers: { cookie: me.cookie },
    })
    expect(owner.statusCode).toBe(302)
  })

  it('tells the publish flow which ending to show', async () => {
    const { made } = await published()
    const response = await h.app.inject({ method: 'GET', url: `/api/versions/${made.version.id}/outcome` })
    expect(response.json().outcome).toBe('partial')
  })
})

describe('reading GitHub', () => {
  it('works out the system from a job or artifact name', () => {
    expect(platformFromName('Build for Mac')).toBe('mac')
    expect(platformFromName('app-Windows')).toBe('windows')
    expect(platformFromName('Build for Linux')).toBe('linux')
    expect(platformFromName('something else')).toBeNull()
  })

  it('turns GitHub words into ours', () => {
    expect(statusFromJob('queued', null)).toBe('waiting')
    expect(statusFromJob('in_progress', null)).toBe('building')
    expect(statusFromJob('completed', 'success')).toBe('ready')
    expect(statusFromJob('completed', 'failure')).toBe('failed')
    expect(statusFromJob('completed', 'cancelled')).toBe('failed')
  })
})

describe('an app too big for the object store', () => {
  it('stays with the Factory, and the download route passes it on', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    await projects.setVisibility(h.db, made.project.id, 'public')

    const TOO_BIG = 120 * 1024 * 1024
    h.factory.state = {
      found: true, finished: true,
      platforms: [{ platform: 'mac', status: 'ready', message: '' }],
      artifacts: [{ platform: 'mac', name: 'app-Mac', id: 77, size: TOO_BIG }],
    }
    await refresh(deps(), made.version.id)

    // Nothing was copied, so nothing was downloaded during the refresh.
    expect(h.factory.downloads).toEqual([])
    expect(h.storage.files.has(`apps/${made.version.build_id}/mac.zip`)).toBe(false)

    const response = await h.app.inject({
      method: 'GET', url: `/api/download/${made.version.id}/mac`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/zip')
    expect(response.headers['content-disposition']).toContain('mac.zip')
    expect(h.factory.downloads).toEqual([77])
  })

  const RELEASE = 'https://github.com/o/r/releases/download/build-x/app-mac.zip'

  it('sends the person to the public release file when the run published one', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    await projects.setVisibility(h.db, made.project.id, 'public')
    h.factory.state = {
      found: true, finished: true,
      platforms: [{ platform: 'mac', status: 'ready', message: '' }],
      artifacts: [{ platform: 'mac', name: 'app-Mac', id: 79, size: 120 * 1024 * 1024 }],
      releases: [{ platform: 'mac', url: RELEASE, size: 120 * 1024 * 1024 }],
    }
    await refresh(deps(), made.version.id)

    const response = await h.app.inject({ method: 'GET', url: `/api/download/${made.version.id}/mac` })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(RELEASE)
    // Neither the refresh nor the download fetched the app through us.
    expect(h.factory.downloads).toEqual([])
  })

  it('moves an app that was being streamed over to its release file', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    await projects.setVisibility(h.db, made.project.id, 'public')
    const big = {
      found: true, finished: true,
      platforms: [{ platform: 'mac' as const, status: 'ready' as const, message: '' }],
      artifacts: [{ platform: 'mac' as const, name: 'app-Mac', id: 80, size: 120 * 1024 * 1024 }],
    }
    h.factory.state = big
    await refresh(deps(), made.version.id)

    h.factory.state = { ...big, releases: [{ platform: 'mac', url: RELEASE, size: 1 }] }
    await refresh(deps(), made.version.id)
    const response = await h.app.inject({ method: 'GET', url: `/api/download/${made.version.id}/mac` })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(RELEASE)
    expect(h.factory.downloads).toEqual([])
  })

  it('still copies one that fits, and redirects to it', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    await projects.setVisibility(h.db, made.project.id, 'public')
    h.factory.state = {
      found: true, finished: true,
      platforms: [{ platform: 'mac', status: 'ready', message: '' }],
      artifacts: [{ platform: 'mac', name: 'app-Mac', id: 78, size: 1024 }],
    }
    await refresh(deps(), made.version.id)
    const response = await h.app.inject({
      method: 'GET', url: `/api/download/${made.version.id}/mac`,
    })
    expect(response.statusCode).toBe(302)
    expect(h.factory.downloads).toEqual([78])
  })
})

describe('checking a download before it starts', () => {
  it('says plainly when a ready build points at a file that is not there', async () => {
    const { harness } = await import('./helpers.js')
    const h = await harness()
    try {
      const page = await h.app.inject({ method: 'GET', url: '/api/projects/zoom-transcripts-to-nvivo' })
      const id = page.json().version.id as string
      // The seeded builds point at an address that does not exist.
      const res = await h.app.inject({ method: 'GET', url: `/api/download/${id}/mac/check` })
      expect(res.json().ok).toBe(false)
      expect(res.json().reason).toMatch(/missing/)
      const bad = await h.app.inject({ method: 'GET', url: `/api/download/${id}/amiga/check` })
      expect(bad.json().ok).toBe(false)
    } finally { await h.close() }
  })
})

describe('the picture of the app window', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

  it('is collected once the run finishes, and shows on the page and in browse', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    await projects.setVisibility(h.db, made.project.id, 'public')
    const real = h.factory.download.bind(h.factory)
    h.factory.download = async (id: number) => (id === 90 ? PNG : real(id))

    // Not while the run is still going.
    h.factory.state = { found: true, finished: false, platforms: [], artifacts: [], picture: { id: 90, size: 12 } }
    await refresh(deps(), made.version.id)
    expect((await h.app.inject({ method: 'GET', url: `/api/projects/${made.project.slug}` })).json().version.picture_url).toBeFalsy()

    h.factory.state = { ...h.factory.state, finished: true }
    await refresh(deps(), made.version.id)
    const page = await h.app.inject({ method: 'GET', url: `/api/projects/${made.project.slug}` })
    expect(page.json().version.picture_url).toMatch(/window\.png$/)
    const browse = await h.app.inject({ method: 'GET', url: '/api/browse' })
    const mine = browse.json().projects.find((p: { slug: string }) => p.slug === made.project.slug)
    expect(mine.picture_url).toMatch(/window\.png$/)
  })

  it('is left out, quietly, when it is not a picture', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    h.factory.state = { found: true, finished: true, platforms: [], artifacts: [], picture: { id: 91, size: 12 } }
    await refresh(deps(), made.version.id)
    const page = await h.app.inject({ method: 'GET', url: `/api/projects/${made.project.slug}`, headers: { cookie: me.cookie } })
    expect(page.json().version.picture_url).toBeFalsy()
  })
})

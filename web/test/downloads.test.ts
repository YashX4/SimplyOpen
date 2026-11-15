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

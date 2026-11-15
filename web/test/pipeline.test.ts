import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { FakeAnalyzer, harness, manifest, multipartBody, SOME_ZIP, type Harness } from './helpers.js'
import { AnalyzerError } from '../src/services/analyzer.js'
import * as builds from '../src/repo/builds.js'
import * as versions from '../src/repo/versions.js'
import { publish, refresh } from '../src/services/pipeline.js'

let h: Harness
beforeEach(async () => { h = await harness() })
afterEach(async () => { await h.close() })

const deps = () => ({ db: h.db, analyzer: h.analyzer, storage: h.storage, factory: h.factory })

describe('uploading something you made', () => {
  it('stores the zip, reads it, makes a private project and starts a build', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const result = await publish(deps(), { owner: me.id, zip: SOME_ZIP })

    expect(result.project.visibility).toBe('private')
    expect(result.project.slug).toBe('zoom-transcripts-to-nvivo-2')
    expect(result.version.number).toBe(1)
    expect(result.version.note).toBe('First version.')

    // The zip and the manifest both have to be fetchable, because the
    // Factory does a plain fetch on each.
    expect([...h.storage.files.keys()].some((k) => k.endsWith('project.zip'))).toBe(true)
    expect([...h.storage.files.keys()].some((k) => k.endsWith('app.json'))).toBe(true)

    expect(h.factory.dispatched).toHaveLength(1)
    expect(h.factory.dispatched[0]!.buildId).toBe(result.version.build_id)
    expect(h.factory.dispatched[0]!.projectUrl).toContain('project.zip')
    expect(h.factory.dispatched[0]!.appUrl).toContain('app.json')
  })

  it('opens one build row per system, all waiting', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const result = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    expect(result.builds.map((b) => b.platform)).toEqual(['mac', 'windows', 'linux'])
    expect(result.builds.every((b) => b.status === 'waiting')).toBe(true)
    expect(builds.outcome(result.builds)).toBe('waiting')
  })

  it('lifts the three manifest facts into columns', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const result = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    const check = await builds.checkFor(h.db, result.version.id)
    expect(check?.network_access).toBe(false)
    expect(check?.confidence).toBe('high')
    expect(check?.operating_systems).toEqual(['macos', 'windows', 'linux'])
    expect(check?.manifest).toMatchObject({ project_kind: 'app_or_tool' })
  })

  it('marks a system the project never claimed as one that cannot be built', async () => {
    const macOnly = new FakeAnalyzer({
      manifest: manifest({ dependencies: { operating_systems: ['macos'] } }),
      name: 'Mac only thing',
      description: 'Only ever worked on a Mac.',
    })
    const me = await h.signIn('maker@example.com', 'Maker')
    const result = await publish({ ...deps(), analyzer: macOnly }, { owner: me.id, zip: SOME_ZIP })
    const byPlatform = Object.fromEntries(result.builds.map((b) => [b.platform, b.status]))
    expect(byPlatform).toEqual({ mac: 'waiting', windows: 'cannot', linux: 'cannot' })
  })

  it('says a simple window is coming when the analyzer was not sure', async () => {
    const unsure = new FakeAnalyzer({
      manifest: manifest({ confidence: { overall: 'low', notes: ['Options come from a settings file.'] } }),
      name: 'Hard to read',
      description: 'We could not work out the choices.',
    })
    const me = await h.signIn('maker@example.com', 'Maker')
    const result = await publish({ ...deps(), analyzer: unsure }, { owner: me.id, zip: SOME_ZIP })
    expect(result.simpleWindow).toBe(true)
  })

  it('turns a zip it cannot open into something a person can read', async () => {
    const broken = new FakeAnalyzer(
      new AnalyzerError('That does not look like a zip we can open.', 422, 'UnzipError'),
    )
    const me = await h.signIn('maker@example.com', 'Maker')
    await expect(
      publish({ ...deps(), analyzer: broken }, { owner: me.id, zip: SOME_ZIP }),
    ).rejects.toMatchObject({ code: 'CANNOT_READ', status: 422 })
  })

  it('takes the upload over HTTP too, and needs a session to do it', async () => {
    const body = multipartBody(
      { field: 'file', filename: 'project.zip', bytes: SOME_ZIP },
      { name: 'My thing' },
    )
    const out = await h.app.inject({
      method: 'POST', url: '/api/projects', headers: body.headers, payload: body.payload,
    })
    expect(out.statusCode).toBe(401)

    const me = await h.signIn('maker@example.com', 'Maker')
    const signedIn = await h.app.inject({
      method: 'POST', url: '/api/projects',
      headers: { ...body.headers, cookie: me.cookie }, payload: body.payload,
    })
    expect(signedIn.statusCode).toBe(201)
    expect(signedIn.json().project.name).toBe('My thing')
    expect(signedIn.json().builds).toHaveLength(3)
  })
})

describe('watching the build', () => {
  it('moves each system along on its own, and keeps the partial case', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })

    h.factory.state = {
      found: true, finished: false, artifacts: [],
      platforms: [
        { platform: 'mac', status: 'ready', message: '' },
        { platform: 'windows', status: 'building', message: '' },
        { platform: 'linux', status: 'ready', message: '' },
      ],
    }
    const mid = await refresh(deps(), made.version.id)
    expect(mid.outcome).toBe('waiting')

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
    const done = await refresh(deps(), made.version.id)
    expect(done.outcome).toBe('partial')

    const byPlatform = Object.fromEntries(done.builds.map((b) => [b.platform, b]))
    expect(byPlatform.mac!.download_url).toContain('mac.zip')
    expect(byPlatform.linux!.download_url).toContain('linux.zip')
    expect(byPlatform.windows!.download_url).toBeNull()
    expect(byPlatform.windows!.message).toContain('did not finish')
  })

  it('collects each built app once, not on every poll', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    h.factory.state = {
      found: true, finished: true,
      platforms: [{ platform: 'mac', status: 'ready', message: '' }],
      artifacts: [{ platform: 'mac', name: 'app-Mac', id: 11, size: 24 }],
    }
    await refresh(deps(), made.version.id)
    await refresh(deps(), made.version.id)
    await refresh(deps(), made.version.id)
    expect(h.factory.downloads).toEqual([11])
  })

  it('never promotes a system the project said it cannot run on', async () => {
    const macOnly = new FakeAnalyzer({
      manifest: manifest({ dependencies: { operating_systems: ['macos'] } }),
      name: 'Mac only thing', description: '',
    })
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish({ ...deps(), analyzer: macOnly }, { owner: me.id, zip: SOME_ZIP })
    h.factory.state = {
      found: true, finished: true, artifacts: [],
      platforms: [
        { platform: 'mac', status: 'ready', message: '' },
        { platform: 'windows', status: 'ready', message: '' },
      ],
    }
    const after = await refresh(deps(), made.version.id)
    const byPlatform = Object.fromEntries(after.builds.map((b) => [b.platform, b.status]))
    expect(byPlatform.windows).toBe('cannot')
    expect(after.outcome).toBe('partial')
  })

  it('copes with a run GitHub has not started yet', async () => {
    const me = await h.signIn('maker@example.com', 'Maker')
    const made = await publish(deps(), { owner: me.id, zip: SOME_ZIP })
    const state = await refresh(deps(), made.version.id)
    expect(state.found).toBe(false)
    expect(state.builds).toHaveLength(3)
  })
})

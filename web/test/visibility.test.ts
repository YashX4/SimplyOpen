import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { harness, type Harness } from './helpers.js'
import * as projects from '../src/repo/projects.js'

let h: Harness
beforeEach(async () => { h = await harness() })
afterEach(async () => { await h.close() })

async function make(visibility: 'private' | 'link' | 'public', slug: string, owner: string) {
  const project = await projects.create(h.db, { owner, slug, name: slug, visibility })
  const { default: versions } = { default: await import('../src/repo/versions.js') }
  await versions.append(h.db, { project_id: project.id, note: 'First version.', created_by: owner })
  return project
}

describe('who can see what', () => {
  it('browse lists public projects only', async () => {
    const me = await h.signIn('a@example.com', 'A')
    await make('private', 'mine-private', me.id)
    await make('link', 'mine-link', me.id)
    await make('public', 'mine-public', me.id)

    const response = await h.app.inject({ method: 'GET', url: '/api/browse' })
    const slugs = response.json().projects.map((p: { slug: string }) => p.slug)
    expect(slugs).toContain('mine-public')
    expect(slugs).toContain('zoom-transcripts-to-nvivo')
    expect(slugs).not.toContain('mine-private')
    expect(slugs).not.toContain('mine-link')
  })

  it('a link project opens for a stranger but never appears in search', async () => {
    const me = await h.signIn('a@example.com', 'A')
    await make('link', 'quiet-thing', me.id)

    const page = await h.app.inject({ method: 'GET', url: '/api/projects/quiet-thing' })
    expect(page.statusCode).toBe(200)

    const found = await h.app.inject({ method: 'GET', url: '/api/search?q=quiet' })
    expect(found.json().projects).toHaveLength(0)
  })

  it('a private project is a 404 to everyone but its owner', async () => {
    const me = await h.signIn('a@example.com', 'A')
    const them = await h.signIn('b@example.com', 'B')
    await make('private', 'just-mine', me.id)

    const stranger = await h.app.inject({ method: 'GET', url: '/api/projects/just-mine' })
    expect(stranger.statusCode).toBe(404)

    const other = await h.app.inject({
      method: 'GET', url: '/api/projects/just-mine', headers: { cookie: them.cookie },
    })
    expect(other.statusCode).toBe(404)

    const owner = await h.app.inject({
      method: 'GET', url: '/api/projects/just-mine', headers: { cookie: me.cookie },
    })
    expect(owner.statusCode).toBe(200)
    expect(owner.json().can_edit).toBe(true)
  })

  it('says 404 rather than 403 for a private project, so a slug cannot be fished for', async () => {
    const me = await h.signIn('a@example.com', 'A')
    await make('private', 'secret-one', me.id)
    const guess = await h.app.inject({ method: 'GET', url: '/api/projects/secret-one' })
    const nothing = await h.app.inject({ method: 'GET', url: '/api/projects/no-such-thing' })
    expect(guess.statusCode).toBe(nothing.statusCode)
    expect(guess.json().error.code).toBe(nothing.json().error.code)
  })

  it('only the owner can change who can see it', async () => {
    const me = await h.signIn('a@example.com', 'A')
    const them = await h.signIn('b@example.com', 'B')
    await make('private', 'mine-again', me.id)

    const stranger = await h.app.inject({
      method: 'PATCH', url: '/api/projects/mine-again/visibility',
      payload: { visibility: 'public' },
    })
    expect(stranger.statusCode).toBe(401)

    const other = await h.app.inject({
      method: 'PATCH', url: '/api/projects/mine-again/visibility',
      headers: { cookie: them.cookie }, payload: { visibility: 'public' },
    })
    expect(other.statusCode).toBe(404)

    const owner = await h.app.inject({
      method: 'PATCH', url: '/api/projects/mine-again/visibility',
      headers: { cookie: me.cookie }, payload: { visibility: 'public' },
    })
    expect(owner.statusCode).toBe(200)

    const browse = await h.app.inject({ method: 'GET', url: '/api/browse' })
    expect(browse.json().projects.map((p: { slug: string }) => p.slug)).toContain('mine-again')
  })

  it('refuses a visibility that is not one of the three', async () => {
    const me = await h.signIn('a@example.com', 'A')
    await make('private', 'three-only', me.id)
    const response = await h.app.inject({
      method: 'PATCH', url: '/api/projects/three-only/visibility',
      headers: { cookie: me.cookie }, payload: { visibility: 'sort-of' },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('search', () => {
  it('matches the name and the description, and comes back empty for nothing', async () => {
    const byName = await h.app.inject({ method: 'GET', url: '/api/search?q=NVivo' })
    expect(byName.json().projects).toHaveLength(1)

    const byDescription = await h.app.inject({ method: 'GET', url: '/api/search?q=transcripts' })
    expect(byDescription.json().projects).toHaveLength(1)

    const nothing = await h.app.inject({ method: 'GET', url: '/api/search?q=xylophone' })
    expect(nothing.statusCode).toBe(200)
    expect(nothing.json().projects).toHaveLength(0)
  })
})

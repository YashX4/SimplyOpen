/**
 * W4, W8, V1, V2 and the download route.
 *
 * Downloads take no account at all, because W9 says so and a judge will
 * click Get it for Mac without signing in.
 */

import type { FastifyInstance } from 'fastify'
import { fail, mustBeSignedIn, type AppDeps } from '../app.js'
import * as builds from '../repo/builds.js'
import * as projects from '../repo/projects.js'
import * as versions from '../repo/versions.js'
import { refresh } from '../services/pipeline.js'
import type { Platform, Visibility } from '../types.js'
import { canEdit, canSee } from '../visibility.js'

const PLATFORMS = new Set<Platform>(['mac', 'windows', 'linux'])
const VISIBILITIES = new Set<Visibility>(['private', 'link', 'public'])

export async function registerProjects(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get<{ Params: { slug: string } }>('/api/projects/:slug', async (request, reply) => {
    const page = await projects.page(deps.db, request.params.slug)
    if (!page) return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
    if (!canSee(page.project, request.viewer?.id ?? null)) {
      // The same answer as a project that does not exist, so a private
      // slug cannot be guessed at by watching the status code.
      return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
    }
    return reply.send({
      ...page,
      can_edit: canEdit(page.project, request.viewer?.id ?? null),
    })
  })

  app.get<{ Params: { slug: string } }>('/api/projects/:slug/versions', async (request, reply) => {
    const project = await projects.bySlug(deps.db, request.params.slug)
    if (!project || !canSee(project, request.viewer?.id ?? null)) {
      return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
    }
    return reply.send({ versions: await versions.listForPage(deps.db, project.id) })
  })

  app.get<{ Params: { id: string } }>('/api/versions/:id', async (request, reply) => {
    const detail = await versions.detail(deps.db, request.params.id)
    if (!detail) return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that id.')
    const project = await projects.byId(deps.db, detail.version.project_id)
    if (!project || !canSee(project, request.viewer?.id ?? null)) {
      return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that id.')
    }
    return reply.send(detail)
  })

  /** W8's button. Sends you to the file; never needs a session. */
  app.get<{ Params: { id: string; platform: string } }>(
    '/api/download/:id/:platform',
    async (request, reply) => {
      const platform = request.params.platform.toLowerCase() as Platform
      if (!PLATFORMS.has(platform)) {
        return fail(reply, 400, 'NO_SUCH_SYSTEM', 'Ask for mac, windows or linux.')
      }
      const version = await versions.byId(deps.db, request.params.id)
      if (!version) return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that id.')
      const project = await projects.byId(deps.db, version.project_id)
      if (!project || !canSee(project, request.viewer?.id ?? null)) {
        return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that id.')
      }
      const build = await versions.buildFor(deps.db, version.id, platform)
      if (!build || build.status !== 'ready') {
        // W5: not for your computer, and why.
        return fail(
          reply,
          409,
          'NOT_FOR_THAT_SYSTEM',
          build?.message || 'There is no build for that system yet.',
        )
      }
      // A copy of our own: send them straight to it.
      if (build.download_url) return reply.redirect(build.download_url, 302)
      // Too big to copy, so it is still the Factory's. We fetch it with our
      // own credentials and pass it on, because the person has none.
      if (build.artifact_id !== null) {
        const bytes = await deps.factory.download(build.artifact_id)
        return reply
          .header('content-type', 'application/zip')
          .header(
            'content-disposition',
            `attachment; filename="${project.slug}-${version.number}-${platform}.zip"`,
          )
          .send(Buffer.from(bytes))
      }
      return fail(
        reply,
        409,
        'NOT_FOR_THAT_SYSTEM',
        build.message || 'That build is not ready to download yet.',
      )
    },
  )

  /**
   * W8 asks this before it starts a download, so a missing file is said out
   * loud instead of failing silently in a hidden frame. It never fetches the
   * file itself, only asks whether it is there.
   */
  app.get<{ Params: { id: string; platform: string } }>(
    '/api/download/:id/:platform/check',
    async (request, reply) => {
      const platform = request.params.platform.toLowerCase() as Platform
      if (!PLATFORMS.has(platform)) return reply.send({ ok: false, reason: 'Ask for mac, windows or linux.' })
      const version = await versions.byId(deps.db, request.params.id)
      const project = version ? await projects.byId(deps.db, version.project_id) : null
      if (!version || !project || !canSee(project, request.viewer?.id ?? null)) {
        return reply.send({ ok: false, reason: 'There is no version with that id.' })
      }
      const build = await versions.buildFor(deps.db, version.id, platform)
      if (!build || build.status !== 'ready') {
        return reply.send({ ok: false, reason: build?.message || 'There is no build for that system yet.' })
      }
      if (build.artifact_id !== null && !build.download_url) {
        // Streamed from the build service, which takes a moment to start.
        return reply.send({ ok: true, slow: true })
      }
      if (!build.download_url) return reply.send({ ok: false, reason: 'That build is not ready to download yet.' })
      try {
        const head = await fetch(build.download_url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
        if (head.ok) return reply.send({ ok: true, slow: false })
      } catch {
        // falls through: the address does not answer
      }
      return reply.send({ ok: false, reason: 'The file for this build is missing. It needs to be built again before anyone can get it.' })
    },
  )

  /** P6 asks this until the three systems settle. */
  app.post<{ Params: { id: string } }>('/api/versions/:id/refresh', async (request, reply) => {
    const version = await versions.byId(deps.db, request.params.id)
    if (!version) return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that id.')
    const project = await projects.byId(deps.db, version.project_id)
    if (!project || !canSee(project, request.viewer?.id ?? null)) {
      return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that id.')
    }
    const state = await refresh(
      { db: deps.db, analyzer: deps.analyzer, storage: deps.storage, factory: deps.factory },
      version.id,
    )
    return reply.send(state)
  })

  /** P3: the name and what it does, which the analyzer wrote and the maker may change. */
  app.patch<{ Params: { slug: string }; Body: { name?: string; description?: string } }>(
    '/api/projects/:slug',
    async (request, reply) => {
      const viewer = mustBeSignedIn(request, reply)
      if (!viewer) return reply
      const project = await projects.bySlug(deps.db, request.params.slug)
      if (!project || !canSee(project, viewer.id)) {
        return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
      }
      if (!canEdit(project, viewer.id)) {
        return fail(reply, 403, 'NOT_YOURS', 'Only the person who made it can change this.')
      }
      const name = (request.body?.name ?? project.name).trim()
      const description = (request.body?.description ?? project.description).trim()
      if (name.length === 0) return fail(reply, 400, 'NO_NAME', 'It needs a name.')
      if (name.length > 120) return fail(reply, 400, 'NAME_TOO_LONG', 'Keep the name under 120 letters.')
      if (description.length > 2000) {
        return fail(reply, 400, 'DESCRIPTION_TOO_LONG', 'Keep what it does under 2000 letters.')
      }
      await projects.setDetails(deps.db, project.id, name, description)
      return reply.send({ project: { ...project, name, description } })
    },
  )

  /** P3 and P7: only me, anyone with the link, everyone. */
  app.patch<{ Params: { slug: string }; Body: { visibility?: string } }>(
    '/api/projects/:slug/visibility',
    async (request, reply) => {
      const viewer = mustBeSignedIn(request, reply)
      if (!viewer) return reply
      const project = await projects.bySlug(deps.db, request.params.slug)
      if (!project || !canSee(project, viewer.id)) {
        return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
      }
      if (!canEdit(project, viewer.id)) {
        return fail(reply, 403, 'NOT_YOURS', 'Only the person who made it can change this.')
      }
      const next = request.body?.visibility as Visibility | undefined
      if (!next || !VISIBILITIES.has(next)) {
        return fail(reply, 400, 'BAD_VISIBILITY', 'Choose private, link or public.')
      }
      await projects.setVisibility(deps.db, project.id, next)
      return reply.send({ visibility: next })
    },
  )

  app.post<{ Params: { slug: string } }>('/api/projects/:slug/star', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const project = await projects.bySlug(deps.db, request.params.slug)
    if (!project || !canSee(project, viewer.id)) {
      return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
    }
    await deps.db.query(
      'insert into stars (user_id, project_id) values ($1, $2) on conflict do nothing',
      [viewer.id, project.id],
    )
    const row = await deps.db.query<{ n: number }>(
      'select count(*)::int as n from stars where project_id = $1',
      [project.id],
    )
    return reply.send({ stars: row.rows[0]?.n ?? 0 })
  })

  /** Used by P8 and P9 to decide which ending to show. */
  app.get<{ Params: { id: string } }>('/api/versions/:id/outcome', async (request, reply) => {
    const version = await versions.byId(deps.db, request.params.id)
    if (!version) return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that id.')
    const rows = await builds.list(deps.db, version.id)
    return reply.send({ outcome: builds.outcome(rows), builds: rows })
  })
}

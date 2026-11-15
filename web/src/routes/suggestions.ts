/**
 * Y1 through Y6: making a copy, offering a change back, and taking one.
 *
 * The one rule that shapes all of it: a copy is yours and needs nobody's
 * permission; a version on somebody else's project needs theirs.
 */

import type { FastifyInstance } from 'fastify'
import { fail, mustBeSignedIn, type AppDeps } from '../app.js'
import * as projects from '../repo/projects.js'
import * as suggestions from '../repo/suggestions.js'
import * as versions from '../repo/versions.js'
import { buildExisting } from '../services/release.js'
import { canEdit, canSee } from '../visibility.js'

interface ChangeBody {
  title?: string
  before?: string
  after?: string
}

export async function registerSuggestions(app: FastifyInstance, deps: AppDeps): Promise<void> {
  /** Y1: make my own copy. */
  app.post<{ Params: { slug: string }; Body: { version?: number } }>(
    '/api/projects/:slug/copies',
    async (request, reply) => {
      const viewer = mustBeSignedIn(request, reply)
      if (!viewer) return reply
      const project = await projects.bySlug(deps.db, request.params.slug)
      if (!project || !canSee(project, viewer.id)) {
        return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
      }
      const from =
        request.body?.version === undefined
          ? await versions.latest(deps.db, project.id)
          : await versions.byNumber(deps.db, project.id, Number(request.body.version))
      if (!from) return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that number.')
      const copy = await suggestions.makeCopy(deps.db, {
        project_id: project.id,
        owner: viewer.id,
        from_version_id: from.id,
        name: `Your copy of ${project.name}`,
      })
      return reply.code(201).send({ copy, from_version: from })
    },
  )

  /** Y3: send the change back. */
  app.post<{ Params: { id: string }; Body: { note?: string; changes?: ChangeBody[] } }>(
    '/api/copies/:id/suggestions',
    async (request, reply) => {
      const viewer = mustBeSignedIn(request, reply)
      if (!viewer) return reply
      const copy = await suggestions.copyById(deps.db, request.params.id)
      if (!copy) return fail(reply, 404, 'NO_SUCH_COPY', 'There is no copy with that id.')
      if (copy.owner !== viewer.id) {
        return fail(reply, 403, 'NOT_YOURS', 'That copy belongs to somebody else.')
      }
      const changes = (request.body?.changes ?? []).filter((c) => (c.title ?? '').trim().length > 0)
      if (changes.length === 0) {
        return fail(reply, 400, 'NOTHING_TO_SEND', 'Pick at least one change to send.')
      }
      const made = await suggestions.offer(deps.db, {
        copy_id: copy.id,
        project_id: copy.project_id,
        author: viewer.id,
        note: (request.body?.note ?? '').trim(),
        changes: changes.map((c) => ({
          title: (c.title ?? '').trim(),
          before_text: (c.before ?? '').trim(),
          after_text: (c.after ?? '').trim(),
        })),
      })
      return reply.code(201).send(made)
    },
  )

  /** M4: the inbox. */
  app.get<{ Params: { slug: string } }>('/api/projects/:slug/suggestions', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const project = await projects.bySlug(deps.db, request.params.slug)
    if (!project) return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
    if (!canEdit(project, viewer.id)) {
      return fail(reply, 403, 'NOT_YOURS', 'Only the person who made it sees these.')
    }
    return reply.send({ suggestions: await suggestions.waitingFor(deps.db, project.id) })
  })

  /** Y4: one suggestion, as the maker sees it. */
  app.get<{ Params: { id: string } }>('/api/suggestions/:id', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const detail = await suggestions.detail(deps.db, request.params.id)
    if (!detail) return fail(reply, 404, 'NO_SUCH_SUGGESTION', 'There is no suggestion with that id.')
    const project = await projects.byId(deps.db, detail.suggestion.project_id)
    const mine = detail.suggestion.author === viewer.id
    if (!project || (!canEdit(project, viewer.id) && !mine)) {
      return fail(reply, 403, 'NOT_YOURS', 'That is between somebody else and the person who made it.')
    }
    return reply.send(detail)
  })

  /** Y5: take it. Makes the next version, with their name on it. */
  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/api/suggestions/:id/take',
    async (request, reply) => {
      const viewer = mustBeSignedIn(request, reply)
      if (!viewer) return reply
      const detail = await suggestions.detail(deps.db, request.params.id)
      if (!detail) return fail(reply, 404, 'NO_SUCH_SUGGESTION', 'There is no suggestion with that id.')
      const project = await projects.byId(deps.db, detail.suggestion.project_id)
      if (!project || !canEdit(project, viewer.id)) {
        return fail(reply, 403, 'NOT_YOURS', 'Only the person who made it can take a suggestion.')
      }
      const note =
        (request.body?.note ?? '').trim() ||
        detail.changes.map((c) => c.title).join(' ') ||
        'A change somebody suggested.'
      let taken
      try {
        taken = await suggestions.take(deps.db, detail.suggestion.id, viewer.id, note)
      } catch (error) {
        return fail(reply, 409, 'ALREADY_DECIDED', (error as Error).message)
      }
      // The copy's own files become the new version's files, and get built.
      // If that fails the version still stands, and its page says it is not built.
      let built = false
      const copy = await suggestions.copyById(deps.db, detail.suggestion.copy_id)
      const zip = copy?.working_zip_url ? await deps.storage.read(copy.working_zip_url) : null
      if (zip) {
        try {
          await buildExisting(deps, taken.version, zip)
          built = true
        } catch (error) {
          request.log.warn({ err: error }, 'building a taken suggestion failed')
        }
      }
      return reply.send({ ...taken, built })
    },
  )

  /** Leave it, from the maker. Pull it back, from the person who sent it. */
  app.post<{ Params: { id: string } }>('/api/suggestions/:id/leave', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const detail = await suggestions.detail(deps.db, request.params.id)
    if (!detail) return fail(reply, 404, 'NO_SUCH_SUGGESTION', 'There is no suggestion with that id.')
    const project = await projects.byId(deps.db, detail.suggestion.project_id)
    const maker = project ? canEdit(project, viewer.id) : false
    const author = detail.suggestion.author === viewer.id
    if (!maker && !author) {
      return fail(reply, 403, 'NOT_YOURS', 'That is between somebody else and the person who made it.')
    }
    const settled = await suggestions.settle(deps.db, detail.suggestion.id, maker ? 'left' : 'withdrawn')
    if (!settled) return fail(reply, 409, 'ALREADY_DECIDED', 'That one has already been decided.')
    return reply.send({ suggestion: settled })
  })
}

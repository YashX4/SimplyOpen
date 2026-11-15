/**
 * The numbers and facts around a project, for its page.
 *
 * - GET    /api/projects/:slug/facts   stars, copies, versions, systems, what it touches, and "you"
 * - DELETE /api/projects/:slug/star    take your star back → { stars }
 *
 * Like the project page itself, facts need no account, and a project you
 * may not see answers exactly like one that does not exist.
 */

import type { FastifyInstance } from 'fastify'
import { fail, mustBeSignedIn, type AppDeps } from '../app.js'
import * as facts from '../repo/facts.js'
import * as projects from '../repo/projects.js'
import { canSee } from '../visibility.js'

export async function registerFacts(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get<{ Params: { slug: string } }>('/api/projects/:slug/facts', async (request, reply) => {
    const viewer = request.viewer?.id ?? null
    const project = await projects.bySlug(deps.db, request.params.slug)
    const found = project && canSee(project, viewer) ? await facts.forProject(deps.db, project, viewer) : null
    if (!found) return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
    return reply.send(found)
  })

  app.delete<{ Params: { slug: string } }>('/api/projects/:slug/star', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const project = await projects.bySlug(deps.db, request.params.slug)
    if (!project || !canSee(project, viewer.id)) return fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
    return reply.send({ stars: await facts.unstar(deps.db, project.id, viewer.id) })
  })
}

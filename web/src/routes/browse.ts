/** W1, W2 and W3. No account needed, and public projects only. */

import type { FastifyInstance } from 'fastify'
import type { AppDeps } from '../app.js'
import * as projects from '../repo/projects.js'

export async function registerBrowse(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/browse',
    async (request, reply) => {
      const limit = Math.min(Number(request.query.limit ?? 24) || 24, 60)
      const offset = Math.max(Number(request.query.offset ?? 0) || 0, 0)
      return reply.send({ projects: await projects.listPublic(deps.db, limit, offset, deps.teamEmails ?? []) })
    },
  )

  app.get<{ Querystring: { q?: string } }>('/api/search', async (request, reply) => {
    const q = (request.query.q ?? '').trim()
    if (q.length === 0) return reply.send({ q, projects: [] })
    const found = await projects.search(deps.db, q)
    // W3 is just this with an empty list, so the frontend needs no extra call.
    return reply.send({ q, projects: found })
  })
}

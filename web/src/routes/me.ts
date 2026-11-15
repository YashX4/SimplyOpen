/** M2 and M5: the things you made, the copies you made, what you got. */

import type { FastifyInstance } from 'fastify'
import { mustBeSignedIn, type AppDeps } from '../app.js'
import * as projects from '../repo/projects.js'
import * as suggestions from '../repo/suggestions.js'
import * as versions from '../repo/versions.js'

export async function registerMe(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/api/me/things', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply

    const made = await projects.listOwnedBy(deps.db, viewer.id)
    const withVersion = []
    for (const project of made) {
      const latest = await versions.latest(deps.db, project.id)
      const waiting = await deps.db.query<{ n: number }>(
        `select count(*)::int as n from suggestions
         where project_id = $1 and state = 'waiting'`,
        [project.id],
      )
      withVersion.push({
        project,
        version: latest,
        waiting: waiting.rows[0]?.n ?? 0,
      })
    }

    const copies = await suggestions.copiesOf(deps.db, viewer.id)
    const copiesWithSource = []
    for (const copy of copies) {
      const project = await projects.byId(deps.db, copy.project_id)
      const from = await versions.byId(deps.db, copy.from_version_id)
      copiesWithSource.push({ copy, project, from_version: from })
    }

    return reply.send({
      made: withVersion,
      copies: copiesWithSource,
      // The badge in the header on every screen.
      waiting_suggestions: await suggestions.countWaitingForOwner(deps.db, viewer.id),
    })
  })
}

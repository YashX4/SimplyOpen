/**
 * The home page shelves, and the lists and picks behind two of them.
 *
 * - GET    /api/shelves                     { picks, hot, new_this_week, lists }: the whole home page in one call
 * - GET    /api/lists/:id                   one list and the public projects in it
 * - POST   /api/lists                       { name } → 201, a new list of your own
 * - DELETE /api/lists/:id                   delete your list
 * - PUT    /api/lists/:id/projects/:slug    add a public project to your list
 * - DELETE /api/lists/:id/projects/:slug    take it out
 * - PUT    /api/picks/:slug                 { position? } make it a team pick (team only)
 * - DELETE /api/picks/:slug                 stop it being one (team only)
 *
 * Looking needs no account. Only public projects ever show on a shelf or
 * in a list, whoever is asking.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { fail, mustBeSignedIn, type AppDeps } from '../app.js'
import * as projects from '../repo/projects.js'
import * as shelves from '../repo/shelves.js'
import type { Project, User } from '../types.js'

const MAX_LIST_NAME = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function registerShelves(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/api/shelves', async (_request, reply) => {
    const [picks, hot, fresh, lists] = await Promise.all([
      shelves.picks(deps.db),
      shelves.hot(deps.db),
      shelves.newThisWeek(deps.db),
      shelves.lists(deps.db),
    ])
    return reply.send({ picks, hot, new_this_week: fresh, lists })
  })

  /* --------------------------------- lists -------------------------------- */

  type WithList = { Params: { id: string } }
  type WithListAndSlug = { Params: { id: string; slug: string } }

  app.get<WithList>('/api/lists/:id', async (request, reply) => {
    const list = UUID.test(request.params.id) ? await shelves.listById(deps.db, request.params.id) : null
    if (!list) return fail(reply, 404, 'NO_SUCH_LIST', 'There is no list with that id.')
    return reply.send({
      list: { id: list.id, name: list.name, created_at: list.created_at },
      projects: await shelves.listProjects(deps.db, list.id),
      can_edit: request.viewer?.id === list.owner,
    })
  })

  app.post<{ Body: { name?: unknown } }>('/api/lists', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const name = typeof request.body?.name === 'string' ? request.body.name.replace(/\s+/g, ' ').trim() : ''
    if (!name) return fail(reply, 400, 'NO_NAME', 'Give the list a name.')
    if (name.length > MAX_LIST_NAME) return fail(reply, 400, 'NAME_TOO_LONG', `Keep the name to ${MAX_LIST_NAME} characters.`)
    return reply.code(201).send({ list: await shelves.createList(deps.db, viewer.id, name) })
  })

  /** The viewer's own list, or null with the answer already sent. */
  async function myList(request: FastifyRequest<WithList>, reply: FastifyReply): Promise<shelves.ListRow | null> {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return null
    const list = UUID.test(request.params.id) ? await shelves.listById(deps.db, request.params.id) : null
    if (!list) {
      fail(reply, 404, 'NO_SUCH_LIST', 'There is no list with that id.')
      return null
    }
    if (list.owner !== viewer.id) {
      fail(reply, 403, 'NOT_YOUR_LIST', 'Only the person who made a list can change it.')
      return null
    }
    return list
  }

  /** A public project by its slug, or null with a 404 already sent. Private ones answer the same as missing ones. */
  async function publicProject(slug: string, reply: FastifyReply): Promise<Project | null> {
    const project = await projects.bySlug(deps.db, slug)
    if (!project || project.visibility !== 'public') {
      fail(reply, 404, 'NO_SUCH_PROJECT', 'There is no public project with that name.')
      return null
    }
    return project
  }

  app.delete<WithList>('/api/lists/:id', async (request, reply) => {
    const list = await myList(request, reply)
    if (!list) return reply
    await shelves.deleteList(deps.db, list.id)
    return reply.code(204).send()
  })

  app.put<WithListAndSlug>('/api/lists/:id/projects/:slug', async (request, reply) => {
    const list = await myList(request, reply)
    if (!list) return reply
    const project = await publicProject(request.params.slug, reply)
    if (!project) return reply
    await shelves.addToList(deps.db, list.id, project.id)
    return reply.send({ projects: await shelves.listProjects(deps.db, list.id) })
  })

  app.delete<WithListAndSlug>('/api/lists/:id/projects/:slug', async (request, reply) => {
    const list = await myList(request, reply)
    if (!list) return reply
    const project = await projects.bySlug(deps.db, request.params.slug)
    if (project) await shelves.removeFromList(deps.db, list.id, project.id)
    return reply.send({ projects: await shelves.listProjects(deps.db, list.id) })
  })

  /* --------------------------------- picks -------------------------------- */

  /** The viewer if they are on the team, or null with the answer already sent. */
  async function teamMember(request: FastifyRequest, reply: FastifyReply): Promise<User | null> {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return null
    if (!(await shelves.isTeam(deps.db, viewer.id, deps.teamEmails ?? []))) {
      fail(reply, 403, 'TEAM_ONLY', 'Only the SimplyOpen team chooses the picks.')
      return null
    }
    return viewer
  }

  type WithSlug = { Params: { slug: string }; Body: { position?: unknown } | undefined }

  app.put<WithSlug>('/api/picks/:slug', async (request, reply) => {
    const viewer = await teamMember(request, reply)
    if (!viewer) return reply
    const project = await publicProject(request.params.slug, reply)
    if (!project) return reply
    const position = request.body?.position
    if (position !== undefined && (typeof position !== 'number' || !Number.isInteger(position))) {
      return fail(reply, 400, 'BAD_POSITION', 'The position is a whole number; lower comes first.')
    }
    await shelves.pick(deps.db, project.id, viewer.id, position)
    return reply.send({ picks: await shelves.picks(deps.db, 60) })
  })

  app.delete<WithSlug>('/api/picks/:slug', async (request, reply) => {
    const viewer = await teamMember(request, reply)
    if (!viewer) return reply
    const project = await projects.bySlug(deps.db, request.params.slug)
    if (project) await shelves.unpick(deps.db, project.id)
    return reply.send({ picks: await shelves.picks(deps.db, 60) })
  })
}

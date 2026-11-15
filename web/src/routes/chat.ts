/**
 * C1 to C11 and Y1 to Y3: changing something by chatting, on a thing you
 * made or on your own copy of somebody else's.
 *
 * The chat service holds the conversation and the files while it runs,
 * for an hour after it was last used. This keeps only which chat belongs
 * to whom, so a chat lives exactly as long as the service keeps it, and a
 * restart of either side ends it, which C11 is for.
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { fail, mustBeSignedIn, type AppDeps } from '../app.js'
import * as projects from '../repo/projects.js'
import * as suggestions from '../repo/suggestions.js'
import * as versions from '../repo/versions.js'
import { ChatError, NoChat } from '../services/chat.js'
import { UploadRejected } from '../services/pipeline.js'
import { release } from '../services/release.js'
import { canEdit } from '../visibility.js'

interface ChatRef {
  id: string
  remote: string
  owner: string
  projectId: string
  slug: string
  name: string
  copyId: string | null
  fromVersion: number
  startedAt: string
}

function summary(c: ChatRef) {
  return {
    id: c.id,
    kind: c.copyId ? 'copy' : 'maker',
    project: { slug: c.slug, name: c.name },
    copy_id: c.copyId,
    from_version: c.fromVersion,
    started_at: c.startedAt,
  }
}

interface ChangeBody { title?: string; before?: string; after?: string }

export async function registerChat(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const chat = deps.chat ?? new NoChat()
  const chats = new Map<string, ChatRef>()

  /** What the chat service said, said again in the website's own words where it matters. */
  const relay = (reply: FastifyReply, error: unknown, ref?: ChatRef): FastifyReply => {
    if (error instanceof ChatError) {
      if (error.status === 404 && error.code === 'NO_SUCH_SESSION') {
        if (ref) chats.delete(ref.id)
        return fail(reply, 410, 'CHAT_ENDED', 'This chat has ended. Chats are kept for an hour after you last use one.')
      }
      if (error.status === 409) return fail(reply, 409, 'BUSY', 'Still working on the last thing you asked.')
      if (error.status === 502) return fail(reply, 502, 'CLAUDE_FAILED', 'Claude did not answer that time. Try again.')
      if (error.status === 503) return fail(reply, 503, error.code, error.message)
      if (error.status === 400) return fail(reply, 400, error.code, error.message)
      return fail(reply, 502, 'CHAT_FAILED', error.message)
    }
    if (error instanceof UploadRejected) return fail(reply, error.status, error.code, error.message)
    throw error
  }

  /** The chat, if it exists and belongs to whoever is asking. */
  const mine = (id: string, viewer: { id: string }, reply: FastifyReply): ChatRef | null => {
    const ref = chats.get(id)
    if (!ref || ref.owner !== viewer.id) {
      fail(reply, 410, 'CHAT_ENDED', 'This chat has ended, or it was never yours.')
      return null
    }
    return ref
  }

  const open = async (
    reply: FastifyReply,
    input: Omit<ChatRef, 'id' | 'remote' | 'startedAt'>,
    zipUrl: string | null,
  ) => {
    if (!zipUrl) {
      return fail(reply, 409, 'NO_SOURCE', 'This version has no files kept with it, so it cannot be changed by chatting. Share it again from a zip first.')
    }
    const zip = await deps.storage.read(zipUrl)
    if (!zip) return fail(reply, 409, 'NO_SOURCE', 'The files for this version could not be found.')
    // One chat per person per thing. A new one replaces the old, so nothing is left running unseen.
    for (const old of [...chats.values()]) {
      if (old.owner === input.owner && old.projectId === input.projectId && old.copyId === input.copyId) {
        chats.delete(old.id)
        void chat.end(old.remote)
      }
    }
    try {
      const started = await chat.start(zip)
      const ref: ChatRef = { ...input, id: randomUUID(), remote: started.sessionId, startedAt: new Date().toISOString() }
      chats.set(ref.id, ref)
      return reply.code(201).send({ chat: summary(ref), versions: [started.version] })
    } catch (error) {
      return relay(reply, error)
    }
  }

  /** C1: the maker starts a chat about the newest version. */
  app.post<{ Params: { slug: string } }>('/api/projects/:slug/chats', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const project = await projects.bySlug(deps.db, request.params.slug)
    if (!project || !canEdit(project, viewer.id)) {
      return fail(reply, 403, 'NOT_YOURS', 'Only the person who made it can change it. Make your own copy instead.')
    }
    const latest = await versions.latest(deps.db, project.id)
    if (!latest) return fail(reply, 404, 'NO_SUCH_VERSION', 'This has no versions yet.')
    return open(reply, {
      owner: viewer.id, projectId: project.id, slug: project.slug, name: project.name,
      copyId: null, fromVersion: latest.number,
    }, latest.source_zip_url)
  })

  /** C8: someone changes their own copy. It starts from wherever the copy got to. */
  app.post<{ Params: { id: string } }>('/api/copies/:id/chats', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const copy = await suggestions.copyById(deps.db, request.params.id)
    if (!copy || copy.owner !== viewer.id) return fail(reply, 404, 'NO_SUCH_COPY', 'There is no copy of yours with that id.')
    const project = await projects.byId(deps.db, copy.project_id)
    const from = await versions.byId(deps.db, copy.from_version_id)
    if (!project || !from) return fail(reply, 404, 'NO_SUCH_COPY', 'What this was copied from is gone.')
    return open(reply, {
      owner: viewer.id, projectId: project.id, slug: project.slug, name: project.name,
      copyId: copy.id, fromVersion: from.number,
    }, copy.working_zip_url ?? from.source_zip_url)
  })

  /** Y2: one copy, as its owner sees it. */
  app.get<{ Params: { id: string } }>('/api/copies/:id', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const copy = await suggestions.copyById(deps.db, request.params.id)
    if (!copy || copy.owner !== viewer.id) return fail(reply, 404, 'NO_SUCH_COPY', 'There is no copy of yours with that id.')
    const project = await projects.byId(deps.db, copy.project_id)
    const from = await versions.byId(deps.db, copy.from_version_id)
    const maker = project
      ? (await deps.db.query<{ name: string }>('select name from users where id = $1', [project.owner])).rows[0]?.name ?? ''
      : ''
    const sent = (
      await deps.db.query<{ id: string; state: string; note: string; created_at: string }>(
        'select id, state, note, created_at from suggestions where copy_id = $1 order by created_at desc',
        [copy.id],
      )
    ).rows
    const live = [...chats.values()].find((c) => c.copyId === copy.id && c.owner === viewer.id)
    return reply.send({
      copy: { id: copy.id, name: copy.name, created_at: copy.created_at, changed: copy.working_zip_url !== null },
      project: project ? { slug: project.slug, name: project.name, maker } : null,
      from_version: from ? { id: from.id, number: from.number, note: from.note } : null,
      suggestions: sent,
      chat: live ? summary(live) : null,
    })
  })

  app.get<{ Params: { id: string } }>('/api/chats/:id', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = mine(request.params.id, viewer, reply)
    if (!ref) return reply
    try {
      return reply.send({ chat: summary(ref), versions: await chat.versions(ref.remote) })
    } catch (error) {
      return relay(reply, error, ref)
    }
  })

  app.post<{ Params: { id: string }; Body: { message?: string; confirmPrivate?: boolean } }>(
    '/api/chats/:id/messages',
    async (request, reply) => {
      const viewer = mustBeSignedIn(request, reply)
      if (!viewer) return reply
      const ref = mine(request.params.id, viewer, reply)
      if (!ref) return reply
      const message = (request.body?.message ?? '').trim()
      if (!message) return fail(reply, 400, 'NO_MESSAGE', 'Say what you want to change.')
      const stop = new AbortController()
      reply.raw.on('close', () => { if (!reply.raw.writableFinished) stop.abort() })
      try {
        return reply.send(await chat.send(ref.remote, message, request.body?.confirmPrivate === true, stop.signal))
      } catch (error) {
        return relay(reply, error, ref)
      }
    },
  )

  app.post<{ Params: { id: string } }>('/api/chats/:id/undo', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = mine(request.params.id, viewer, reply)
    if (!ref) return reply
    try {
      return reply.send({ version: await chat.undo(ref.remote) })
    } catch (error) {
      return relay(reply, error, ref)
    }
  })

  app.post<{ Params: { id: string; n: string } }>('/api/chats/:id/versions/:n/restore', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = mine(request.params.id, viewer, reply)
    if (!ref) return reply
    const n = Number(request.params.n)
    if (!Number.isInteger(n) || n < 0) return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no change with that number.')
    try {
      return reply.send({ version: await chat.restore(ref.remote, n) })
    } catch (error) {
      return relay(reply, error, ref)
    }
  })

  /** C4: the maker makes what is in the chat the next version, for everyone. */
  app.post<{ Params: { id: string }; Body: { note?: string } }>('/api/chats/:id/release', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = mine(request.params.id, viewer, reply)
    if (!ref) return reply
    if (ref.copyId) return fail(reply, 403, 'NOT_YOURS', 'This is a copy. Suggest the change to the person who made it instead.')
    const note = (request.body?.note ?? '').trim()
    if (!note) return fail(reply, 400, 'NO_NOTE', 'Say what changed, so people know.')
    try {
      const zip = await chat.zip(ref.remote)
      const version = await release(deps, { projectId: ref.projectId, zip, note, by: viewer.id })
      return reply.code(201).send({ version, project: { slug: ref.slug } })
    } catch (error) {
      return relay(reply, error, ref)
    }
  })

  /** C8: keep the change on your own copy. Its files outlive the chat. */
  const keep = async (ref: ChatRef): Promise<void> => {
    const zip = await chat.zip(ref.remote)
    const stored = await deps.storage.put(`copies/${ref.copyId}/${randomUUID()}.zip`, zip, 'application/zip')
    await suggestions.setWorkingZip(deps.db, ref.copyId as string, stored.url)
  }

  app.post<{ Params: { id: string } }>('/api/chats/:id/keep', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = mine(request.params.id, viewer, reply)
    if (!ref) return reply
    if (!ref.copyId) return fail(reply, 400, 'NOT_A_COPY', 'This is yours. Make it a version instead.')
    try {
      await keep(ref)
      return reply.send({ kept: true, copy_id: ref.copyId })
    } catch (error) {
      return relay(reply, error, ref)
    }
  })

  /** Y3: keep it, and offer it back to the person who made the original. */
  app.post<{ Params: { id: string }; Body: { note?: string; changes?: ChangeBody[] } }>(
    '/api/chats/:id/suggest',
    async (request, reply) => {
      const viewer = mustBeSignedIn(request, reply)
      if (!viewer) return reply
      const ref = mine(request.params.id, viewer, reply)
      if (!ref) return reply
      if (!ref.copyId) return fail(reply, 400, 'NOT_A_COPY', 'This is yours. Make it a version instead.')
      const changes = (request.body?.changes ?? []).filter((c) => (c.title ?? '').trim().length > 0)
      if (changes.length === 0) return fail(reply, 400, 'NOTHING_TO_SEND', 'Pick at least one change to send.')
      try {
        await keep(ref)
        const made = await suggestions.offer(deps.db, {
          copy_id: ref.copyId,
          project_id: ref.projectId,
          author: viewer.id,
          note: (request.body?.note ?? '').trim(),
          changes: changes.map((c) => ({
            title: (c.title ?? '').trim(),
            before_text: (c.before ?? '').trim(),
            after_text: (c.after ?? '').trim(),
          })),
        })
        return reply.code(201).send(made)
      } catch (error) {
        return relay(reply, error, ref)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/chats/:id', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = chats.get(request.params.id)
    if (ref && ref.owner === viewer.id) {
      chats.delete(ref.id)
      await chat.end(ref.remote)
    }
    return reply.code(204).send()
  })
}

/**
 * C1 to C11 and Y1 to Y3: changing something by chatting, on a thing you
 * made or on your own copy of somebody else's.
 *
 * The chat service holds the live conversation and files, but only for an
 * hour after it was last used, and not across a restart. So this keeps what
 * has to last, in the database: which chat is whose, everything that was
 * said, the list of changes, and the code as the chat last left it. When
 * the chat service has forgotten a chat, it is started again from those,
 * and the person carries on where they left off.
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { fail, mustBeSignedIn, type AppDeps } from '../app.js'
import * as chatsRepo from '../repo/chats.js'
import type { ChatRow } from '../repo/chats.js'
import * as copiesRepo from '../repo/copies.js'
import * as projects from '../repo/projects.js'
import * as suggestions from '../repo/suggestions.js'
import * as versions from '../repo/versions.js'
import { ChatError, NoChat, type ChatVersion } from '../services/chat.js'
import { UploadRejected } from '../services/pipeline.js'
import { release } from '../services/release.js'
import { canEdit } from '../visibility.js'

type ChatRef = ChatRow

function summary(c: ChatRef) {
  return {
    id: c.id,
    kind: c.copy_id ? 'copy' : 'maker',
    project: { slug: c.slug, name: c.name },
    copy_id: c.copy_id,
    from_version: c.from_version,
    started_at: c.started_at,
  }
}

interface ChangeBody { title?: string; before?: string; after?: string }

/** The chat service saying it no longer has this chat. */
const forgotten = (error: unknown): boolean =>
  error instanceof ChatError && error.status === 404 && error.code === 'NO_SUCH_SESSION'

export async function registerChat(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const chat = deps.chat ?? new NoChat()

  /** What the chat service said, said again in the website's own words where it matters. */
  const relay = (reply: FastifyReply, error: unknown): FastifyReply => {
    if (error instanceof ChatError) {
      if (forgotten(error)) {
        return fail(reply, 410, 'CHAT_ENDED', 'This chat has ended, and it could not be picked up again.')
      }
      if (error.status === 409 && error.code === 'NO_SOURCE') return fail(reply, 409, error.code, error.message)
      if (error.status === 409 && error.code === 'TOO_FAR_BACK') return fail(reply, 409, error.code, error.message)
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
  const mine = async (id: string, viewer: { id: string }, reply: FastifyReply): Promise<ChatRef | null> => {
    const ref = /^[0-9a-f-]{36}$/i.test(id) ? await chatsRepo.byId(deps.db, id) : null
    if (!ref || ref.owner !== viewer.id) {
      fail(reply, 410, 'CHAT_ENDED', 'This chat has ended, or it was never yours.')
      return null
    }
    return ref
  }

  /**
   * Start the chat again in the chat service, from the code it last left
   * and everything that was said. Changes made before now keep their
   * numbers; the new session's changes are numbered after them.
   */
  const pickUp = async (ref: ChatRef): Promise<void> => {
    const zip = await deps.storage.read(ref.working_zip_url ?? ref.base_zip_url)
    if (!zip) throw new ChatError('The files for this chat could not be found, so it cannot be picked up again.', 409, 'NO_SOURCE')
    const earlier = (await chatsRepo.messages(deps.db, ref.id)).map((m) => ({
      role: m.role === 'you' ? ('user' as const) : ('assistant' as const),
      text: m.text,
    }))
    const started = await chat.start(zip, earlier)
    ref.remote = started.sessionId
    ref.version_offset = Math.max(ref.versions.length - 1, 0)
    await chatsRepo.setRemote(deps.db, ref.id, ref.remote, ref.version_offset)
  }

  /** Ask the chat service something about this chat, picking the chat up again first if it has been forgotten. */
  const live = async <T>(ref: ChatRef, ask: (remote: string) => Promise<T>): Promise<T> => {
    try {
      return await ask(ref.remote)
    } catch (error) {
      if (!forgotten(error)) throw error
      await pickUp(ref)
      return ask(ref.remote)
    }
  }

  /** A change's number as the page knows it: the live session's number, after the ones made before it. */
  const shown = <V extends ChatVersion | null>(ref: ChatRef, v: V): V =>
    (v ? { ...v, number: v.number + ref.version_offset } : v) as V

  /** Every change in the chat: the ones from before the live session, then the live session's own. */
  const allVersions = (ref: ChatRef, fromService: ChatVersion[]): ChatVersion[] =>
    ref.version_offset === 0
      ? fromService
      : [...ref.versions.slice(0, ref.version_offset + 1), ...fromService.slice(1).map((v) => shown(ref, v))]

  /** After the code changed: keep the new code and the list of changes, so both outlive the chat service. */
  const saveProgress = async (ref: ChatRef): Promise<void> => {
    const zip = await chat.zip(ref.remote)
    const stored = await deps.storage.put(`chats/${ref.id}/${randomUUID()}.zip`, zip, 'application/zip')
    ref.versions = allVersions(ref, await chat.versions(ref.remote))
    ref.working_zip_url = stored.url
    await chatsRepo.saveProgress(deps.db, ref.id, ref.versions, stored.url)
  }

  const open = async (
    reply: FastifyReply,
    input: { owner: string; projectId: string; copyId: string | null; fromVersion: number },
    zipUrl: string | null,
  ) => {
    if (!zipUrl) {
      return fail(reply, 409, 'NO_SOURCE', 'This version has no files kept with it, so it cannot be changed by chatting. Share it again from a zip first.')
    }
    try {
      // One chat per person per thing. If they already have one about these same
      // files, they carry on with it, here or on another computer.
      const existing = await chatsRepo.findFor(deps.db, input.owner, input.projectId, input.copyId)
      if (existing) {
        const sameStart = existing.from_version === input.fromVersion && (existing.base_zip_url === zipUrl || existing.working_zip_url === zipUrl)
        if (sameStart) {
          const list = allVersions(existing, await live(existing, (remote) => chat.versions(remote)))
          return reply.code(201).send({ chat: summary(existing), versions: list, messages: await chatsRepo.messages(deps.db, existing.id) })
        }
        // What it was about has moved on (a new version, or the copy changed elsewhere), so it starts afresh.
        await chatsRepo.remove(deps.db, existing.id)
        void chat.end(existing.remote)
      }
      const zip = await deps.storage.read(zipUrl)
      if (!zip) return fail(reply, 409, 'NO_SOURCE', 'The files for this version could not be found.')
      const started = await chat.start(zip)
      const ref = await chatsRepo.create(deps.db, {
        owner: input.owner,
        project_id: input.projectId,
        copy_id: input.copyId,
        from_version: input.fromVersion,
        remote: started.sessionId,
        base_zip_url: zipUrl,
        versions: [started.version],
      })
      return reply.code(201).send({ chat: summary(ref), versions: [started.version], messages: [] })
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
    return open(reply, { owner: viewer.id, projectId: project.id, copyId: null, fromVersion: latest.number }, latest.source_zip_url)
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
    return open(reply, { owner: viewer.id, projectId: project.id, copyId: copy.id, fromVersion: from.number }, copy.working_zip_url ?? from.source_zip_url)
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
    const saved = await chatsRepo.findFor(deps.db, viewer.id, copy.project_id, copy.id)
    return reply.send({
      copy: { id: copy.id, name: copy.name, created_at: copy.created_at, changed: copy.working_zip_url !== null },
      project: project ? { slug: project.slug, name: project.name, maker } : null,
      from_version: from ? { id: from.id, number: from.number, note: from.note } : null,
      suggestions: sent,
      chat: saved ? summary(saved) : null,
    })
  })

  app.get<{ Params: { id: string } }>('/api/chats/:id', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = await mine(request.params.id, viewer, reply)
    if (!ref) return reply
    try {
      const list = allVersions(ref, await live(ref, (remote) => chat.versions(remote)))
      // Everything said so far, so the page can show the conversation again after time away.
      return reply.send({ chat: summary(ref), versions: list, messages: await chatsRepo.messages(deps.db, ref.id) })
    } catch (error) {
      return relay(reply, error)
    }
  })

  app.post<{ Params: { id: string }; Body: { message?: string; confirmPrivate?: boolean } }>(
    '/api/chats/:id/messages',
    async (request, reply) => {
      const viewer = mustBeSignedIn(request, reply)
      if (!viewer) return reply
      const ref = await mine(request.params.id, viewer, reply)
      if (!ref) return reply
      const message = (request.body?.message ?? '').trim()
      if (!message) return fail(reply, 400, 'NO_MESSAGE', 'Say what you want to change.')
      const stop = new AbortController()
      reply.raw.on('close', () => { if (!reply.raw.writableFinished) stop.abort() })
      try {
        const answer = await live(ref, (remote) => chat.send(remote, message, request.body?.confirmPrivate === true, stop.signal))
        // The privacy reminder means nothing was sent to the AI, so nothing is saved either.
        if (answer.kind !== 'reply') return reply.send(answer)
        if (answer.version) await saveProgress(ref)
        const version = shown(ref, answer.version)
        await chatsRepo.addExchange(deps.db, ref.id, message, answer.reply, version?.number ?? null)
        return reply.send({
          ...answer,
          version,
          readyToDownload: answer.readyToDownload ? { version: answer.readyToDownload.version + ref.version_offset } : null,
        })
      } catch (error) {
        return relay(reply, error)
      }
    },
  )

  app.post<{ Params: { id: string } }>('/api/chats/:id/undo', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = await mine(request.params.id, viewer, reply)
    if (!ref) return reply
    try {
      const version = await live(ref, (remote) => chat.undo(remote))
      if (version) await saveProgress(ref)
      return reply.send({ version: shown(ref, version) })
    } catch (error) {
      return relay(reply, error)
    }
  })

  app.post<{ Params: { id: string; n: string } }>('/api/chats/:id/versions/:n/restore', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = await mine(request.params.id, viewer, reply)
    if (!ref) return reply
    const n = Number(request.params.n)
    if (!Number.isInteger(n) || n < 0) return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no change with that number.')
    try {
      const version = await live(ref, (remote) => {
        // Changes from before the chat was last picked up again are listed, but the chat service no longer holds them.
        const inSession = n - ref.version_offset
        if (inSession < 0) throw new ChatError('That change is from before this chat was picked up again, so it cannot be gone back to from here.', 409, 'TOO_FAR_BACK')
        return chat.restore(remote, inSession)
      })
      if (version) await saveProgress(ref)
      return reply.send({ version: shown(ref, version) })
    } catch (error) {
      return relay(reply, error)
    }
  })

  /** C4: the maker makes what is in the chat the next version, for everyone. */
  app.post<{ Params: { id: string }; Body: { note?: string } }>('/api/chats/:id/release', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = await mine(request.params.id, viewer, reply)
    if (!ref) return reply
    if (ref.copy_id) return fail(reply, 403, 'NOT_YOURS', 'This is a copy. Suggest the change to the person who made it instead.')
    const note = (request.body?.note ?? '').trim()
    if (!note) return fail(reply, 400, 'NO_NOTE', 'Say what changed, so people know.')
    try {
      const zip = await live(ref, (remote) => chat.zip(remote))
      const version = await release(deps, { projectId: ref.project_id, zip, note, by: viewer.id })
      return reply.code(201).send({ version, project: { slug: ref.slug } })
    } catch (error) {
      return relay(reply, error)
    }
  })

  /**
   * C8: keep the change on your own copy. Its files outlive the chat, and
   * it becomes the next version in the copy's own history, named after the
   * last thing that was asked for.
   */
  const keep = async (ref: ChatRef): Promise<void> => {
    const zip = await live(ref, (remote) => chat.zip(remote))
    const stored = await deps.storage.put(`copies/${ref.copy_id}/${randomUUID()}.zip`, zip, 'application/zip')
    await suggestions.setWorkingZip(deps.db, ref.copy_id as string, stored.url)
    const copy = await suggestions.copyById(deps.db, ref.copy_id as string)
    if (copy) {
      const label = (ref.versions.at(-1)?.label ?? '').replace(/\s+/g, ' ').trim()
      const note = ref.versions.length > 1 && label ? label : 'Kept a change.'
      await copiesRepo.append(deps.db, copy, { note: note.length > 200 ? `${note.slice(0, 199)}…` : note, source_zip_url: stored.url })
    }
    // The chat now starts from what was kept, so opening it again carries on from here.
    ref.working_zip_url = stored.url
    await chatsRepo.saveProgress(deps.db, ref.id, ref.versions, stored.url)
  }

  app.post<{ Params: { id: string } }>('/api/chats/:id/keep', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = await mine(request.params.id, viewer, reply)
    if (!ref) return reply
    if (!ref.copy_id) return fail(reply, 400, 'NOT_A_COPY', 'This is yours. Make it a version instead.')
    try {
      await keep(ref)
      return reply.send({ kept: true, copy_id: ref.copy_id })
    } catch (error) {
      return relay(reply, error)
    }
  })

  /** Y3: keep it, and offer it back to the person who made the original. */
  app.post<{ Params: { id: string }; Body: { note?: string; changes?: ChangeBody[] } }>(
    '/api/chats/:id/suggest',
    async (request, reply) => {
      const viewer = mustBeSignedIn(request, reply)
      if (!viewer) return reply
      const ref = await mine(request.params.id, viewer, reply)
      if (!ref) return reply
      if (!ref.copy_id) return fail(reply, 400, 'NOT_A_COPY', 'This is yours. Make it a version instead.')
      const changes = (request.body?.changes ?? []).filter((c) => (c.title ?? '').trim().length > 0)
      if (changes.length === 0) return fail(reply, 400, 'NOTHING_TO_SEND', 'Pick at least one change to send.')
      try {
        await keep(ref)
        const made = await suggestions.offer(deps.db, {
          copy_id: ref.copy_id,
          project_id: ref.project_id,
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
        return relay(reply, error)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/chats/:id', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const ref = /^[0-9a-f-]{36}$/i.test(request.params.id) ? await chatsRepo.byId(deps.db, request.params.id) : null
    if (ref && ref.owner === viewer.id) {
      await chatsRepo.remove(deps.db, ref.id)
      await chat.end(ref.remote)
    }
    return reply.code(204).send()
  })
}

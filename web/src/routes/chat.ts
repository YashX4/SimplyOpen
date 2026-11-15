/**
 * Changing a copy by talking, with the conversation kept.
 *
 * - GET  /api/copies/:id/chat   everything said so far about this copy, oldest first
 * - POST /api/copies/:id/chat   { message, confirm_private? } → the AI's answer
 *
 * A copy belongs to one person, so this is that person's own conversation
 * about that copy. It is saved here, so they can leave and come back, on
 * any computer, and the AI picks up where they left off. Every answer that
 * changes the code becomes a new version of the copy.
 *
 * The AI's working session lives in the chat service and is temporary.
 * When it has gone (or the copy's code was changed some other way, such as
 * going back a version), a new one is started from the copy's newest code
 * and the saved conversation, without the person noticing.
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { fail, type AppDeps } from '../app.js'
import * as chats from '../repo/chats.js'
import * as copies from '../repo/copies.js'
import { ChatUnavailable, type ChatAnswer, type ChatService } from '../services/chat.js'
import type { Storage } from '../services/storage.js'
import type { Copy } from '../types.js'
import { ownCopy } from './copies.js'

/** The same limit the chat service has. */
const MAX_MESSAGE = 4_000
const MAX_NOTE = 200

export async function registerChat(app: FastifyInstance, deps: AppDeps): Promise<void> {
  type WithId = { Params: { id: string } }

  app.get<WithId>('/api/copies/:id/chat', async (request, reply) => {
    const copy = await ownCopy(deps, request, reply)
    if (!copy) return reply
    return reply.send({ messages: await chats.messages(deps.db, copy.id) })
  })

  app.post<WithId & { Body: Record<string, unknown> }>('/api/copies/:id/chat', async (request, reply) => {
    const copy = await ownCopy(deps, request, reply)
    if (!copy) return reply
    const chat = deps.chat
    if (!chat) return fail(reply, 503, 'CHAT_NOT_SET_UP', 'The chat is not set up on this server yet.')

    const message = typeof request.body?.message === 'string' ? request.body.message.trim() : ''
    if (!message) return fail(reply, 400, 'NO_MESSAGE', 'Type what you would like to change.')
    if (message.length > MAX_MESSAGE) return fail(reply, 400, 'MESSAGE_TOO_LONG', `Keep it to ${MAX_MESSAGE} characters.`)
    const confirmPrivate = request.body?.confirm_private === true

    try {
      const current = (await copies.list(deps.db, copy))[0]
      if (!current?.source_zip_url) return fail(reply, 409, 'NO_CODE', 'The code for this copy was never stored, so it cannot be changed.')

      const asked = await ask(chat, copy, current.number, current.source_zip_url, message, confirmPrivate)
      if (asked === 'busy') return fail(reply, 409, 'BUSY', 'Still working on your last message.')
      const { answer, sessionId } = asked
      // Nothing was sent to the AI, so nothing is saved either.
      if (answer.kind === 'privacy_reminder') return reply.send(answer)

      // An answer that changed the code becomes the copy's next version.
      let version: copies.CopyVersion | null = null
      if (answer.changed) {
        const zip = await chat.zip(sessionId)
        const stored = await deps.storage.put(`copies/${copy.id}/${randomUUID()}.zip`, zip, 'application/zip')
        const note = (answer.label ?? `You asked: ${message}`).replace(/\s+/g, ' ').trim()
        version = await copies.append(deps.db, copy, {
          note: note.length > MAX_NOTE ? `${note.slice(0, MAX_NOTE - 1)}…` : note,
          source_zip_url: stored.url,
        })
        await chats.setSession(deps.db, copy.id, sessionId, version.number)
      }
      const saved = await chats.addExchange(deps.db, copy.id, message, answer.reply, version?.number ?? null)
      return reply.send({
        kind: 'reply',
        reply: answer.reply,
        version,
        // The version to offer as a download, when the person said they are happy with it.
        ready_to_download: answer.ready_to_download ? (version?.number ?? current.number) : null,
        stopped_early: answer.stopped_early,
        messages: saved,
      })
    } catch (error) {
      if (error instanceof ChatUnavailable) return fail(reply, 502, 'CHAT_UNAVAILABLE', error.message)
      throw error
    }
  })

  /**
   * Send the message to the copy's chat session, starting a new session
   * first if there is none, it has expired, or its files are not the copy's
   * newest version.
   */
  async function ask(
    chat: ChatService,
    copy: Copy,
    currentVersion: number,
    zipUrl: string,
    message: string,
    confirmPrivate: boolean,
  ): Promise<{ answer: ChatAnswer; sessionId: string } | 'busy'> {
    const known = await chats.session(deps.db, copy.id)
    let sessionId = known && known.at_version === currentVersion ? known.session_id : null
    for (let attempt = 0; ; attempt += 1) {
      if (!sessionId) {
        const earlier = (await chats.messages(deps.db, copy.id)).map((m) => ({
          role: m.role === 'you' ? ('user' as const) : ('assistant' as const),
          text: m.text,
        }))
        sessionId = await chat.start(await readStored(deps.storage, zipUrl), earlier)
        await chats.setSession(deps.db, copy.id, sessionId, currentVersion)
      }
      const answer = await chat.send(sessionId, message, confirmPrivate)
      if (answer === 'busy') return 'busy'
      if (answer !== 'gone') return { answer, sessionId }
      if (attempt >= 1) throw new ChatUnavailable()
      sessionId = null // expired over there: start again from what is saved here
    }
  }
}

/** Read a stored file back by its link. Stored files are fetchable by link; the in-memory store is read directly. */
async function readStored(storage: Storage, url: string): Promise<Uint8Array> {
  const memory = storage as { files?: Map<string, { bytes: Uint8Array }> }
  if (memory.files instanceof Map) {
    for (const [path, file] of memory.files) if (storage.urlFor(path) === url) return file.bytes
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(String(response.status))
    return new Uint8Array(await response.arrayBuffer())
  } catch {
    throw new ChatUnavailable("This copy's code could not be opened just now. Try again in a moment.")
  }
}

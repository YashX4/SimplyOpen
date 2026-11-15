/**
 * A person's own copy of a project, and its version history. Making the
 * copy is in suggestions.ts (POST /api/projects/:slug/copies); this is
 * everything after that.
 *
 * - GET  /api/copies/:id                         the copy, "Copied from", and its newest version
 * - GET  /api/copies/:id/versions                every version, newest first
 * - POST /api/copies/:id/versions                multipart: "file" (zip of the code), "note" → 201 the new version
 * - POST /api/copies/:id/versions/:n/restore     go back to version n, as a new version
 * - GET  /api/copies/:id/versions/:n/download    that version's code
 *
 * A copy is private: only its owner can see or change it. To anyone else
 * it answers exactly like a copy that does not exist.
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { fail, type AppDeps } from '../app.js'
import * as copies from '../repo/copies.js'
import * as suggestions from '../repo/suggestions.js'
import type { Copy } from '../types.js'

const MAX_NOTE = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The viewer's own copy named in the address, or null with the answer
 * already sent: 401 if nobody is signed in, and 404 if there is no such
 * copy or it is someone else's (the same answer for both).
 */
export async function ownCopy(
  deps: AppDeps,
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<Copy | null> {
  if (!request.viewer) {
    fail(reply, 401, 'SIGN_IN_NEEDED', 'Sign in first. Getting things never needs an account; this does.')
    return null
  }
  const copy = UUID.test(request.params.id) ? await suggestions.copyById(deps.db, request.params.id) : null
  if (!copy || copy.owner !== request.viewer.id) {
    fail(reply, 404, 'NO_SUCH_COPY', 'There is no copy with that id.')
    return null
  }
  return copy
}

export async function registerCopies(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const myCopy = (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => ownCopy(deps, request, reply)

  type WithId = { Params: { id: string } }
  type WithNumber = { Params: { id: string; n: string } }

  app.get<WithId>('/api/copies/:id', async (request, reply) => {
    const copy = await myCopy(request, reply)
    if (!copy) return reply
    const detail = await copies.detail(deps.db, copy)
    if (!detail) return fail(reply, 404, 'NO_SUCH_COPY', 'There is no copy with that id.')
    return reply.send(detail)
  })

  app.get<WithId>('/api/copies/:id/versions', async (request, reply) => {
    const copy = await myCopy(request, reply)
    if (!copy) return reply
    const all = await copies.list(deps.db, copy)
    return reply.send({ versions: all.map((v, i) => ({ ...v, is_current: i === 0 })) })
  })

  app.post<WithId>('/api/copies/:id/versions', async (request, reply) => {
    const copy = await myCopy(request, reply)
    if (!copy) return reply
    if (!request.isMultipart()) {
      return fail(reply, 415, 'NOT_MULTIPART', 'Send the zip as multipart/form-data in a field named "file".')
    }
    let zip: Buffer | null = null
    let note = ''
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname === 'file') zip = await part.toBuffer()
          else part.file.resume()
        } else if (part.fieldname === 'note' && typeof part.value === 'string') {
          note = part.value
        }
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return fail(reply, 413, 'UPLOAD_TOO_LARGE', 'That file is bigger than we can take.')
      }
      throw error
    }
    if (!zip || zip.byteLength === 0) return fail(reply, 400, 'NO_FILE', 'No file arrived. Send the zip in a field named "file".')
    // Every zip file starts with "PK".
    if (zip[0] !== 0x50 || zip[1] !== 0x4b) return fail(reply, 400, 'NOT_A_ZIP', 'That file is not a zip.')
    note = note.replace(/\s+/g, ' ').trim()
    if (!note) return fail(reply, 400, 'NO_NOTE', 'Say in a few words what changed, in a field named "note".')
    if (note.length > MAX_NOTE) return fail(reply, 400, 'NOTE_TOO_LONG', `Keep the note to ${MAX_NOTE} characters.`)

    const stored = await deps.storage.put(`copies/${copy.id}/${randomUUID()}.zip`, new Uint8Array(zip), 'application/zip')
    return reply.code(201).send({ version: await copies.append(deps.db, copy, { note, source_zip_url: stored.url }) })
  })

  app.post<WithNumber>('/api/copies/:id/versions/:n/restore', async (request, reply) => {
    const copy = await myCopy(request, reply)
    if (!copy) return reply
    const number = Number(request.params.n)
    if (!(await copies.byNumber(deps.db, copy, number))) return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that number.')
    // Null here means it is already the newest version: nothing to do.
    return reply.send({ version: await copies.restore(deps.db, copy, number) })
  })

  app.get<WithNumber>('/api/copies/:id/versions/:n/download', async (request, reply) => {
    const copy = await myCopy(request, reply)
    if (!copy) return reply
    const version = await copies.byNumber(deps.db, copy, Number(request.params.n))
    if (!version) return fail(reply, 404, 'NO_SUCH_VERSION', 'There is no version with that number.')
    if (!version.source_zip_url) return fail(reply, 409, 'NO_CODE', 'The code for that version was never stored.')
    return reply.redirect(version.source_zip_url, 302)
  })
}

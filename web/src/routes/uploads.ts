/** P1: share something you made. Multipart in, a private project out. */

import type { FastifyInstance } from 'fastify'
import { fail, mustBeSignedIn, type AppDeps } from '../app.js'
import { publish, UploadRejected } from '../services/pipeline.js'

export async function registerUploads(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/api/projects', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    if (!request.isMultipart()) {
      return fail(reply, 415, 'NOT_MULTIPART', 'Send the zip as multipart/form-data in a field named "file".')
    }

    let zip: Buffer | null = null
    const fields: Record<string, string> = {}
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file') {
            part.file.resume()
            continue
          }
          zip = await part.toBuffer()
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value
        }
      }
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'FST_REQ_FILE_TOO_LARGE') {
        return fail(reply, 413, 'UPLOAD_TOO_LARGE', 'That file is bigger than we can take.')
      }
      throw error
    }
    if (!zip) {
      return fail(reply, 400, 'NO_FILE', 'No file arrived. Send the zip in a field named "file".')
    }

    try {
      const result = await publish(
        { db: deps.db, analyzer: deps.analyzer, storage: deps.storage, factory: deps.factory },
        {
          owner: viewer.id,
          zip: new Uint8Array(zip),
          name: fields.name,
          description: fields.description,
        },
      )
      return reply.code(201).send({
        project: result.project,
        version: result.version,
        builds: result.builds,
        simple_window: result.simpleWindow,
      })
    } catch (error) {
      if (error instanceof UploadRejected) {
        return fail(reply, error.status, error.code, error.message)
      }
      throw error
    }
  })
}

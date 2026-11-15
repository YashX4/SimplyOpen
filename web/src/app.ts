/**
 * The website's API.
 *
 * Every dependency is passed in, so a test can run the whole thing with a
 * database in process, a fake Analyzer and a fake Factory, and no network.
 *
 * Errors answer { error: { code, message } }, the same shape the Analyzer
 * and the chat service already use, so the frontend only learns one.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import type { Db } from './db.js'
import * as users from './repo/users.js'
import type { Analyzer } from './services/analyzer.js'
import type { Factory } from './services/factory.js'
import type { Mailer } from './services/mailer.js'
import type { Storage } from './services/storage.js'
import type { User } from './types.js'
import { registerAuth } from './routes/auth.js'
import { registerBrowse } from './routes/browse.js'
import { registerProjects } from './routes/projects.js'
import { registerUploads } from './routes/uploads.js'
import { registerSuggestions } from './routes/suggestions.js'
import { registerMe } from './routes/me.js'
import { registerChat } from './routes/chat.js'
import type { Chat } from './services/chat.js'

export interface AppDeps {
  db: Db
  analyzer: Analyzer
  storage: Storage
  factory: Factory
  mailer: Mailer
  /** SimplyOpen Chat. Without it, changing things by chatting says it is not set up. */
  chat?: Chat
  /** Where the browser is, for the sign in link. */
  siteUrl?: string
  maxUploadBytes?: number
  logger?: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Who is asking, or null. Downloads and browse never need this. */
    viewer: User | null
  }
}

export const SESSION_COOKIE = 'so_session'

export function fail(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  return reply.code(status).send({ error: { code, message } })
}

export function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function setCookie(reply: FastifyReply, name: string, value: string, maxAgeSeconds: number): void {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (process.env.NODE_ENV === 'production') bits.push('Secure')
  reply.header('set-cookie', bits.join('; '))
}

/** Use at the top of any handler that needs somebody signed in. */
export function mustBeSignedIn(request: FastifyRequest, reply: FastifyReply): User | null {
  if (!request.viewer) {
    fail(reply, 401, 'SIGN_IN_NEEDED', 'Sign in first. Getting things never needs an account; this does.')
    return null
  }
  return request.viewer
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false })
  await app.register(multipart, {
    limits: { fileSize: deps.maxUploadBytes ?? 50 * 1024 * 1024, files: 1, fields: 10, parts: 11 },
  })

  app.decorateRequest('viewer', null)
  app.addHook('preHandler', async (request) => {
    const token = readCookie(request, SESSION_COOKIE)
    request.viewer = token ? await users.whoIs(deps.db, token) : null
  })

  app.get('/api/health', async () => ({ ok: true }))

  await registerAuth(app, deps)
  await registerBrowse(app, deps)
  await registerProjects(app, deps)
  await registerUploads(app, deps)
  await registerSuggestions(app, deps)
  await registerMe(app, deps)
  await registerChat(app, deps)

  app.setNotFoundHandler((request, reply) =>
    fail(reply, 404, 'NOT_FOUND', 'There is nothing at that address.'),
  )
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'unexpected error')
    const code = (error as { code?: string }).code
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      return fail(reply, 413, 'UPLOAD_TOO_LARGE', 'That file is bigger than we can take.')
    }
    return fail(reply, 500, 'INTERNAL_ERROR', 'Something went wrong at our end.')
  })

  return app
}

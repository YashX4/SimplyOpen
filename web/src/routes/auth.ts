/**
 * W9 and W10. A link in an email, no password anywhere, and the same link
 * makes the account if there is not one.
 */

import type { FastifyInstance } from 'fastify'
import { fail, readCookie, setCookie, SESSION_COOKIE, type AppDeps } from '../app.js'
import * as suggestions from '../repo/suggestions.js'
import * as users from '../repo/users.js'

const MONTH_SECONDS = 30 * 24 * 60 * 60
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function registerAuth(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const site = deps.siteUrl ?? 'http://localhost:5173'

  app.post<{ Body: { email?: string } }>('/api/auth/link', async (request, reply) => {
    const email = (request.body?.email ?? '').trim()
    if (!EMAIL.test(email)) {
      return fail(reply, 400, 'BAD_EMAIL', 'That does not look like an email address.')
    }
    const token = await users.startSignIn(deps.db, email)
    await deps.mailer.send({
      to: email,
      subject: 'Your link to sign in',
      text:
        `Open this on the computer you want to sign in on:\n\n` +
        `${site}/sign-in/done?token=${token}\n\n` +
        `It works once, and it stops working after an hour.`,
    })
    // The same answer whether or not that address has an account, so
    // nobody can use this to find out who has one.
    return reply.send({ sent: true })
  })

  app.get<{ Querystring: { token?: string } }>('/api/auth/callback', async (request, reply) => {
    const token = request.query.token ?? ''
    const result = token ? await users.completeSignIn(deps.db, token) : null
    if (!result) {
      // One message for never existed, already used and expired alike.
      return fail(reply, 400, 'LINK_NOT_GOOD', 'That link has been used already, or it has expired.')
    }
    setCookie(reply, SESSION_COOKIE, result.session, MONTH_SECONDS)
    return reply.send({ user: { id: result.user.id, name: result.user.name, email: result.user.email } })
  })

  app.post('/api/auth/sign-out', async (request, reply) => {
    const token = readCookie(request, SESSION_COOKIE)
    if (token) await users.signOut(deps.db, token)
    setCookie(reply, SESSION_COOKIE, '', 0)
    return reply.send({ signed_out: true })
  })

  app.get('/api/me', async (request, reply) => {
    if (!request.viewer) return reply.send({ user: null })
    return reply.send({
      user: { id: request.viewer.id, name: request.viewer.name, email: request.viewer.email },
      // The badge on My things, on every screen.
      waiting_suggestions: await suggestions.countWaitingForOwner(deps.db, request.viewer.id),
    })
  })
}

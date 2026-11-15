/**
 * Signing up and signing in with a username and password, beside the
 * emailed link in auth.ts. Both end in the same session cookie.
 *
 * - POST /api/auth/sign-up   { username, email, password, name? } → 201 { user }, signed in
 * - POST /api/auth/sign-in   { login, password }   login is a username or an email → { user }
 * - POST /api/auth/password  { password, current_password?, username? }   signed in only
 * - GET  /api/account        → { user } with the username, or { user: null }
 *
 * Passwords are never logged, stored or sent back.
 */

import type { FastifyInstance } from 'fastify'
import { fail, mustBeSignedIn, readCookie, setCookie, SESSION_COOKIE, type AppDeps } from '../app.js'
import * as accounts from '../repo/accounts.js'

const MONTH_SECONDS = 30 * 24 * 60 * 60

/** A body field as trimmed text, or '' if it is missing or not text. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function registerAccounts(app: FastifyInstance, deps: AppDeps): Promise<void> {
  // The same page the sign in link opens; it hands the token to /api/auth/callback.
  const site = deps.siteUrl ?? 'http://localhost:5173'

  app.post<{ Body: Record<string, unknown> }>('/api/auth/sign-up', async (request, reply) => {
    const username = text(request.body?.username)
    const email = text(request.body?.email)
    // A password is taken exactly as typed: spaces at the ends are part of it.
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    const problem =
      accounts.usernameProblem(username) ?? accounts.emailProblem(email) ?? accounts.passwordProblem(password, [username, email])
    if (problem) return fail(reply, 400, 'BAD_SIGN_UP', problem)

    const made = await accounts.signUp(deps.db, { username, email, password, name: text(request.body?.name) })
    if (!made.ok) {
      return made.code === 'USERNAME_TAKEN'
        ? fail(reply, 409, 'USERNAME_TAKEN', 'Someone already has that username. Try another.')
        : fail(reply, 409, 'EMAIL_TAKEN', 'That email already has an account. Sign in, or ask for a sign in link by email.')
    }
    await deps.mailer.send({
      to: email,
      subject: 'Confirm your email for SimplyOpen',
      text:
        `Welcome, ${username}. Open this to confirm this is your email address:\n\n` +
        `${site}/sign-in/done?token=${made.confirmToken}\n\n` +
        `It works once, and it stops working after an hour.\n` +
        `If you did not sign up, you can ignore this.`,
    })
    setCookie(reply, SESSION_COOKIE, made.session, MONTH_SECONDS)
    return reply.code(201).send({ user: made.user })
  })

  app.post<{ Body: Record<string, unknown> }>('/api/auth/sign-in', async (request, reply) => {
    const login = text(request.body?.login)
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    if (!login || !password) return fail(reply, 400, 'BAD_SIGN_IN', 'Type your username or email, and your password.')

    const result = await accounts.signIn(deps.db, login, password)
    if (!result.ok) {
      return result.code === 'LOCKED'
        ? fail(reply, 429, 'TOO_MANY_TRIES', `Too many wrong tries. Wait ${accounts.LOCK_MINUTES} minutes, or ask for a sign in link by email.`)
        : fail(reply, 401, 'WRONG_SIGN_IN', 'That username, email or password is not right.')
    }
    setCookie(reply, SESSION_COOKIE, result.session, MONTH_SECONDS)
    return reply.send({ user: result.user })
  })

  app.post<{ Body: Record<string, unknown> }>('/api/auth/password', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const me = await accounts.account(deps.db, viewer.id)
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    const current = typeof request.body?.current_password === 'string' ? request.body.current_password : undefined
    const username = text(request.body?.username)
    if (username && me?.username) return fail(reply, 400, 'HAS_USERNAME', 'You already have a username.')
    const problem =
      (username ? accounts.usernameProblem(username) : null) ??
      accounts.passwordProblem(password, [username || me?.username || '', viewer.email])
    if (problem) return fail(reply, 400, 'BAD_PASSWORD', problem)

    const result = await accounts.setPassword(deps.db, {
      userId: viewer.id,
      password,
      ...(current !== undefined ? { current } : {}),
      ...(username ? { username } : {}),
      keepSession: readCookie(request, SESSION_COOKIE) ?? '',
    })
    if (!result.ok) {
      return result.code === 'USERNAME_TAKEN'
        ? fail(reply, 409, 'USERNAME_TAKEN', 'Someone already has that username. Try another.')
        : fail(reply, 401, 'WRONG_PASSWORD', 'Your current password is not right.')
    }
    return reply.send({ user: await accounts.account(deps.db, viewer.id) })
  })

  app.get('/api/account', async (request, reply) => {
    return reply.send({ user: request.viewer ? await accounts.account(deps.db, request.viewer.id) : null })
  })
}

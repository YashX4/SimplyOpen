/**
 * Questions and answers on a project page.
 *
 * - GET    /api/projects/:slug/questions   what the viewer may see, and for the maker how many are waiting
 * - POST   /api/projects/:slug/questions   { text } ask one (signed in)
 * - POST   /api/questions/:id/answer       { text } answer it, or change the answer (the maker only)
 * - DELETE /api/questions/:id              remove it (the maker, or whoever asked)
 *
 * Reading needs no account. An unanswered question shows only to the
 * person who asked and to the maker.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { fail, mustBeSignedIn, type AppDeps } from '../app.js'
import * as projects from '../repo/projects.js'
import * as questions from '../repo/questions.js'
import type { Project, User } from '../types.js'
import { canEdit, canSee } from '../visibility.js'

const MAX_QUESTION = 300
const MAX_ANSWER = 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A body's "text" as one tidy line, or '' if it is missing or not text. */
function tidy(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

export async function registerQuestions(app: FastifyInstance, deps: AppDeps): Promise<void> {
  /** A project the viewer may see, or null with a 404 already sent. */
  async function visible(slug: string, viewer: string | null, reply: FastifyReply): Promise<Project | null> {
    const project = await projects.bySlug(deps.db, slug)
    if (!project || !canSee(project, viewer)) {
      fail(reply, 404, 'NO_SUCH_PROJECT', 'There is nothing here.')
      return null
    }
    return project
  }

  type WithSlug = { Params: { slug: string }; Body: { text?: unknown } | undefined }
  type WithId = { Params: { id: string }; Body: { text?: unknown } | undefined }

  app.get<WithSlug>('/api/projects/:slug/questions', async (request, reply) => {
    const viewer = request.viewer?.id ?? null
    const project = await visible(request.params.slug, viewer, reply)
    if (!project) return reply
    const isMaker = canEdit(project, viewer)
    return reply.send({
      questions: await questions.forProject(deps.db, project.id, viewer, isMaker),
      can_answer: isMaker,
      // Only the maker is told how many are waiting.
      waiting: isMaker ? await questions.waiting(deps.db, project.id) : null,
    })
  })

  app.post<WithSlug>('/api/projects/:slug/questions', async (request, reply) => {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return reply
    const project = await visible(request.params.slug, viewer.id, reply)
    if (!project) return reply
    const text = tidy(request.body?.text)
    if (!text) return fail(reply, 400, 'NO_QUESTION', 'Type your question first.')
    if (text.length > MAX_QUESTION) return fail(reply, 400, 'QUESTION_TOO_LONG', `Keep the question to ${MAX_QUESTION} characters.`)
    const asked = await questions.ask(deps.db, project.id, viewer.id, text)
    if (!asked) {
      return fail(reply, 429, 'TOO_MANY_WAITING', `You already have ${questions.MAX_WAITING_PER_PERSON} questions waiting here. Give the maker a chance to answer.`)
    }
    return reply.code(201).send({ id: asked.id, questions: await questions.forProject(deps.db, project.id, viewer.id, canEdit(project, viewer.id)) })
  })

  /**
   * The question in the address and its project, if the viewer may see the
   * project; otherwise null with the answer already sent.
   */
  async function found(request: FastifyRequest<WithId>, reply: FastifyReply): Promise<{ viewer: User; question: questions.QuestionRow; project: Project } | null> {
    const viewer = mustBeSignedIn(request, reply)
    if (!viewer) return null
    const question = UUID.test(request.params.id) ? await questions.byId(deps.db, request.params.id) : null
    const project = question ? await projects.byId(deps.db, question.project_id) : null
    if (!question || !project || !canSee(project, viewer.id)) {
      fail(reply, 404, 'NO_SUCH_QUESTION', 'There is no question with that id.')
      return null
    }
    return { viewer, question, project }
  }

  app.post<WithId>('/api/questions/:id/answer', async (request, reply) => {
    const got = await found(request, reply)
    if (!got) return reply
    if (!canEdit(got.project, got.viewer.id)) return fail(reply, 403, 'NOT_YOURS', 'Only the person who made the project can answer.')
    const text = tidy(request.body?.text)
    if (!text) return fail(reply, 400, 'NO_ANSWER', 'Type your answer first.')
    if (text.length > MAX_ANSWER) return fail(reply, 400, 'ANSWER_TOO_LONG', `Keep the answer to ${MAX_ANSWER} characters.`)
    await questions.answer(deps.db, got.question.id, got.viewer.id, text)
    return reply.send({ questions: await questions.forProject(deps.db, got.project.id, got.viewer.id, true) })
  })

  app.delete<WithId>('/api/questions/:id', async (request, reply) => {
    const got = await found(request, reply)
    if (!got) return reply
    const mayRemove = canEdit(got.project, got.viewer.id) || got.question.asked_by === got.viewer.id
    if (!mayRemove) return fail(reply, 403, 'NOT_YOURS', 'Only the maker, or whoever asked, can remove a question.')
    await questions.remove(deps.db, got.question.id)
    return reply.code(204).send()
  })
}

/** Questions and answers on a project page. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as projects from '../src/repo/projects.js'
import { MAX_WAITING_PER_PERSON } from '../src/repo/questions.js'
import * as versions from '../src/repo/versions.js'
import { harness, type Harness } from './helpers.js'

const DEMO = 'zoom-transcripts-to-nvivo'
const URL = `/api/projects/${DEMO}/questions`

type Person = { id: string; cookie: string }
let h: Harness
let maker: Person // Priya, who made the seeded demo project
let asker: Person
let other: Person

beforeEach(async () => {
  h = await harness()
  maker = await h.signIn('p.raman@leeds.ac.uk')
  asker = await h.signIn('asker@example.com', 'Ada')
  other = await h.signIn('other@example.com', 'Otto')
})
afterEach(async () => { await h.close() })

const send = (method: 'GET' | 'POST' | 'DELETE', url: string, who?: Person, payload?: object) =>
  h.app.inject({ method, url, ...(who ? { headers: { cookie: who.cookie } } : {}), ...(payload ? { payload } : {}) })
const ask = async (text: unknown, who: Person = asker) => send('POST', URL, who, { text } as object)
const answer = (id: string, text: unknown, who: Person = maker) => send('POST', `/api/questions/${id}/answer`, who, { text } as object)
const seenBy = async (who?: Person) => (await send('GET', URL, who)).json() as {
  questions: { id: string; text: string; answer: string | null; asked_by_name: string; answered_by_name: string | null; is_yours: boolean }[]
  can_answer: boolean
  waiting: number | null
}
const texts = async (who?: Person) => (await seenBy(who)).questions.map((q) => q.text)

describe('asking', () => {
  it('anyone signed in can ask; until it is answered only they and the maker see it', async () => {
    const asked = await ask('  Does it work with\n Teams transcripts? ')
    expect(asked.statusCode).toBe(201)
    expect(asked.json().questions).toMatchObject([{ text: 'Does it work with Teams transcripts?', answer: null, is_yours: true, asked_by_name: 'Ada' }])

    expect(await texts(asker)).toEqual(['Does it work with Teams transcripts?'])
    expect(await texts(maker)).toEqual(['Does it work with Teams transcripts?'])
    expect(await texts(other)).toEqual([])
    expect(await texts()).toEqual([])
  })

  it('needs an account, a question, and a sensible length', async () => {
    expect((await send('POST', URL, undefined, { text: 'Hi?' })).statusCode).toBe(401)
    for (const [text, code] of [['   ', 'NO_QUESTION'], [5, 'NO_QUESTION'], ['x'.repeat(301), 'QUESTION_TOO_LONG']] as const) {
      const reply = await ask(text)
      expect([reply.statusCode, reply.json().error.code]).toEqual([400, code])
    }
    expect(await texts(maker)).toEqual([])
  })

  it('one person can only have a few questions waiting on a project', async () => {
    for (let i = 0; i < MAX_WAITING_PER_PERSON; i += 1) expect((await ask(`Question ${i}?`)).statusCode).toBe(201)
    const tooMany = await ask('One more?')
    expect([tooMany.statusCode, tooMany.json().error.code]).toEqual([429, 'TOO_MANY_WAITING'])
    expect((await ask('Mine?', other)).statusCode).toBe(201) // someone else still can

    // Once one is answered, there is room again.
    await answer((await seenBy(asker)).questions[0]!.id, 'Yes.')
    expect((await ask('And another?')).statusCode).toBe(201)
  })
})

describe('answering', () => {
  it('the maker answers, and then everyone sees it, with who answered', async () => {
    const id = (await ask('Where do the finished files go?')).json().id
    const reply = await answer(id, 'Into whatever folder you pick when you press Run.')
    expect(reply.statusCode).toBe(200)

    const page = await seenBy() // nobody signed in
    expect(page).toMatchObject({ can_answer: false, waiting: null })
    expect(page.questions).toMatchObject([
      { text: 'Where do the finished files go?', answer: 'Into whatever folder you pick when you press Run.', answered_by_name: 'Priya Raman', is_yours: false },
    ])
    expect((await seenBy(asker)).questions[0]!.is_yours).toBe(true)
  })

  it('only the maker can answer', async () => {
    const id = (await ask('Why?')).json().id
    for (const who of [asker, other]) {
      const reply = await answer(id, 'Because.', who)
      expect([reply.statusCode, reply.json().error.code]).toEqual([403, 'NOT_YOURS'])
    }
    expect((await send('POST', `/api/questions/${id}/answer`, undefined, { text: 'x' })).statusCode).toBe(401)
    expect((await seenBy(maker)).questions[0]!.answer).toBeNull()
  })

  it('the maker sees how many are waiting, and can change an answer', async () => {
    const first = (await ask('One?')).json().id
    await ask('Two?', other)
    expect(await seenBy(maker)).toMatchObject({ can_answer: true, waiting: 2 })
    await answer(first, 'Yes.')
    await answer(first, 'Yes, since version 3.')
    const page = await seenBy(maker)
    expect(page.waiting).toBe(1)
    // Answered ones come first, then the ones still waiting.
    expect(page.questions.map((q) => [q.text, q.answer])).toEqual([['One?', 'Yes, since version 3.'], ['Two?', null]])
  })

  it('an answer needs words and a sensible length', async () => {
    const id = (await ask('Why?')).json().id
    expect((await answer(id, ' ')).json().error.code).toBe('NO_ANSWER')
    expect((await answer(id, 'x'.repeat(1001))).json().error.code).toBe('ANSWER_TOO_LONG')
    expect((await answer('not-an-id', 'x')).statusCode).toBe(404)
  })
})

describe('removing', () => {
  it('the maker or the asker can remove a question; nobody else', async () => {
    const mine = (await ask('Remove me?')).json().id
    const theirs = (await ask('And me?', other)).json().id
    expect((await send('DELETE', `/api/questions/${theirs}`, asker)).json().error.code).toBe('NOT_YOURS')
    expect((await send('DELETE', `/api/questions/${mine}`)).statusCode).toBe(401)
    expect((await send('DELETE', `/api/questions/${mine}`, asker)).statusCode).toBe(204)
    expect((await send('DELETE', `/api/questions/${theirs}`, maker)).statusCode).toBe(204)
    expect(await texts(maker)).toEqual([])
    expect((await send('DELETE', `/api/questions/${mine}`, asker)).statusCode).toBe(404)
  })
})

describe('private projects', () => {
  it('their questions do not exist to anyone but the owner', async () => {
    const project = await projects.create(h.db, { owner: maker.id, slug: 'secret', name: 'Secret', visibility: 'private' })
    await versions.append(h.db, { project_id: project.id, note: 'First version.', created_by: maker.id })
    const id = (await send('POST', '/api/projects/secret/questions', maker, { text: 'Note to self?' })).json().id

    expect((await send('GET', '/api/projects/secret/questions', other)).statusCode).toBe(404)
    expect((await send('GET', '/api/projects/secret/questions')).statusCode).toBe(404)
    expect((await send('POST', '/api/projects/secret/questions', other, { text: 'Hello?' })).statusCode).toBe(404)
    expect((await answer(id, 'Sneaky', other)).statusCode).toBe(404)
    expect((await send('DELETE', `/api/questions/${id}`, other)).statusCode).toBe(404)
    expect((await send('GET', '/api/projects/secret/questions', maker)).json().questions).toHaveLength(1)
  })

  it('questions on one project never show on another', async () => {
    const project = await projects.create(h.db, { owner: maker.id, slug: 'other-tool', name: 'Other', visibility: 'public' })
    await versions.append(h.db, { project_id: project.id, note: 'First version.', created_by: maker.id })
    await send('POST', '/api/projects/other-tool/questions', asker, { text: 'About the other one?' })
    expect(await texts(maker)).toEqual([])
  })
})

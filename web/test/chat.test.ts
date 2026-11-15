/**
 * Changing a copy by talking: the conversation is kept, the AI picks up
 * where the person left off, and every change becomes a version. The chat
 * service itself is replaced by a fake that records what it was asked.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { ChatUnavailable, type ChatAnswer, type ChatService, type EarlierMessage } from '../src/services/chat.js'
import { harness, type Harness } from './helpers.js'

const DEMO = 'zoom-transcripts-to-nvivo'
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const text = (data: Uint8Array | undefined): string => new TextDecoder().decode(data)

/** What the fake chat service does with the next message. */
type Next = { reply: string; newCode?: string; ready?: boolean } | 'privacy' | 'busy' | 'fail'

class FakeChat implements ChatService {
  /** Live sessions: id → the code they hold. Deleting one makes it "expire". */
  readonly sessions = new Map<string, string>()
  readonly started: { code: string; earlier: EarlierMessage[] }[] = []
  readonly sent: { sessionId: string; message: string; confirmPrivate: boolean }[] = []
  next: Next[] = []

  async start(zip: Uint8Array, earlier: EarlierMessage[]): Promise<string> {
    const id = `session-${this.started.length + 1}`
    this.sessions.set(id, text(zip))
    this.started.push({ code: text(zip), earlier })
    return id
  }

  async send(sessionId: string, message: string, confirmPrivate: boolean): Promise<ChatAnswer | 'gone' | 'busy'> {
    if (!this.sessions.has(sessionId)) return 'gone'
    this.sent.push({ sessionId, message, confirmPrivate })
    const next = this.next.shift() ?? { reply: 'ok' }
    if (next === 'busy') return 'busy'
    if (next === 'fail') throw new ChatUnavailable()
    if (next === 'privacy') return { kind: 'privacy_reminder', reminder: 'Before I send this…', found: ['an email address'] }
    if (next.newCode !== undefined) this.sessions.set(sessionId, next.newCode)
    return {
      kind: 'reply',
      reply: next.reply,
      changed: next.newCode !== undefined,
      label: next.newCode !== undefined ? `You asked: ${message}` : null,
      ready_to_download: next.ready === true,
      stopped_early: false,
    }
  }

  async zip(sessionId: string): Promise<Uint8Array> {
    return bytes(this.sessions.get(sessionId) ?? '')
  }
}

let h: Harness
let app: Awaited<ReturnType<typeof buildApp>>
let chat: FakeChat
let me: { id: string; cookie: string }
let copyId: string

beforeEach(async () => {
  h = await harness()
  chat = new FakeChat()
  app = await buildApp({ db: h.db, analyzer: h.analyzer, storage: h.storage, factory: h.factory, mailer: h.mailer, chat })
  // Give the demo's newest version some code, so a copy of it can be changed.
  const stored = await h.storage.put('uploads/demo/project.zip', bytes('code v1'), 'application/zip')
  await h.db.query(
    'update versions set source_zip_url = $2 where number = 5 and project_id = (select id from projects where slug = $1)',
    [DEMO, stored.url],
  )
  me = await h.signIn('me@example.com', 'Me')
  copyId = await copyFor(me.cookie)
})
afterEach(async () => {
  await app.close()
  await h.close()
})

async function copyFor(cookie: string): Promise<string> {
  return (await app.inject({ method: 'POST', url: `/api/projects/${DEMO}/copies`, headers: { cookie }, payload: {} })).json().copy.id
}

const say = (message: unknown, extra: object = {}, cookie = me.cookie, id = copyId) =>
  app.inject({ method: 'POST', url: `/api/copies/${id}/chat`, headers: { cookie }, payload: { message, ...extra } as object })
const saved = async (cookie = me.cookie, id = copyId) =>
  (await app.inject({ method: 'GET', url: `/api/copies/${id}/chat`, headers: { cookie } })).json().messages as {
    role: string; text: string; version_number: number | null
  }[]
const versions = async () =>
  (await app.inject({ method: 'GET', url: `/api/copies/${copyId}/versions`, headers: { cookie: me.cookie } })).json().versions as {
    number: number; note: string; source_zip_url: string
  }[]

describe('chatting about a copy', () => {
  it('starts the AI on the copy\'s code, and saves what was said', async () => {
    chat.next = [{ reply: 'Which colour would you like?' }]
    const reply = await say('Change the colour')
    expect(reply.statusCode).toBe(200)
    expect(reply.json()).toMatchObject({ kind: 'reply', reply: 'Which colour would you like?', version: null, ready_to_download: null })

    expect(chat.started).toEqual([{ code: 'code v1', earlier: [] }])
    expect(await saved()).toMatchObject([
      { role: 'you', text: 'Change the colour', version_number: null },
      { role: 'assistant', text: 'Which colour would you like?', version_number: null },
    ])
    expect(await versions()).toHaveLength(1) // a question back changes nothing
  })

  it('every change the person asks for becomes a version, with its code stored', async () => {
    chat.next = [{ reply: 'The walls are blue now.', newCode: 'code v2' }, { reply: 'Bigger now.', newCode: 'code v3' }]
    const first = await say('Make the walls blue')
    expect(first.json().version).toMatchObject({ number: 2, note: 'You asked: Make the walls blue' })
    await say('Make the button bigger')

    const all = await versions()
    expect(all.map((v) => [v.number, v.note])).toEqual([
      [3, 'You asked: Make the button bigger'],
      [2, 'You asked: Make the walls blue'],
      [1, 'Copied from version 5 of Zoom transcripts to NVivo.'],
    ])
    const codeOf = (url: string) => text([...h.storage.files].find(([path]) => h.storage.urlFor(path) === url)?.[1].bytes)
    expect([codeOf(all[0]!.source_zip_url), codeOf(all[1]!.source_zip_url)]).toEqual(['code v3', 'code v2'])
    expect((await saved()).map((m) => m.version_number)).toEqual([null, 2, null, 3])
    expect(chat.started).toHaveLength(1) // one session served both messages
  })

  it('picks up where they left off after the AI\'s session is gone', async () => {
    chat.next = [{ reply: 'The walls are blue now.', newCode: 'code v2' }]
    await say('Make the walls blue')
    chat.sessions.clear() // the chat service restarted, or the session expired

    chat.next = [{ reply: 'They are blue, as you asked before.' }]
    expect((await say('What colour are the walls?')).json().reply).toBe('They are blue, as you asked before.')

    // A new session, started from the newest code and the saved conversation.
    expect(chat.started[1]).toEqual({
      code: 'code v2',
      earlier: [
        { role: 'user', text: 'Make the walls blue' },
        { role: 'assistant', text: 'The walls are blue now.' },
      ],
    })
    expect(await saved()).toHaveLength(4)
  })

  it('after going back a version, the AI works on that version\'s code', async () => {
    chat.next = [{ reply: 'Blue.', newCode: 'code v2' }]
    await say('Make the walls blue')
    await app.inject({ method: 'POST', url: `/api/copies/${copyId}/versions/1/restore`, headers: { cookie: me.cookie } })

    chat.next = [{ reply: 'Green.', newCode: 'code v4' }]
    expect((await say('Make them green')).json().version).toMatchObject({ number: 4 })
    expect(chat.started[1]!.code).toBe('code v1') // not the blue code the old session still held
    expect(chat.sent.at(-1)!.sessionId).toBe('session-2')
  })

  it('when they say they are happy, the newest version is offered as a download', async () => {
    chat.next = [{ reply: 'Blue.', newCode: 'code v2' }, { reply: 'Here is your download.', ready: true }]
    await say('Make the walls blue')
    expect((await say('Perfect, I will take it')).json()).toMatchObject({ ready_to_download: 2, version: null })
  })

  it('a private-looking message gets the reminder, and nothing is saved until they confirm', async () => {
    chat.next = ['privacy', { reply: 'ok' }]
    const reminder = await say('Email it to jane@example.com')
    expect(reminder.json()).toEqual({ kind: 'privacy_reminder', reminder: 'Before I send this…', found: ['an email address'] })
    expect(await saved()).toEqual([])

    await say('Email it to jane@example.com', { confirm_private: true })
    expect(chat.sent.map((s) => s.confirmPrivate)).toEqual([false, true])
    expect(await saved()).toHaveLength(2)
  })
})

describe('each person\'s chat is their own', () => {
  it('two people with copies of the same project never see each other\'s conversation', async () => {
    const other = await h.signIn('other@example.com')
    const otherCopy = await copyFor(other.cookie)
    chat.next = [{ reply: 'Blue for you.', newCode: 'mine' }, { reply: 'Red for you.', newCode: 'theirs' }]
    await say('Make it blue')
    await say('Make it red', {}, other.cookie, otherCopy)

    expect((await saved()).map((m) => m.text)).toEqual(['Make it blue', 'Blue for you.'])
    expect((await saved(other.cookie, otherCopy)).map((m) => m.text)).toEqual(['Make it red', 'Red for you.'])
    expect(chat.started).toHaveLength(2) // a session each
  })

  it('someone else\'s copy does not exist, to read or to write', async () => {
    const other = await h.signIn('other@example.com')
    await say('Make it blue')
    for (const reply of [
      await app.inject({ method: 'GET', url: `/api/copies/${copyId}/chat`, headers: { cookie: other.cookie } }),
      await say('Let me in', {}, other.cookie),
    ]) {
      expect([reply.statusCode, reply.json().error.code]).toEqual([404, 'NO_SUCH_COPY'])
    }
    expect((await app.inject({ method: 'GET', url: `/api/copies/${copyId}/chat` })).statusCode).toBe(401)
    expect(chat.sent).toHaveLength(1)
  })
})

describe('when things go wrong', () => {
  it.each([
    ['an empty message', '   ', 400, 'NO_MESSAGE'],
    ['a message that is not text', 5, 400, 'NO_MESSAGE'],
    ['a message that is too long', 'x'.repeat(4001), 400, 'MESSAGE_TOO_LONG'],
  ])('refuses %s', async (_label, message, status, code) => {
    const reply = await say(message)
    expect([reply.statusCode, reply.json().error.code]).toEqual([status, code])
    expect(chat.started).toHaveLength(0)
  })

  it('says so when the AI is still busy, or the chat service is down, and saves nothing', async () => {
    chat.next = ['busy', 'fail']
    expect([(await say('one')).statusCode, (await say('two')).statusCode]).toEqual([409, 502])
    expect(await saved()).toEqual([])
  })

  it('a copy with no stored code cannot be changed', async () => {
    const empty = (await app.inject({ method: 'POST', url: `/api/projects/${DEMO}/copies`, headers: { cookie: me.cookie }, payload: { version: 1 } })).json().copy.id
    const reply = await say('Change it', {}, me.cookie, empty)
    expect([reply.statusCode, reply.json().error.code]).toEqual([409, 'NO_CODE'])
  })

  it('answers 503 when no chat service is set up', async () => {
    const reply = await h.app.inject({ method: 'POST', url: `/api/copies/${copyId}/chat`, headers: { cookie: me.cookie }, payload: { message: 'hi' } })
    expect([reply.statusCode, reply.json().error.code]).toEqual([503, 'CHAT_NOT_SET_UP'])
  })
})

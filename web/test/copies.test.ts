/** A person's own copy of a project, and the copy's version history. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { harness, multipartBody, SOME_ZIP, type Harness } from './helpers.js'

let h: Harness
let me: { id: string; cookie: string }
let copyId: string
beforeEach(async () => {
  h = await harness()
  // Give the demo project's third version some code to copy.
  await h.db.query(
    `update versions set source_zip_url = 'memory://files/demo-v3.zip'
     where number = 3 and project_id = (select id from projects where slug = $1)`,
    [DEMO],
  )
  me = await h.signIn('me@example.com', 'Me')
  copyId = await makeCopy(me.cookie, 3)
})
afterEach(async () => { await h.close() })

const DEMO = 'zoom-transcripts-to-nvivo'

async function makeCopy(cookie: string, version?: number): Promise<string> {
  const reply = await h.app.inject({
    method: 'POST', url: `/api/projects/${DEMO}/copies`, headers: { cookie }, payload: version ? { version } : {},
  })
  return reply.json().copy.id
}

const get = (url: string, cookie = me.cookie) => h.app.inject({ method: 'GET', url, headers: { cookie } })
const post = (url: string, cookie = me.cookie) => h.app.inject({ method: 'POST', url, headers: { cookie } })

/** Save a new version of a copy: a zip and a note. */
function save(note: string | null, bytes: Uint8Array = SOME_ZIP, cookie = me.cookie, id = copyId) {
  const body = multipartBody({ field: 'file', filename: 'code.zip', bytes }, note === null ? {} : { note })
  return h.app.inject({ method: 'POST', url: `/api/copies/${id}/versions`, payload: body.payload, headers: { ...body.headers, cookie } })
}

const versionsOf = async (id = copyId) => (await get(`/api/copies/${id}/versions`)).json().versions as {
  number: number; note: string; source_zip_url: string | null; restored_from: number | null; is_current: boolean
}[]

describe('a copy', () => {
  it('starts as version 1: the code it was copied from, and says where that was', async () => {
    expect(await versionsOf()).toMatchObject([
      { number: 1, note: 'Copied from version 3 of Zoom transcripts to NVivo.', source_zip_url: 'memory://files/demo-v3.zip', is_current: true },
    ])
    // Asking again never makes a second version 1.
    expect(await versionsOf()).toHaveLength(1)
    // The copy itself, with where it came from, is the page's own address.
    expect((await get(`/api/copies/${copyId}`)).json()).toMatchObject({
      project: { slug: DEMO, maker: 'Priya Raman' }, from_version: { number: 3 },
    })
  })

  it('every change kept becomes the next version, newest first, with its code stored', async () => {
    const first = await save('You asked: put speaker names in brackets')
    expect(first.statusCode).toBe(201)
    expect(first.json().version).toMatchObject({ number: 2, note: 'You asked: put speaker names in brackets', restored_from: null })
    await save('You asked:\n  make the   button bigger')

    const all = await versionsOf()
    expect(all.map((v) => [v.number, v.note, v.is_current])).toEqual([
      [3, 'You asked: make the button bigger', true],
      [2, 'You asked: put speaker names in brackets', false],
      [1, 'Copied from version 3 of Zoom transcripts to NVivo.', false],
    ])
    // Each save stored its own zip, and the copy now points at the newest.
    expect(new Set(all.map((v) => v.source_zip_url)).size).toBe(3)
    expect(h.storage.files.size).toBe(2)
    // The copy's own row moves along too, which is what Yash's "things you made" page reads.
    expect((await h.db.query('select working_zip_url from copies where id = $1', [copyId])).rows[0]).toEqual({ working_zip_url: all[0]!.source_zip_url })
  })

  it('the original project is never touched', async () => {
    await save('You asked: change everything')
    const project = (await h.app.inject({ method: 'GET', url: `/api/projects/${DEMO}/versions` })).json().versions
    expect(project).toHaveLength(5)
  })

  it('going back adds a new version with the old code, so nothing is lost', async () => {
    await save('Second')
    await save('Third')
    const back = await post(`/api/copies/${copyId}/versions/1/restore`)
    expect(back.json().version).toMatchObject({ number: 4, note: 'Went back to version 1.', restored_from: 1, source_zip_url: 'memory://files/demo-v3.zip' })

    const all = await versionsOf()
    expect(all.map((v) => v.number)).toEqual([4, 3, 2, 1])
    expect((await h.db.query<{ working_zip_url: string }>('select working_zip_url from copies where id = $1', [copyId])).rows[0]!.working_zip_url).toBe('memory://files/demo-v3.zip')
    // And forward again, to version 3.
    expect((await post(`/api/copies/${copyId}/versions/3/restore`)).json().version).toMatchObject({ number: 5, restored_from: 3 })
    // Going back to the newest is nothing to do.
    expect((await post(`/api/copies/${copyId}/versions/5/restore`)).json()).toEqual({ version: null })
    expect(await versionsOf()).toHaveLength(5)
  })

  it('any version\'s code can be fetched', async () => {
    await save('Second')
    const second = (await versionsOf())[0]!
    const reply = await get(`/api/copies/${copyId}/versions/2/download`)
    expect([reply.statusCode, reply.headers.location]).toEqual([302, second.source_zip_url])
    expect((await get(`/api/copies/${copyId}/versions/1/download`)).headers.location).toBe('memory://files/demo-v3.zip')
  })

  it('a copy of a version with no stored code says so', async () => {
    const empty = await makeCopy(me.cookie, 1) // the seeded version 1 has no zip
    const reply = await get(`/api/copies/${empty}/versions/1/download`)
    expect([reply.statusCode, reply.json().error.code]).toEqual([409, 'NO_CODE'])
  })

  it('saves at the same moment each get their own number', async () => {
    const replies = await Promise.all(['a', 'b', 'c', 'd'].map((note) => save(note)))
    expect(replies.map((r) => r.statusCode)).toEqual([201, 201, 201, 201])
    expect((await versionsOf()).map((v) => v.number)).toEqual([5, 4, 3, 2, 1])
  })
})

describe('a copy is private to its owner', () => {
  it('its versions share a table with project versions, but are never reachable as one', async () => {
    await save('A private change')
    const { rows } = await h.db.query<{ id: string }>('select id from versions where copy_id = $1', [copyId])
    expect(rows).toHaveLength(2) // one table: the copy's versions are rows in `versions`
    for (const { id } of rows) {
      for (const url of [`/api/versions/${id}`, `/api/versions/${id}/outcome`, `/api/download/${id}/mac`]) {
        // Even the copy's owner gets nothing here: these addresses are for project versions.
        expect([url, (await get(url)).statusCode]).toEqual([url, 404])
      }
      expect((await post(`/api/versions/${id}/refresh`)).statusCode).toBe(404)
    }
    // A row must belong to a project or a copy, never both and never neither.
    await expect(h.db.query("insert into versions (number, note, created_by) values (1, 'x', $1)", [me.id])).rejects.toThrow()
  })

  it('to anyone else, and to nobody signed in, it does not exist', async () => {
    const other = await h.signIn('other@example.com')
    const urls: [string, string][] = [
      ['GET', `/api/copies/${copyId}`],
      ['GET', `/api/copies/${copyId}/versions`],
      ['POST', `/api/copies/${copyId}/versions/1/restore`],
      ['GET', `/api/copies/${copyId}/versions/1/download`],
    ]
    for (const [method, url] of urls) {
      const asOther = await h.app.inject({ method: method as 'GET', url, headers: { cookie: other.cookie } })
      expect([url, asOther.statusCode, asOther.json().error.code]).toEqual([url, 404, 'NO_SUCH_COPY'])
      expect((await h.app.inject({ method: method as 'GET', url })).statusCode).toBe(401)
    }
    expect((await save('Not mine', SOME_ZIP, other.cookie)).statusCode).toBe(404)
    expect(await versionsOf()).toHaveLength(1)
    expect(h.storage.files.size).toBe(0) // nothing was stored for the stranger
  })

  it('an id that is not an id is simply not found', async () => {
    for (const id of ['nope', "1' or '1'='1", '../x']) {
      expect((await get(`/api/copies/${encodeURIComponent(id)}/versions`)).statusCode).toBe(404)
    }
  })
})

describe('saving a version checks what it is given', () => {
  it.each([
    ['no note', () => save(null), 'NO_NOTE'],
    ['an empty note', () => save('   '), 'NO_NOTE'],
    ['a note that is too long', () => save('x'.repeat(201)), 'NOTE_TOO_LONG'],
    ['a file that is not a zip', () => save('Changed', new TextEncoder().encode('hello')), 'NOT_A_ZIP'],
    ['an empty file', () => save('Changed', new Uint8Array()), 'NO_FILE'],
  ] as const)('refuses %s', async (_label, send, code) => {
    const reply = await send()
    expect([reply.statusCode, reply.json().error.code]).toEqual([400, code])
    expect(await versionsOf()).toHaveLength(1)
    expect(h.storage.files.size).toBe(0)
  })

  it('refuses something that is not an upload, or a version that does not exist', async () => {
    const plain = await h.app.inject({ method: 'POST', url: `/api/copies/${copyId}/versions`, headers: { cookie: me.cookie }, payload: { note: 'x' } })
    expect([plain.statusCode, plain.json().error.code]).toEqual([415, 'NOT_MULTIPART'])
    for (const n of ['0', '2', '1.5', 'abc', '-1']) {
      expect((await post(`/api/copies/${copyId}/versions/${n}/restore`)).json().error.code).toBe('NO_SUCH_VERSION')
      expect((await get(`/api/copies/${copyId}/versions/${n}/download`)).statusCode).toBe(404)
    }
  })
})

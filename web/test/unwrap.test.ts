import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { unwrapSingleZip } from '../src/services/unwrap.js'

/** A real zip, built by hand: local headers, central directory, end record. */
function zip(files: { name: string; data: Uint8Array; deflate?: boolean }[]): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name)
    const body = f.deflate ? deflateRawSync(f.data) : Buffer.from(f.data)
    const method = f.deflate ? 8 : 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(f.data.byteLength, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(f.data.byteLength, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

const APP = zip([{ name: 'Image Resizer/app.txt', data: new TextEncoder().encode('the app') }])

describe('a download from GitHub', () => {
  it('takes the app out of the zip GitHub wraps it in', () => {
    const wrapped = zip([{ name: 'Image Resizer-0.0.1-win.zip', data: APP, deflate: true }])
    expect(Buffer.from(unwrapSingleZip(wrapped))).toEqual(Buffer.from(APP))
  })

  it('also copes with a wrapper that did not compress', () => {
    const wrapped = zip([{ name: 'app.zip', data: APP }])
    expect(Buffer.from(unwrapSingleZip(wrapped))).toEqual(Buffer.from(APP))
  })

  it('leaves a zip alone when it holds more than one file', () => {
    const two = zip([
      { name: 'a.zip', data: APP },
      { name: 'b.zip', data: APP },
    ])
    expect(unwrapSingleZip(two)).toBe(two)
  })

  it('leaves a zip alone when its one file is not a zip', () => {
    expect(unwrapSingleZip(APP)).toBe(APP)
  })

  it('leaves anything that is not a zip at all alone', () => {
    const junk = new TextEncoder().encode('not a zip')
    expect(unwrapSingleZip(junk)).toBe(junk)
    const empty = new Uint8Array(0)
    expect(unwrapSingleZip(empty)).toBe(empty)
  })
})

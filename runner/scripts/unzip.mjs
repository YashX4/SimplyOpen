// Unpacks a zip with nothing but Node, the same way on Mac, Windows and Linux.
//
// The build used to call the system's own tool: unzip on Mac and Linux, tar on
// Windows. Those disagree about file names. A screenshot taken on a Mac is
// named like "Screenshot 2026-02-04 at 9.53.44 AM.png" with a special narrow
// space before "AM", and unzip on the Mac build machine stopped dead on it, so
// the whole Mac build failed. Reading the zip ourselves avoids all of that.
//
// What it does:
//   - names are read as UTF-8, whether or not the zip says they are, which is
//     how a Mac writes them; anything that is not UTF-8 is read as Latin-1;
//   - the __MACOSX folder and ._ files a Mac adds are left out;
//   - no entry may land outside the destination folder;
//   - on Windows, characters Windows does not allow in a name become "_";
//   - files marked runnable stay runnable on Mac and Linux.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const END = 0x06054b50
const END64_LOCATOR = 0x07064b50
const END64 = 0x06064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const UTF8_FLAG = 0x800

function findEnd(buf) {
  const last = buf.length - 22
  for (let i = last; i >= Math.max(0, last - 0xffff); i--) {
    if (buf.readUInt32LE(i) === END) return i
  }
  throw new Error('This is not a zip file.')
}

function decodeName(raw, flags) {
  if (flags & UTF8_FLAG) return raw.toString('utf8')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    return raw.toString('latin1')
  }
}

/** Sizes and offsets that did not fit in 32 bits live in a zip64 extra field. */
function zip64(extra, sizes) {
  let at = 0
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at)
    const length = extra.readUInt16LE(at + 2)
    if (id === 0x0001) {
      let p = at + 4
      const take = () => { const v = Number(extra.readBigUInt64LE(p)); p += 8; return v }
      if (sizes.size === 0xffffffff) sizes.size = take()
      if (sizes.compressed === 0xffffffff) sizes.compressed = take()
      if (sizes.offset === 0xffffffff) sizes.offset = take()
      return sizes
    }
    at += 4 + length
  }
  return sizes
}

function safeName(name) {
  const parts = name.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
  if (parts.some((p) => p === '..')) return null
  if (process.platform !== 'win32') return parts
  // Windows refuses these in names, and names that end in a dot or space.
  return parts.map((p) => p.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, (m) => '_'.repeat(m.length)))
}

/**
 * Unpacks `zipPath` into `destination`. Returns how many files it wrote and
 * which it left out, with why.
 */
export function unzip(zipPath, destination) {
  const buf = readFileSync(zipPath)
  const root = resolve(destination)
  mkdirSync(root, { recursive: true })

  const end = findEnd(buf)
  let entries = buf.readUInt16LE(end + 10)
  let central = buf.readUInt32LE(end + 16)
  const locator = end - 20
  if ((entries === 0xffff || central === 0xffffffff) && locator >= 0 && buf.readUInt32LE(locator) === END64_LOCATOR) {
    const end64 = Number(buf.readBigUInt64LE(locator + 8))
    if (buf.readUInt32LE(end64) === END64) {
      entries = Number(buf.readBigUInt64LE(end64 + 32))
      central = Number(buf.readBigUInt64LE(end64 + 48))
    }
  }

  let written = 0
  const skipped = []
  let at = central
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(at) !== CENTRAL) throw new Error('The zip file is damaged.')
    const flags = buf.readUInt16LE(at + 8)
    const method = buf.readUInt16LE(at + 10)
    const nameLength = buf.readUInt16LE(at + 28)
    const extraLength = buf.readUInt16LE(at + 30)
    const commentLength = buf.readUInt16LE(at + 32)
    const attributes = buf.readUInt32LE(at + 38)
    const name = decodeName(buf.subarray(at + 46, at + 46 + nameLength), flags)
    const sizes = zip64(buf.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), {
      compressed: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
    })
    at += 46 + nameLength + extraLength + commentLength

    const parts = safeName(name)
    if (!parts || parts.length === 0) { skipped.push(`${name} (outside the folder)`); continue }
    if (parts[0] === '__MACOSX' || parts[parts.length - 1].startsWith('._')) continue
    const target = join(root, ...parts)
    if (target !== root && !target.startsWith(root + sep)) { skipped.push(`${name} (outside the folder)`); continue }

    const unixMode = attributes >>> 16
    const isFolder = name.endsWith('/') || (unixMode & 0o170000) === 0o040000
    if (isFolder) { mkdirSync(target, { recursive: true }); continue }
    if ((unixMode & 0o170000) === 0o120000) { skipped.push(`${name} (a link)`); continue }
    if (flags & 0x1) { skipped.push(`${name} (encrypted)`); continue }

    const local = sizes.offset
    if (buf.readUInt32LE(local) !== LOCAL) throw new Error(`The zip file is damaged at ${name}.`)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + sizes.compressed)
    let bytes
    if (method === 0) bytes = data
    else if (method === 8) bytes = inflateRawSync(data)
    else { skipped.push(`${name} (packed in a way this cannot open)`); continue }

    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    if (process.platform !== 'win32' && unixMode & 0o111) chmodSync(target, 0o755)
    written++
  }
  return { written, skipped }
}

/**
 * GitHub hands back every artifact inside a zip of its own. Ours hold
 * exactly one file, the app's own zip, so a download straight from GitHub
 * is a zip in a zip and the person has to open it twice.
 *
 * This takes the inner file out. Anything that is not "one zip inside a
 * zip" comes back as it was, so it can never make a download worse.
 *
 * Just enough of the zip format for that one case: the end record, one
 * central directory entry, its local header, and stored or deflated data.
 */

import { inflateRawSync } from 'node:zlib'

const END_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const STORED = 0
const DEFLATED = 8

export function unwrapSingleZip(bytes: Uint8Array): Uint8Array {
  try {
    return unwrap(bytes, '.zip') ?? bytes
  } catch {
    return bytes
  }
}

/**
 * The one file inside a zip, if the zip holds exactly one and its name ends
 * in `ending`. GitHub wraps the build's picture of the app window this way.
 */
export function onlyFile(bytes: Uint8Array, ending: string): Uint8Array | null {
  try {
    return unwrap(bytes, ending)
  } catch {
    return null
  }
}

function unwrap(bytes: Uint8Array, ending: string): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEnd(view)
  if (end < 0) return null

  const entries = view.getUint16(end + 10, true)
  const centralOffset = view.getUint32(end + 16, true)
  // 0xffffffff means zip64, which a single app under 4 GB never needs.
  if (entries !== 1 || centralOffset === 0xffffffff) return null
  if (view.getUint32(centralOffset, true) !== CENTRAL_SIGNATURE) return null

  const method = view.getUint16(centralOffset + 10, true)
  const compressedSize = view.getUint32(centralOffset + 20, true)
  const size = view.getUint32(centralOffset + 24, true)
  const nameLength = view.getUint16(centralOffset + 28, true)
  const localOffset = view.getUint32(centralOffset + 42, true)
  const name = new TextDecoder().decode(
    bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength),
  )
  if (!name.toLowerCase().endsWith(ending) || name.includes('/')) return null
  if (compressedSize === 0xffffffff || size === 0xffffffff) return null

  if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) return null
  const localName = view.getUint16(localOffset + 26, true)
  const localExtra = view.getUint16(localOffset + 28, true)
  const start = localOffset + 30 + localName + localExtra
  const data = bytes.subarray(start, start + compressedSize)
  if (data.byteLength !== compressedSize) return null

  let inner: Uint8Array
  if (method === STORED) inner = data
  else if (method === DEFLATED) inner = new Uint8Array(inflateRawSync(data))
  else return null
  return inner.byteLength === size ? inner : null
}

/** The end record sits in the last 22 bytes, plus a comment of up to 64 KB. */
function findEnd(view: DataView): number {
  const last = view.byteLength - 22
  const first = Math.max(0, last - 0xffff)
  for (let i = last; i >= first; i--) {
    if (view.getUint32(i, true) === END_SIGNATURE) return i
  }
  return -1
}

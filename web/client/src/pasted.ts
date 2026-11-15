/**
 * Turning typed or pasted files into the one zip the upload expects.
 *
 * The server only ever takes a zip, so the other two ways of adding a
 * project (pasted files, a Claude artifact) are made into one here, in the
 * browser, and then go up exactly as a chosen zip would.
 */

import { strToU8, zipSync } from 'fflate'

export interface PastedFile {
  name: string
  text: string
}

/** What is wrong with these files, in words for the person, or null if they are fine. */
export function pastedProblem(files: PastedFile[]): string | null {
  const used = files.filter((f) => f.name.trim() || f.text.trim())
  if (used.length === 0) return 'Add at least one file.'
  const seen = new Set<string>()
  for (const file of used) {
    const name = cleanName(file.name)
    if (!name) return 'Every file needs a name, like convert.py.'
    if (!file.text.trim()) return `${name} is empty. Paste what is in it, or remove it.`
    if (name.startsWith('/') || name.split('/').some((part) => part === '..' || part === '')) {
      return `"${file.name.trim()}" is not a name we can use. Use something like convert.py or data/words.txt.`
    }
    if (seen.has(name.toLowerCase())) return `There are two files called ${name}. Each one needs its own name.`
    seen.add(name.toLowerCase())
  }
  return null
}

/** The files as one zip, ready to upload. Call {@link pastedProblem} first. */
export function zipPasted(files: PastedFile[], zipName: string): File {
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) {
    if (!file.name.trim() && !file.text.trim()) continue
    entries[cleanName(file.name)] = strToU8(file.text.endsWith('\n') ? file.text : `${file.text}\n`)
  }
  return new File([zipSync(entries, { level: 6 }) as BlobPart], zipName, { type: 'application/zip' })
}

/**
 * True when pasted code is a web page or a React component, which is what
 * most Claude artifacts are. Those cannot be made into an app yet, so it is
 * better to say so now than after a ten minute build.
 */
export function looksLikeWebPage(code: string): boolean {
  const text = code.trim()
  return (
    /^<(!doctype|html|head|body|div|svg|style|script)\b/i.test(text) ||
    /from\s+['"]react['"]/.test(text) ||
    /^\s*export\s+default\s+function\b/m.test(text) ||
    /^\s*(const|let|var)\s+\w+\s*=\s*\(.*\)\s*=>/m.test(text)
  )
}

/** Forward slashes, no spaces around it. */
function cleanName(name: string): string {
  return name.trim().replace(/\\/g, '/')
}

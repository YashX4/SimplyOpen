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

export type ArtifactKind = 'page' | 'component' | 'python'

/**
 * What kind of Claude artifact this code is, worked out from how it starts
 * and what it imports. Each kind is saved under the file name the rest of
 * SimplyOpen recognises it by:
 *
 * - a web page (HTML) becomes index.html and is shown as it is;
 * - a React component becomes App.jsx and is built into a page first;
 * - anything else is taken to be Python and becomes main.py.
 */
export function artifactKind(code: string): ArtifactKind {
  const text = code.trim()
  if (/^<(!doctype|html|head|body|div|main|section|svg|style|script)\b/i.test(text)) return 'page'
  if (
    /from\s+['"]react['"]/.test(text) ||
    /^\s*export\s+default\b/m.test(text) ||
    /^\s*import\s.*\sfrom\s+['"]lucide-react['"]/m.test(text)
  ) {
    return 'component'
  }
  return 'python'
}

export const ARTIFACT_FILE: Record<ArtifactKind, string> = {
  page: 'index.html',
  component: 'App.jsx',
  python: 'main.py',
}

/** In words, for the line under the box that says what was recognised. */
export const ARTIFACT_WORDS: Record<ArtifactKind, string> = {
  page: 'a web page',
  component: 'a React component',
  python: 'a Python script',
}

/**
 * Why this component cannot be built, in words for the person, or null. The
 * Factory checks the same things; saying so here saves a ten minute wait.
 */
export function componentProblem(code: string): string | null {
  if (/from\s+['"]@\//.test(code)) {
    return "This component uses Claude's built-in interface pieces (the lines that import from \"@/components/...\"), which only exist inside Claude. Ask Claude to rewrite it using plain HTML elements and Tailwind, then paste it again."
  }
  if (!/\bexport\s+default\b/.test(code)) {
    return 'This component has no "export default" line, so there is no way to tell which part to show.'
  }
  return null
}

/** Forward slashes, no spaces around it. */
function cleanName(name: string): string {
  return name.trim().replace(/\\/g, '/')
}

import type { CSSProperties } from 'react'

/**
 * Turns the inline style text the design boards use into what React
 * wants, so a style can be carried over from a board without being
 * retyped, which is where small differences creep in.
 */
const seen = new Map<string, CSSProperties>()

export function s(text: string): CSSProperties {
  const cached = seen.get(text)
  if (cached) return cached
  const out: Record<string, string> = {}
  for (const part of text.split(';')) {
    const at = part.indexOf(':')
    if (at === -1) continue
    const key = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    if (!key || !value) continue
    const name = key.startsWith('--')
      ? key
      : key.replace(/^-(webkit|moz|ms)-/, (_, p: string) => `${p[0]?.toUpperCase()}${p.slice(1)}-`)
          .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    out[name] = value
  }
  seen.set(text, out as CSSProperties)
  return out as CSSProperties
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { s } from '../s'

export const TOPICS = [
  'Convert files', 'Clean up data', 'Write and edit',
  'Make pictures', 'Plan and organize', 'Study and learn',
]

export function searchPath(q: string): string {
  return `/search?q=${encodeURIComponent(q)}`
}

/**
 * The one search field. 64 tall on browse, where it is the main thing
 * on the page, and 60 on results, where the heading is.
 */
export function SearchField({ initial = '', height = 64 }: { initial?: string; height?: 60 | 64 }) {
  const [q, setQ] = useState(initial)
  const navigate = useNavigate()
  useEffect(() => { setQ(initial) }, [initial])

  return (
    <form role="search" style={{ position: 'relative', width: '100%', maxWidth: 620 }}
      onSubmit={(event) => {
        event.preventDefault()
        const text = q.trim()
        if (text) navigate(searchPath(text))
      }}>
      <span aria-hidden="true" style={s(`position:absolute;left:24px;top:0;height:${height}px;display:flex;align-items:center;color:rgba(9,23,23,0.64)`)}>
        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" />
        </svg>
      </span>
      <input type="search" aria-label="Search" placeholder="Search in plain words" value={q}
        onChange={(event) => setQ(event.target.value)}
        style={s(`display:block;width:100%;height:${height}px;box-sizing:border-box;padding:0 24px 0 56px;border-radius:${height / 2}px;border:1px solid rgba(9,23,23,0.46);background:#fff;font-family:inherit;font-size:18px;font-variation-settings:'opsz' 18,'slnt' 0,'wdth' 100,'wght' 300;color:#091717;box-shadow:0 4px 12px rgba(0,0,0,0.05)`)} />
    </form>
  )
}

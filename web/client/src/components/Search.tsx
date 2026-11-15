import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

/** The one search field, used on browse and on the results page. */
export function SearchField({ initial = '' }: { initial?: string }) {
  const [q, setQ] = useState(initial)
  const navigate = useNavigate()

  return (
    <form
      style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 640 }}
      onSubmit={(event) => {
        event.preventDefault()
        const text = q.trim()
        if (text) navigate(`/search?q=${encodeURIComponent(text)}`)
      }}
    >
      <label htmlFor="q" style={{
        position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
      }}>
        What do you need to do?
      </label>
      <input
        id="q" className="inp" type="search" value={q}
        placeholder="What do you need to do?"
        onChange={(event) => setQ(event.target.value)}
        style={{ flex: 1, minWidth: 0 }}
      />
      <button className="btn" type="submit">Search</button>
    </form>
  )
}

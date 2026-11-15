import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { colourFor, initials } from '../api'

export function Tick() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

export function Bang() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 6v8M12 17.5v.5" />
    </svg>
  )
}

export function Star() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />
    </svg>
  )
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span className="av" aria-hidden="true"
      style={{ width: size, height: size, background: colourFor(name), fontSize: size >= 30 ? 16 : 14 }}>
      {initials(name)}
    </span>
  )
}

export function Who({ name }: { name: string }) {
  return (
    <span className="who small">
      <Avatar name={name} />
      {name}
    </span>
  )
}

/** A row with a tick, a dash or a warning against it. */
export function Mark({ kind }: { kind: 'done' | 'bad' | 'na' }) {
  if (kind === 'done') return <span className="mark done" aria-hidden="true"><Tick /></span>
  if (kind === 'bad') return <span className="mark bad" aria-hidden="true"><Bang /></span>
  return (
    <span className="mark na" aria-hidden="true">
      <span style={{ display: 'block', width: 9, height: 1, background: 'currentColor' }} />
    </span>
  )
}

export function MarkRow({
  kind, label, note,
}: { kind: 'done' | 'bad' | 'na'; label: string; note?: string }) {
  return (
    <div className="row">
      <Mark kind={kind} />
      <span className="stack" style={{ gap: 4, flex: 1 }}>
        <span className="body">{label}</span>
        {note ? <span className="small">{note}</span> : null}
      </span>
    </div>
  )
}

export function Panel({
  title, note, children, style,
}: { title?: string; note?: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="panel stack" style={{ gap: 18, ...style }}>
      {title ? (
        <div className="stack" style={{ gap: 6 }}>
          <h2 className="h2">{title}</h2>
          {note ? <span className="small">{note}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function Header() {
  return (
    <header className="wrap" style={{
      display: 'flex', alignItems: 'center', gap: '8px 28px',
      flexWrap: 'wrap', paddingTop: 24, paddingBottom: 24,
    }}>
      <Link to="/" aria-label="Home" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 44, height: 44, color: 'var(--ink)',
      }}>
        <svg aria-hidden="true" width="26" height="26" viewBox="0 0 32 32" fill="none"
          stroke="currentColor" strokeWidth="1.4">
          <circle cx="16" cy="16" r="10" />
          <circle cx="24.5" cy="9" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      </Link>
      <Link to="/" className="body">Browse</Link>
      <span className="body muted">Publish</span>
      <span className="body muted">My things</span>
      <div style={{ flex: 1 }} />
      <span className="ghost" style={{ height: 44, fontSize: 16 }}>Sign in</span>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="wrap" style={{
      marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: '12px 32px',
      alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 40, paddingBottom: 56, borderTop: '1px solid var(--hairline)',
    }}>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <span className="small">Help</span>
        <span className="small">Report a problem</span>
        <span className="small">Terms and privacy</span>
      </div>
      <span className="small">Mac, Windows and Linux</span>
    </footer>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="stack" style={{ minHeight: '100%' }}>
      <Header />
      <main style={{ flex: 'none', paddingBottom: 140 }}>{children}</main>
      <Footer />
    </div>
  )
}

export function Waiting({ what }: { what: string }) {
  return (
    <div className="wrap col" style={{ paddingTop: 120 }}>
      <p className="lead">Getting {what}.</p>
    </div>
  )
}

export function Trouble({ message }: { message: string }) {
  return (
    <div className="wrap col stack" style={{ paddingTop: 120, gap: 24 }}>
      <h1 className="canon title">That did not work</h1>
      <p className="lead">{message}</p>
      <Link className="ghost" to="/" style={{ alignSelf: 'flex-start' }}>Back to browsing</Link>
    </div>
  )
}

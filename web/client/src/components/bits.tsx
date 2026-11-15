import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, colourFor, initials, type Me } from '../api'
import { ARCS } from '../arcs'
import { startFx, type OrbSpec } from '../fx'
import { s } from '../s'

export function Tick({ weight = 2.4 }: { weight?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
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

export function Star({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />
    </svg>
  )
}

export function Arrow() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span className="av" aria-hidden="true"
      style={{ width: size, height: size, background: colourFor(name), fontSize: size >= 36 ? 16 : 14 }}>
      {initials(name)}
    </span>
  )
}

/** The teal line that says the checks passed. Two sizes on the boards. */
export function Checked({ size = 14 }: { size?: 14 | 16 }) {
  return (
    <span style={size === 16
      ? s('display:inline-flex;align-items:center;gap:7px;color:#2f6f6a;font-size:16px')
      : s("display:inline-flex;align-items:center;gap:6px;color:#2f6f6a;font-size:14px;font-variation-settings:'opsz' 20,'slnt' 0,'wdth' 100,'wght' 300")}>
      <span style={{ display: 'block', width: size, height: size }}><Tick /></span>
      Checked for leaked keys
    </span>
  )
}

/**
 * Who is signed in, shared by every component that asks. Asked once per
 * visit, and again whenever signing in or out changes the answer.
 */
export interface Session { ready: boolean; me: Me | null; waiting: number }
let session: Session = { ready: false, me: null, waiting: 0 }
let asking: Promise<void> | null = null
const listeners = new Set<(s: Session) => void>()

export function refreshSession(): Promise<void> {
  asking = api.me()
    .then((r) => { session = { ready: true, me: r.user, waiting: r.waiting_suggestions ?? 0 } })
    .catch(() => { session = { ready: true, me: null, waiting: 0 } })
    .then(() => { listeners.forEach((l) => l(session)) })
  return asking
}

export function useSession(): Session {
  const [now, setNow] = useState(session)
  useEffect(() => {
    listeners.add(setNow)
    if (!asking) void refreshSession()
    else setNow(session)
    return () => { listeners.delete(setNow) }
  }, [])
  return now
}

export function useMe(): Me | null {
  return useSession().me
}

export type NavName = 'Browse' | 'Publish' | 'My things'

export function Header({ current }: { current?: NavName }) {
  const { me, waiting } = useSession()
  const ink = (name: NavName) => (name === current ? { color: '#091717' } : undefined)
  return (
    <header className="wrap" style={s('position:relative;z-index:5;display:flex;align-items:center;flex-wrap:wrap;gap:8px 28px;padding-top:24px;padding-bottom:24px')}>
      <Link to="/" aria-label="Home" style={s('display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;color:#091717;border-radius:50%;background:rgba(251,250,244,0.9)')}>
        <svg aria-hidden="true" width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="16" cy="16" r="10" />
          <circle cx="24.5" cy="9" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      </Link>
      <Link className="nav" to="/" style={ink('Browse')}>Browse</Link>
      <Link className="nav" to="/publish" style={ink('Publish')}>Publish</Link>
      <Link className="nav" to="/my-things" style={ink('My things')}>
        My things
        {me && waiting > 0 ? (
          <span className="badge" aria-label={`${waiting} suggestions waiting`}>{waiting}</span>
        ) : null}
      </Link>
      <div style={{ flex: 1 }} />
      {me ? (
        <Link className="nav who" to="/my-things" style={s('padding:0 16px 0 7px;border-radius:999px;background:rgba(251,250,244,0.9);color:#091717')}>
          <Avatar name={me.name} size={30} />
          {me.name.split(/\s+/)[0]}
        </Link>
      ) : (
        <Link className="btn" to="/sign-in">Sign in</Link>
      )}
    </header>
  )
}

export function Footer() {
  return (
    <footer className="wrap" style={s('position:relative;z-index:2;margin-top:auto;display:flex;flex-wrap:wrap;gap:12px 32px;align-items:center;justify-content:space-between;padding-top:40px;padding-bottom:56px;border-top:1px solid rgba(9,23,23,0.16)')}>
      <div style={s('display:flex;gap:28px;flex-wrap:wrap')}>
        <a className="nav" href="#top">Help</a>
        <a className="nav" href="#top">Report a problem</a>
        <a className="nav" href="#top">Terms and privacy</a>
      </div>
      <span className="mono" style={{ color: 'rgba(9,23,23,0.64)' }}>Mac, Windows and Linux</span>
    </footer>
  )
}

/** The arcs and the orb canvas that sit behind a hero. */
export function Backdrop() {
  const box = 'position:absolute;left:0;top:-116px;width:100%;height:calc(100% + 116px);pointer-events:none'
  return (
    <>
      <div aria-hidden="true" style={s(`${box};z-index:0;overflow:hidden`)}
        dangerouslySetInnerHTML={{ __html: ARCS }} />
      <canvas data-orbs="1" aria-hidden="true" style={s(`${box};display:block;z-index:1`)} />
    </>
  )
}

/**
 * The outside of every page: the paper ground, the header, the footer,
 * and the effects switched on for whatever is inside.
 */
export function Page({
  current, orbs, children,
}: { current?: NavName; orbs: OrbSpec[]; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const key = JSON.stringify(orbs)

  useEffect(() => {
    const el = root.current
    if (!el) return
    return startFx(
      el,
      el.querySelector<HTMLCanvasElement>('canvas[data-orbs]'),
      JSON.parse(key) as OrbSpec[],
      el.querySelector<HTMLCanvasElement>('canvas[data-head]'),
    )
  }, [key])

  return (
    <div id="top" ref={root} className="pg" style={s('position:relative;width:100%;min-height:100%;box-sizing:border-box;display:flex;flex-direction:column;background:#FBFAF4;overflow:hidden')}>
      <Header current={current} />
      {children}
      <Footer />
    </div>
  )
}

/**
 * The hero most pages share: left aligned, a display heading, one line
 * under it. `pre` goes above the heading and `sub` below.
 */
export function Hero({
  pre, title, sub, bottom = 90,
}: { pre?: ReactNode; title: ReactNode; sub?: ReactNode; bottom?: number }) {
  return (
    <section style={{ position: 'relative', flex: 'none', paddingTop: 110, paddingBottom: bottom }}>
      <Backdrop />
      <div className="wrap" style={s('position:relative;z-index:2')}>
        <div style={s('display:flex;flex-direction:column;align-items:flex-start;gap:16px;text-align:left')}>
          {pre}
          <h1 className="canon" style={s('margin:0;font-size:64px;line-height:1.2;letter-spacing:-0.011em')}>{title}</h1>
          {sub}
        </div>
      </div>
    </section>
  )
}

export function HeroLine({ children }: { children: ReactNode }) {
  return (
    <p style={s('margin:0;font-size:20px;line-height:1.3;color:rgba(9,23,23,0.64);max-width:640px')}>
      {children}
    </p>
  )
}

export function Main({ children }: { children: ReactNode }) {
  return (
    <main className="wrap" style={s('position:relative;z-index:2;flex:none;padding-bottom:140px')}>
      {children}
    </main>
  )
}

/** When a page could not get what it needs. One panel, one way forward. */
export function Trouble({ message, again }: { message: string; again?: () => void }) {
  return (
    <div className="col" style={s('display:flex;flex-direction:column;gap:28px')}>
      <div className="panel" style={s('display:flex;flex-direction:column;gap:20px;padding:30px')}>
        <h2 className="h2">That did not work</h2>
        <p className="body" style={{ margin: 0 }}>{message}</p>
        <div className="door" style={{ paddingTop: 20 }}>
          {again
            ? <button type="button" className="btn" onClick={again}>Try again</button>
            : <Link className="btn" to="/">Browse everything</Link>}
        </div>
      </div>
    </div>
  )
}

const QUIET: OrbSpec[] = [[0.975, 0.88, 0.078, 'stone'], [0.02, 1.05, 0.105, 'violet']]

/** A whole page for when there is nothing else to show. */
export function Plain({
  current, title, line, children,
}: { current?: NavName; title: string; line: string; children?: ReactNode }) {
  return (
    <Page current={current} orbs={QUIET}>
      <Hero title={title} sub={<HeroLine>{line}</HeroLine>} bottom={120} />
      <Main>{children}</Main>
    </Page>
  )
}

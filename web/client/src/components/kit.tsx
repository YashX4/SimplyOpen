import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { api, SYSTEM_NAME, type Build, type Check, type Platform } from '../api'
import { Avatar, Backdrop, Bang, Checked, Main, Page, Tick, useSession, type NavName } from './bits'
import type { OrbSpec } from '../fx'
import { s } from '../s'

/*
 * The pieces the boards repeat from screen to screen, each written once.
 * Every style string is copied from a board, so a page built from these
 * matches its board without being retyped.
 */

const SLASH = <span style={{ padding: '0 8px', color: 'rgba(9,23,23,0.46)' }}>/</span>
const DIVIDE = <span style={{ color: 'rgba(9,23,23,0.46)' }}>/</span>

/** Browse / Zoom transcripts to NVivo / Versions. The last part is where you are. */
export function Crumbs({ trail }: { trail: [label: string, to?: string][] }) {
  return (
    <p className="small" style={{ margin: 0 }}>
      {trail.map(([label, to], i) => (
        <Fragment key={label + i}>
          {i > 0 ? SLASH : null}
          {to ? <Link className="nav" to={to} style={{ minHeight: 0 }}>{label}</Link> : label}
        </Fragment>
      ))}
    </p>
  )
}

/** The small line under a heading: an avatar, then facts with slashes between. */
export function Meta({ who, facts }: { who?: string; facts: string[] }) {
  const items: ReactNode[] = []
  if (who) {
    items.push(<Avatar key="av" name={who} size={30} />, <span key="who">{who}</span>)
  }
  facts.filter(Boolean).forEach((fact, i) => {
    if (items.length > 0) items.push(<Fragment key={`d${i}`}>{DIVIDE}</Fragment>)
    items.push(<span key={`f${i}`}>{fact}</span>)
  })
  return <p className="small" style={s('margin:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>{items}</p>
}

/** The centred hero, used on every step of a flow. */
export function CenterHero({
  pre, title, sub, top = 110, bottom = 120, gap = 16,
}: { pre?: ReactNode; title: ReactNode; sub?: ReactNode; top?: number; bottom?: number; gap?: number }) {
  return (
    <section style={{ position: 'relative', flex: 'none', paddingTop: top, paddingBottom: bottom }}>
      <Backdrop />
      <div className="wrap" style={s('position:relative;z-index:2')}>
        <div className="col" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap, textAlign: 'center' }}>
          {pre}
          <h1 className="canon" style={s('margin:0;font-size:64px;line-height:1.2;letter-spacing:-0.011em')}>{title}</h1>
          {sub ? (
            <p style={s('margin:0;font-size:20px;line-height:1.3;color:rgba(9,23,23,0.64);max-width:640px')}>{sub}</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/** The teal circle with a tick that sits above "is shared" and "is out". */
export function Done() {
  return (
    <>
      <span aria-hidden="true" style={s('display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:#2f6f6a;color:#FBFAF4')}>
        <span style={{ display: 'block', width: 30, height: 30 }}><Tick /></span>
      </span>
      <br />
    </>
  )
}

/** A panel with a heading, and an optional line under it. */
export function Box({
  title, note, children, gap = 18, pad = 28, style,
}: { title?: ReactNode; note?: ReactNode; children?: ReactNode; gap?: number; pad?: number | string; style?: React.CSSProperties }) {
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap, padding: pad, ...style }}>
      {title ? (
        note ? (
          <div style={s('display:flex;flex-direction:column;gap:6px')}>
            <h2 className="h2">{title}</h2>
            <span className="small">{note}</span>
          </div>
        ) : <h2 className="h2">{title}</h2>
      ) : null}
      {children}
    </div>
  )
}

/** A stack of rows inside a box, pulled up under its heading as the boards do. */
export function Rows({ children, lift = -10 }: { children: ReactNode; lift?: number }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: lift }}>{children}</div>
}

/** A row with a label on the left and something small on the right. */
export function Line({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="row2" style={{ alignItems: 'center', gap: 12 }}>
      <span className="body" style={{ color: '#091717' }}>{left}</span>
      {right !== undefined ? <span className="small" style={{ marginLeft: 'auto' }}>{right}</span> : null}
    </div>
  )
}

/** A row that ends in a link or a button, inside the slim panel at the foot of a sidebar. */
export function Door({ label, children, muted }: { label: ReactNode; children: ReactNode; muted?: boolean }) {
  return (
    <div className="row2" style={{ alignItems: 'center' }}>
      <span className="body" style={muted ? undefined : { color: '#091717' }}>{label}</span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>{children}</span>
    </div>
  )
}

/** The slim panel itself. */
export function Doors({ children }: { children: ReactNode }) {
  return <div className="panel" style={s('display:flex;flex-direction:column;gap:0;padding:8px 28px 18px')}>{children}</div>
}

export type MarkKind = 'done' | 'bad' | 'na' | 'now' | 'todo' | number

export function Mark({ kind, style }: { kind: MarkKind; style?: React.CSSProperties }) {
  if (typeof kind === 'number') {
    return <span className="mark" aria-hidden="true" style={{ color: 'rgba(9,23,23,0.64)', fontSize: 14, ...style }}>{kind}</span>
  }
  if (kind === 'done') return <span className="mark done" aria-hidden="true" style={style}><Tick /></span>
  if (kind === 'bad') return <span className="mark bad" aria-hidden="true" style={style}><Bang /></span>
  if (kind === 'now') return <span className="mark now" aria-hidden="true" style={style}><i /></span>
  if (kind === 'na') {
    return (
      <span className="mark na" aria-hidden="true" style={{ fontSize: 14, ...style }}>
        <span style={{ display: 'block', width: 9, height: 1, background: 'currentColor' }} />
      </span>
    )
  }
  return <span className="mark" aria-hidden="true" style={style} />
}

/** A tick, warning or dash against a line of text. */
export function Tally({ kind, children }: { kind: MarkKind; children: ReactNode }) {
  return (
    <div className="row2" style={{ alignItems: 'center' }}>
      <Mark kind={kind} />
      <span className="body" style={{ color: '#091717' }}>{children}</span>
    </div>
  )
}

/** A mark, a heading and a sentence. The boards call these problems, though most are not. */
export function Item({
  kind, title, body, small, pad = '16px 0',
}: { kind?: MarkKind; title: ReactNode; body?: ReactNode; small?: boolean; pad?: string }) {
  return (
    <div className="prob" style={{ padding: pad, alignItems: 'flex-start', gap: kind === undefined ? undefined : 16 }}>
      {kind !== undefined ? <Mark kind={kind} /> : null}
      <span style={s('display:flex;flex-direction:column;gap:5px;flex:1')}>
        <span className={small ? 'body' : 'h3'} style={small ? { color: '#091717' } : undefined}>{title}</span>
        {body ? <span className={small ? 'small' : 'body'}>{body}</span> : null}
      </span>
    </div>
  )
}

/** A heading and a sentence, with a way forward on the right. */
export function Choice({ title, body, children }: { title: ReactNode; body: ReactNode; children: ReactNode }) {
  return (
    <div className="prob" style={{ padding: '20px 0' }}>
      <span style={s('display:flex;flex-direction:column;gap:6px;flex:1;min-width:230px')}>
        <span className="h3">{title}</span>
        <span className="body">{body}</span>
      </span>
      <span style={{ flex: 'none' }}>{children}</span>
    </div>
  )
}

/** One plain words change: its title, then what it did before and what it does now. */
export function Change({ title, before, after, isNew }: { title: string; before: string; after: string; isNew?: boolean }) {
  return (
    <div className="prob" style={s('padding:20px 0;gap:0;flex-direction:column')}>
      <span style={s('display:flex;align-items:center;gap:12px;flex-wrap:wrap')}>
        <span className="h3">{title}</span>
        {isNew ? <span className="new">New</span> : null}
      </span>
      {before || after ? (
        <span className="ba">
          {before ? <span><b>Before</b>{before}</span> : null}
          {after ? <span><b>Now</b>{after}</span> : null}
        </span>
      ) : null}
    </div>
  )
}

/** A list of steps, each with a mark and a word on the right. */
export function Steps({ steps }: { steps: { kind: MarkKind; label: string; note?: string }[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {steps.map((step) => (
        <li className="step" key={step.label}>
          <Mark kind={step.kind} />
          <span className="h3" style={step.kind === 'now' || step.kind === 'bad' ? undefined : { color: 'rgba(9,23,23,0.64)' }}>
            {step.label}
          </span>
          {step.note ? <span className="small" style={{ marginLeft: 'auto' }}>{step.note}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/** Two columns, the second one sticky, as on every project screen. */
export function TwoUp({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid2">
      <div style={s('display:flex;flex-direction:column;gap:32px')}>{left}</div>
      <div style={s('display:flex;flex-direction:column;gap:32px;position:sticky;top:24px')}>{right}</div>
    </div>
  )
}

/** One centred column of panels, for the steps of a flow. */
export function Column({ children, width }: { children: ReactNode; width?: number }) {
  return (
    <div className={width ? undefined : 'col'}
      style={{ display: 'flex', flexDirection: 'column', gap: 28, ...(width ? { width: '100%', maxWidth: width, margin: '0 auto' } : {}) }}>
      {children}
    </div>
  )
}

/** The window someone gets when they open it. Drawn, not screenshotted. */
export function KitWindow({ name }: { name: string }) {
  return (
    <div className="win">
      <div className="wbar" aria-hidden="true">
        <i className="wdot" /><i className="wdot" style={{ opacity: 0.7 }} />
        <i className="wdot" style={{ opacity: 0.45 }} />
        <span style={{ width: 8 }} />
        <span className="small" style={{ color: 'rgba(9,23,23,0.64)' }}>{name}</span>
      </div>
      <div className="wdrop">
        <span className="h3">Drop files or a folder here</span>
        <span className="small">or choose them from your computer</span>
      </div>
      <div style={s('display:flex;flex-direction:column;gap:7px')}>
        <div className="wrun">Run</div>
        <span className="small" style={{ textAlign: 'center' }}>Add your files first</span>
      </div>
      <div style={s('display:flex;flex-direction:column;gap:7px')}>
        <span className="lab">Progress</span>
        <div className="wlog"><span className="small">Progress will show here once you press Run.</span></div>
      </div>
      <div style={s('display:flex;flex-direction:column;gap:7px')}>
        <div className="ghost" style={s('width:100%;box-sizing:border-box;height:46px;font-size:16px;color:rgba(9,23,23,0.64)')}>
          Open results
        </div>
        <span className="small" style={{ textAlign: 'center' }}>Available after it finishes</span>
      </div>
    </div>
  )
}

export const ORDER: Platform[] = ['mac', 'windows', 'linux']

/** "Checks that really ran", in the order the boards list them. */
export function CheckRows({ check, builds }: { check: Check | null; builds: Build[] }) {
  const mark = (b?: Build): MarkKind =>
    !b ? 'na' : b.status === 'ready' ? 'done' : b.status === 'failed' ? 'bad' : b.status === 'cannot' ? 'na' : 'now'
  return (
    <>
      {check ? (
        <>
          <Tally kind={check.status === 'passed' ? 'done' : 'bad'}>No keys or passwords left in it</Tally>
          <Tally kind={check.network_access ? 'bad' : 'done'}>
            {check.network_access ? 'Reaches the internet' : 'Does not reach the internet'}
          </Tally>
        </>
      ) : null}
      {ORDER.map((p) => {
        const b = builds.find((x) => x.platform === p)
        const label = b?.status === 'cannot' ? `Cannot be built for ${SYSTEM_NAME[p]}`
          : b?.status === 'failed' ? `Did not build for ${SYSTEM_NAME[p]}`
          : b?.status === 'ready' ? `Built for ${SYSTEM_NAME[p]}` : `Building for ${SYSTEM_NAME[p]}`
        return <Tally key={p} kind={mark(b)}>{label}</Tally>
      })}
    </>
  )
}

/** "What it touches", from what the analyzer read in the code. */
export function Touches({ check, title = 'What it touches', foot }: { check: Check | null; title?: string; foot?: ReactNode }) {
  if (!check) return null
  const caps = check.manifest?.capabilities
  const rows: [string, string][] = [
    ['Reads', 'The files you drop in.'],
    ['Saves', 'Its results, on your own computer.'],
    ['Internet', check.network_access ? 'Yes. It cannot do its job with the internet off.' : 'Nothing. It runs on your computer only.'],
  ]
  if (caps) rows.push(['Anything else', caps.runs_other_programs ? 'It starts other programs on your computer.' : 'Nothing.'])
  return (
    <div className="panel" style={s('display:flex;flex-direction:column;gap:6px;padding:28px')}>
      <h2 className="h2" style={{ marginBottom: 10 }}>{title}</h2>
      {rows.map(([label, text]) => (
        <div className="row2" key={label}>
          <span className="h3" style={{ flex: 'none', width: 112 }}>{label}</span>
          <span className="body">{text}</span>
        </div>
      ))}
      {foot ? <p className="small" style={{ margin: '14px 0 0' }}>{foot}</p> : null}
    </div>
  )
}

/** A page that needs somebody signed in. Sends anyone else to sign in, and back after. */
export function SignedIn({ children, current, orbs }: { children: ReactNode; current?: NavName; orbs: OrbSpec[] }) {
  const { ready, me } = useSession()
  const where = useLocation()
  if (!ready) {
    return (
      <Page current={current} orbs={orbs}>
        <CenterHero title={<span style={{ color: 'rgba(9,23,23,0.46)' }}>One moment</span>} />
        <Main>{null}</Main>
      </Page>
    )
  }
  if (!me) {
    try { sessionStorage.setItem('after-sign-in', where.pathname + where.search) } catch { /* private mode */ }
    return <Navigate to="/sign-in" replace />
  }
  return <>{children}</>
}

/** Waits for one async thing and keeps its answer, its trouble, and a way to ask again. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): {
  data: T | null; error: Error | null; again: () => void; set: (t: T) => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    load().then((d) => { if (live) setData(d) }).catch((e: Error) => { if (live) setError(e) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, round])
  return { data, error, again: () => setRound((r) => r + 1), set: setData }
}

/* ---------- W8: getting it ---------- */

const HOW: Record<Platform, { title: string; body: string }[]> = {
  mac: [
    { title: 'Open the file', body: 'It will be in your Downloads folder. Double click it and it unpacks.' },
    { title: 'Drag it into Applications', body: 'Drag the app onto the Applications folder in Finder, then open it from there.' },
    { title: 'If your computer warns you', body: 'Your Mac may say it cannot check this app. Open System Settings, then Privacy and Security, and choose Open Anyway.' },
  ],
  windows: [
    { title: 'Open the file', body: 'It will be in your Downloads folder. Right click it and choose Extract All.' },
    { title: 'Open the app', body: 'Double click the app inside the folder it made. There is nothing to install.' },
    { title: 'If your computer warns you', body: 'Windows may say it protected your computer. Choose More info, then Run anyway.' },
  ],
  linux: [
    { title: 'Open the file', body: 'It will be in your Downloads folder. Unpack it where you want to keep it.' },
    { title: 'Let it run', body: 'Right click the app, open Properties, and allow it to run as a program.' },
    { title: 'Open the app', body: 'Double click it. There is nothing to install.' },
  ],
}

/**
 * The sheet that opens over the page when someone presses Get it, and
 * starts the download behind it. The download runs in a hidden frame so a
 * failed one never takes the page away.
 */
export function GetItSheet({
  name, versionId, builds, start, checked, onClose,
}: { name: string; versionId: string; builds: Build[]; start: Platform; checked: boolean; onClose: () => void }) {
  const ready = ORDER.filter((p) => builds.some((b) => b.platform === p && b.status === 'ready'))
  const [platform, setPlatform] = useState<Platform>(ready.includes(start) ? start : ready[0] ?? start)
  const [round, setRound] = useState(0)
  const [check, setCheck] = useState<{ ok: boolean; slow?: boolean; reason?: string } | null>(null)
  const close = useRef<HTMLButtonElement>(null)

  // Ask first, so a missing file is said out loud rather than failing in a hidden frame.
  useEffect(() => {
    let live = true
    setCheck(null)
    api.checkDownload(versionId, platform)
      .then((c) => { if (live) setCheck(c) })
      .catch(() => { if (live) setCheck({ ok: false, reason: 'The website could not reach its server to start the download.' }) })
    return () => { live = false }
  }, [versionId, platform, round])

  useEffect(() => {
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="scrim live" aria-hidden="true" onClick={onClose} />
      <div className="panel sheet live" role="dialog" aria-modal="true" aria-label={`Getting ${name}`}>
        {check?.ok ? (
          <iframe key={`${platform}${round}`} title="download" src={api.downloadUrl(versionId, platform)} style={{ display: 'none' }} />
        ) : null}
        <div style={s('display:flex;align-items:flex-start;gap:16px')}>
          <span style={s('display:flex;flex-direction:column;gap:5px;flex:1')}>
            <h2 className="h2">Getting {name}</h2>
            <span className="small">Four steps. The last one is only because the app is not signed yet.</span>
          </span>
          <button ref={close} type="button" className="xbtn" aria-label="Close" onClick={onClose} style={{ cursor: 'pointer' }}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {ready.length > 1 ? (
          <div style={s('display:flex;gap:8px')}>
            {ready.map((p) => (
              <button key={p} type="button" className={p === platform ? 'chip on' : 'chip'} onClick={() => setPlatform(p)}>
                {SYSTEM_NAME[p]}
              </button>
            ))}
          </div>
        ) : null}
        <div style={s('display:flex;flex-direction:column;gap:0')}>
          <div className="prob" style={{ padding: '18px 0' }} role="status">
            <Mark kind={check && !check.ok ? 'bad' : 'now'} />
            <span style={s('display:flex;flex-direction:column;gap:5px;flex:1')}>
              <span className="h3">
                {!check ? 'Getting it ready' : check.ok ? `Downloading it for ${SYSTEM_NAME[platform]}` : 'This download is not there'}
              </span>
              <span className="body">
                {!check ? 'Checking the file is where it should be.'
                  : !check.ok ? check.reason
                  : check.slow ? 'This one is big, so it can take up to a minute to start. Your browser shows it as it arrives.'
                  : 'Your browser shows it as it arrives.'}
                {!check || check.ok ? <span className="bar" aria-hidden="true" style={{ display: 'block' }}><i /></span> : null}
              </span>
            </span>
          </div>
          {HOW[platform].map((step, i) => (
            <div className="prob" style={{ padding: '18px 0' }} key={step.title}>
              <Mark kind={i + 2} />
              <span style={s('display:flex;flex-direction:column;gap:5px;flex:1')}>
                <span className="h3" style={{ color: 'rgba(9,23,23,0.64)' }}>{step.title}</span>
                <span className="body">{step.body}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="door" style={{ paddingTop: 20, gap: 14 }}>
          <span style={s('flex:1;min-width:200px;display:flex;flex-direction:column;gap:6px')}>
            {checked ? <Checked size={16} /> : null}
          </span>
          <button type="button" className="ghost" onClick={() => setRound((r) => r + 1)}>Download again</button>
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  )
}

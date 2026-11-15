import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, readableSize } from '../api'
import { Main, Page, Trouble } from '../components/bits'
import { Box, CenterHero, Column, Mark, SignedIn, Steps, type MarkKind } from '../components/kit'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const P1: OrbSpec[] = [[0.98, 0.9, 0.082, 'clay'], [0.02, 1.06, 0.12, 'teal']]
const P2: OrbSpec[] = [[0.975, 0.88, 0.085, 'violet'], [0.025, 1.05, 0.115, 'stone']]
const P5: OrbSpec[] = [[0.975, 0.86, 0.08, 'stone'], [0.02, 1.05, 0.105, 'violet']]

const READING = [
  'Reading your files',
  'Working out what it is',
  'Writing the name and description',
  'Making a cover',
  'Checking what it can touch',
  'Checking for anything risky',
]

/** Errors that mean "that file", as opposed to "our end". Those get P5. */
const THE_FILE = new Set(['CANNOT_READ', 'EMPTY_UPLOAD', 'UPLOAD_TOO_LARGE', 'NO_FILE', 'NOT_A_ZIP'])

const ICON = {
  zip: 'M4 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2zM12 10v2M12 14v2',
  artifact: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  paste: 'M9 4h6v3H9zM7 5H5v15h14V5h-2M9 12h6M9 16h4',
}

function Icon({ d, width = 1.5 }: { d: string; width?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width}
      strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  )
}

function Way({ id, title, note, icon, on, off }: { id: string; title: string; note: string; icon: string; on?: boolean; off?: boolean }) {
  return (
    <label className={off ? 'panel ch off' : 'panel ch'} htmlFor={`how-${id}`}>
      <input type="radio" id={`how-${id}`} name="how" className="r" defaultChecked={on} disabled={off} />
      <span className="ci"><Icon d={icon} /></span>
      <span className="ct">{title}</span>
      <span className="cd">{note}</span>
      <span className="dot" aria-hidden="true" />
    </label>
  )
}

type Stage =
  | { at: 'choose' }
  | { at: 'reading'; step: number }
  | { at: 'cannot'; message: string }
  | { at: 'trouble'; message: string }

/** P1, P2 and P5: choose the zip, wait while it is read, or hear why it could not be. */
export function Publish() {
  return <SignedIn current="Publish" orbs={P1}><PublishFlow /></SignedIn>
}

function PublishFlow() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [over, setOver] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>({ at: 'choose' })
  const stop = useRef<AbortController | null>(null)

  // P2's steps move on their own while the real work happens in one request,
  // and wait on the last one until the answer is back.
  useEffect(() => {
    if (stage.at !== 'reading') return
    const timer = window.setInterval(() => {
      setStage((now) => now.at === 'reading' && now.step < READING.length - 1 ? { at: 'reading', step: now.step + 1 } : now)
    }, 2200)
    return () => window.clearInterval(timer)
  }, [stage.at])

  useEffect(() => () => stop.current?.abort(), [])

  const pick = (chosen: File | undefined) => {
    if (!chosen) return
    if (!/\.zip$/i.test(chosen.name)) {
      setWarn('For now it needs to be one zip file. Put everything in a folder and zip the folder.')
      return
    }
    setWarn(null)
    setFile(chosen)
  }

  const start = () => {
    if (!file) return
    const control = new AbortController()
    stop.current = control
    setStage({ at: 'reading', step: 0 })
    api.upload(file, control.signal)
      .then((made) => navigate(`/publish/${made.project.slug}`))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (e instanceof ApiError && THE_FILE.has(e.code)) setStage({ at: 'cannot', message: e.message })
        else setStage({ at: 'trouble', message: e instanceof Error ? e.message : 'That did not work.' })
      })
  }

  const again = () => { setFile(null); setStage({ at: 'choose' }) }

  if (stage.at === 'reading') {
    const steps = READING.map((label, i) => {
      const kind: MarkKind = i < stage.step ? 'done' : i === stage.step ? 'now' : 'todo'
      return { kind, label, note: i < stage.step ? 'Done' : i === stage.step ? 'Working on it' : undefined }
    })
    return (
      <Page current="Publish" orbs={P2}>
        <CenterHero title="Reading what you made"
          sub="This takes about a minute. Stay on this page until it is done." />
        <Main>
          <Column>
            <div className="panel" style={{ padding: '12px 28px' }}><Steps steps={steps} /></div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="ghost" onClick={() => { stop.current?.abort(); again() }}>Cancel</button>
            </div>
          </Column>
        </Main>
      </Page>
    )
  }

  if (stage.at === 'cannot') {
    return (
      <Page current="Publish" orbs={P5}>
        <CenterHero title="We could not open that file" sub="Nothing was added. You can try again with a different file." />
        <Main>
          <Column>
            <div className="panel" style={s('display:flex;gap:18px;padding:28px')}>
              <Mark kind="bad" style={{ marginTop: 2 }} />
              <span style={s('display:flex;flex-direction:column;gap:6px')}>
                <span className="h2">{stage.message}</span>
                <span className="body">Nothing was added, so nothing has changed. Your other projects are untouched.</span>
              </span>
            </div>
            <Box title="What you can do" gap={6} style={{ paddingBottom: 28 }}>
              <div style={{ marginTop: 4 }}>
                <div className="row2" style={{ alignItems: 'flex-start' }}>
                  <span className="h3" style={{ flex: 'none', width: 200 }}>Try a different file</span>
                  <span className="body">Make sure your project files are inside the zip, not next to it.</span>
                </div>
                <div className="row2" style={{ alignItems: 'flex-start' }}>
                  <span className="h3" style={{ flex: 'none', width: 200 }}>Zip the whole folder</span>
                  <span className="body">Right click the folder your project is in and compress it. That one file is all we need.</span>
                </div>
              </div>
            </Box>
            <div style={s('display:flex;flex-wrap:wrap;gap:14px;margin-top:4px')}>
              <button type="button" className="btn" onClick={again}>Choose a different file</button>
              <Link className="ghost" to="/my-things">Back to My things</Link>
            </div>
          </Column>
        </Main>
      </Page>
    )
  }

  return (
    <Page current="Publish" orbs={P1}>
      <CenterHero title="Share something you made" top={80} gap={14}
        sub="Nobody can see it until you say it is ready. You can stop at any point." />
      <main className="wrap" style={s('position:relative;z-index:2;flex:none;padding-bottom:160px')}>
        <div className="col" style={s('display:flex;flex-direction:column;gap:20px')}>
          {stage.at === 'trouble' ? <Trouble message={stage.message} again={start} /> : null}

          <h2 style={s('margin:0;font-size:24px;line-height:1.2;letter-spacing:-0.03em')}>How are you adding it?</h2>
          <div className="g3c" role="radiogroup" aria-label="How are you adding it?">
            <Way id="zip" title="A zip file" note="Everything in one folder" icon={ICON.zip} on />
            <Way id="art" title="A Claude artifact" note="Not ready yet. Use a zip for now." icon={ICON.artifact} off />
            <Way id="paste" title="Pasted files" note="Not ready yet. Use a zip for now." icon={ICON.paste} off />
          </div>

          <div className="panel" style={{ padding: 22, marginTop: 4 }}>
            <label className={over ? 'drop over' : 'drop'} htmlFor="file"
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]) }}>
              <Icon d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3M12 4v11M8 11l4 4 4-4" width={1.4} />
              <span className="dt">{file ? file.name : 'Drop your zip file here'}</span>
              <span className="dn">{file ? `${readableSize(file.size) || 'Under 1 MB'}. Ready when you are.` : 'or choose it from your computer'}</span>
              <input type="file" id="file" accept=".zip,application/zip"
                onChange={(e) => pick(e.target.files?.[0])}
                style={s('position:absolute;width:1px;height:1px;opacity:0')} />
              <span className="ghost" style={s('margin-top:16px;height:48px;font-size:18px')}>
                {file ? 'Choose a different file' : 'Choose a file'}
              </span>
            </label>
            {warn ? <p className="small" role="alert" style={{ margin: '14px 4px 0', color: '#b4563c' }}>{warn}</p> : null}
          </div>

          <div style={s('display:flex;align-items:center;gap:14px;margin-top:22px')}>
            <button type="button" className="btn" disabled={!file} onClick={start}>Continue</button>
            <Link className="ghost" to="/my-things">Cancel</Link>
          </div>
        </div>
      </main>
    </Page>
  )
}

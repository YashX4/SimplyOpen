import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, readableSize } from '../api'
import { Main, Page, Trouble } from '../components/bits'
import { Box, CenterHero, Column, Mark, SignedIn, Steps, type MarkKind } from '../components/kit'
import type { OrbSpec } from '../fx'
import { looksLikeWebPage, pastedProblem, zipPasted, type PastedFile } from '../pasted'
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

type How = 'zip' | 'art' | 'paste'

function Way({ id, title, note, icon, how, choose }: { id: How; title: string; note: string; icon: string; how: How; choose: (id: How) => void }) {
  return (
    <label className="panel ch" htmlFor={`how-${id}`}>
      <input type="radio" id={`how-${id}`} name="how" className="r" checked={how === id} onChange={() => choose(id)} />
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

const MONO = 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;min-height:200px'

/** P1, P2 and P5: add the project, wait while it is read, or hear why it could not be. */
export function Publish() {
  return <SignedIn current="Publish" orbs={P1}><PublishFlow /></SignedIn>
}

function PublishFlow() {
  const navigate = useNavigate()
  const [how, setHow] = useState<How>('zip')
  const [file, setFile] = useState<File | null>(null)
  const [pasted, setPasted] = useState<PastedFile[]>([{ name: '', text: '' }])
  const [artifact, setArtifact] = useState('')
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

  const choose = (next: How) => { setHow(next); setWarn(null) }

  const setPastedFile = (index: number, change: Partial<PastedFile>) =>
    setPasted((files) => files.map((f, i) => (i === index ? { ...f, ...change } : f)))

  /** The zip to send for the way that is chosen, or null after saying what is wrong. */
  const whatToSend = (): File | null => {
    if (how === 'zip') return file
    if (how === 'paste') {
      const problem = pastedProblem(pasted)
      if (problem) { setWarn(problem); return null }
      return zipPasted(pasted, 'pasted-files.zip')
    }
    if (!artifact.trim()) { setWarn('Paste the code from your artifact first.'); return null }
    if (looksLikeWebPage(artifact)) {
      setWarn('This looks like a web page or a React component. Those cannot be made into an app yet. Artifacts written in Python can.')
      return null
    }
    return zipPasted([{ name: 'main.py', text: artifact }], 'claude-artifact.zip')
  }

  const start = () => {
    const sending = whatToSend()
    if (!sending) return
    setWarn(null)
    const control = new AbortController()
    stop.current = control
    setStage({ at: 'reading', step: 0 })
    api.upload(sending, control.signal)
      .then((made) => navigate(`/publish/${made.project.slug}`))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (e instanceof ApiError && THE_FILE.has(e.code)) setStage({ at: 'cannot', message: e.message })
        else setStage({ at: 'trouble', message: e instanceof Error ? e.message : 'That did not work.' })
      })
  }

  const again = () => { setFile(null); setStage({ at: 'choose' }) }

  const ready =
    how === 'zip' ? file !== null
    : how === 'paste' ? pasted.some((f) => f.name.trim() && f.text.trim())
    : artifact.trim() !== ''

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
            <Way id="zip" title="A zip file" note="Everything in one folder" icon={ICON.zip} how={how} choose={choose} />
            <Way id="art" title="A Claude artifact" note="Paste the code Claude wrote" icon={ICON.artifact} how={how} choose={choose} />
            <Way id="paste" title="Pasted files" note="Type or paste each file" icon={ICON.paste} how={how} choose={choose} />
          </div>

          <div className="panel" style={{ padding: 22, marginTop: 4 }}>
            {how === 'zip' ? (
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
            ) : null}

            {how === 'art' ? (
              <div style={s('display:flex;flex-direction:column;gap:10px')}>
                <label className="lab" htmlFor="artifact">The code from your artifact</label>
                <textarea id="artifact" className="inp" style={s(MONO + ';min-height:280px')} spellCheck={false}
                  placeholder="In Claude, open the artifact, choose Copy, and paste it here."
                  value={artifact} onChange={(e) => { setArtifact(e.target.value); setWarn(null) }} />
                <p className="small" style={{ margin: 0 }}>
                  Artifacts written in Python work today. Web pages and React components are not supported yet.
                </p>
              </div>
            ) : null}

            {how === 'paste' ? (
              <div style={s('display:flex;flex-direction:column;gap:22px')}>
                {pasted.map((item, i) => (
                  <div key={i} style={s('display:flex;flex-direction:column;gap:10px')}>
                    <div style={s('display:flex;align-items:center;gap:12px')}>
                      <input className="inp" type="text" aria-label={`Name of file ${i + 1}`} spellCheck={false}
                        placeholder={i === 0 ? 'File name, like convert.py' : 'File name, like requirements.txt'}
                        value={item.name} onChange={(e) => { setPastedFile(i, { name: e.target.value }); setWarn(null) }} />
                      {pasted.length > 1 ? (
                        <button type="button" className="ghost" style={{ flex: 'none' }}
                          onClick={() => setPasted((files) => files.filter((_, at) => at !== i))}>Remove</button>
                      ) : null}
                    </div>
                    <textarea className="inp" style={s(MONO)} aria-label={`What is in file ${i + 1}`} spellCheck={false}
                      placeholder="Paste what is in the file"
                      value={item.text} onChange={(e) => { setPastedFile(i, { text: e.target.value }); setWarn(null) }} />
                  </div>
                ))}
                <div>
                  <button type="button" className="ghost"
                    onClick={() => setPasted((files) => [...files, { name: '', text: '' }])}>Add another file</button>
                </div>
              </div>
            ) : null}
            {warn ? <p className="small" role="alert" style={{ margin: '14px 4px 0', color: '#b4563c' }}>{warn}</p> : null}
          </div>

          <div style={s('display:flex;align-items:center;gap:14px;margin-top:22px')}>
            <button type="button" className="btn" disabled={!ready} onClick={start}>Continue</button>
            <Link className="ghost" to="/my-things">Cancel</Link>
          </div>
        </div>
      </main>
    </Page>
  )
}

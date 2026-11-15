import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api, systemsLine, SYSTEM_NAME, type Build, type Platform, type RefreshResult, type Visibility,
} from '../api'
import { Main, Page, Plain, Trouble } from '../components/bits'
import { Box, CenterHero, Choice, Column, Done, Mark, ORDER, SignedIn, Steps, useLoad, type MarkKind } from '../components/kit'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const P6: OrbSpec[] = [[0.975, 0.88, 0.082, 'teal'], [0.02, 1.05, 0.108, 'olive']]
const P7: OrbSpec[] = [[0.975, 0.88, 0.08, 'teal'], [0.02, 1.05, 0.108, 'stone']]
const P8: OrbSpec[] = [[0.975, 0.9, 0.078, 'clay'], [0.02, 1.05, 0.105, 'olive']]
const P9: OrbSpec[] = [[0.975, 0.9, 0.078, 'ink'], [0.02, 1.05, 0.105, 'stone']]

const EVERY = 4000

function stepsFor(b: Build | undefined, platform: Platform): { kind: MarkKind; label: string; note?: string }[] {
  const status = b?.status ?? 'waiting'
  if (status === 'ready') {
    return [
      { kind: 'done', label: 'Started', note: 'Done' },
      { kind: 'done', label: 'Built', note: 'Done' },
      { kind: 'done', label: 'Ready to download', note: 'Done' },
    ]
  }
  if (status === 'building') {
    return [
      { kind: 'done', label: 'Started', note: 'Done' },
      { kind: 'now', label: `Building for ${SYSTEM_NAME[platform]}`, note: 'Working on it' },
      { kind: 'todo', label: 'Ready to download' },
    ]
  }
  if (status === 'failed') {
    return [
      { kind: 'done', label: 'Started' },
      { kind: 'bad', label: 'Did not build' },
      { kind: 'todo', label: 'Not ready to download' },
    ]
  }
  if (status === 'cannot') {
    return [
      { kind: 'na', label: 'Cannot be built' },
      { kind: 'na', label: 'Nothing to check' },
      { kind: 'na', label: 'Nothing to download' },
    ]
  }
  return [
    { kind: 'now', label: 'Waiting to start' },
    { kind: 'todo', label: 'Built' },
    { kind: 'todo', label: 'Ready to download' },
  ]
}

function Systems({ builds }: { builds: Build[] }) {
  return (
    <div className="grid2" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
      {ORDER.map((p) => {
        const b = builds.find((x) => x.platform === p)
        return (
          <div className="panel" key={p} style={s('display:flex;flex-direction:column;gap:4px;padding:12px 28px 20px')}>
            <h2 className="h2" style={{ margin: '16px 0 6px' }}>{SYSTEM_NAME[p]}</h2>
            <Steps steps={stepsFor(b, p)} />
            {b?.status === 'cannot' ? <p className="small" style={{ margin: '14px 0 0' }}>This will not change by trying again.</p> : null}
          </div>
        )
      })}
    </div>
  )
}

const SEEN: Record<Visibility, string> = {
  public: 'Anyone can find it in browse and get it',
  link: 'Anyone you send the link to can get it',
  private: 'Only you can see it for now. Change that from My things whenever you like',
}

/** P6 while the builds run, then P7, P8 or P9 depending on how they came out. */
export function Ready() {
  return <SignedIn current="Publish" orbs={P6}><ReadyPage /></SignedIn>
}

function ReadyPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { data: page, error, again } = useLoad(() => api.project(slug), [slug])
  const [state, setState] = useState<RefreshResult | null>(null)
  const [asks, setAsks] = useState(0)
  const [anyway, setAnyway] = useState(false)
  const [copied, setCopied] = useState(false)

  // Ask GitHub, through the API, until every system has settled.
  useEffect(() => {
    if (!page) return
    let live = true
    let timer = 0
    const ask = () => {
      api.refresh(page.version.id)
        .then((r) => {
          if (!live) return
          setState(r)
          setAsks((n) => n + 1)
          if (r.outcome === 'waiting') timer = window.setTimeout(ask, EVERY)
        })
        .catch(() => { if (live) timer = window.setTimeout(ask, EVERY * 2) })
    }
    ask()
    return () => { live = false; window.clearTimeout(timer) }
  }, [page])

  if (error) return <Plain current="Publish" title="That did not work" line="The project could not be loaded."><Trouble message={error.message} again={again} /></Plain>
  if (!page) return <Page current="Publish" orbs={P6}><CenterHero title={<span style={{ color: 'rgba(9,23,23,0.46)' }}>Getting it</span>} /><Main>{null}</Main></Page>

  const name = page.project.name
  const builds = state?.builds ?? page.builds
  const outcome = state?.outcome ?? 'waiting'
  const ready = ORDER.filter((p) => builds.some((b) => b.platform === p && b.status === 'ready'))
  const cannot = builds.filter((b) => b.status === 'cannot')
  const failed = builds.filter((b) => b.status === 'failed')
  const link = `${window.location.origin}/p/${slug}`

  // P7. Everything built, or the maker chose to go ahead with what did.
  if (outcome === 'all' || anyway) {
    return (
      <Page current="Publish" orbs={P7}>
        <CenterHero title={<><Done />{name} is {page.project.visibility === 'private' ? 'ready' : 'shared'}</>}
          sub={`${SEEN[page.project.visibility]}${page.project.visibility === 'private' ? '.' : ` for ${systemsLine(ready)}.`}`} />
        <Main>
          <Column>
            <Box title="Its link" gap={16}>
              <div style={s('display:flex;flex-wrap:wrap;gap:12px;align-items:center')}>
                <input className="inp" type="text" readOnly value={link} aria-label="Link to this project"
                  style={{ flex: 1, minWidth: 280 }} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="ghost"
                  onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)) }}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <span className="small">Anyone you send this to can open it, even before they make an account.</span>
            </Box>
            <div style={s('display:flex;flex-wrap:wrap;gap:14px')}>
              <Link className="btn" to={`/p/${slug}`}>See your project page</Link>
              {'share' in navigator ? (
                <button type="button" className="ghost"
                  onClick={() => { void navigator.share({ title: name, url: link }).catch(() => undefined) }}>
                  Share it with someone
                </button>
              ) : null}
            </div>
            <Box title={<span style={{ display: 'block', marginBottom: 10 }}>What next</span>} gap={0} style={{ marginTop: 4 }}>
              <Choice title="Change who can see it" body="Take it back to private at any time, or open it up to everyone.">
                <Link className="ghost" to={`/my-things/${slug}`}>Sharing</Link>
              </Choice>
              <Choice title="See what people send you" body="People who use it can suggest changes. You decide what to keep.">
                <Link className="ghost" to={`/my-things/${slug}/suggestions`}>Suggestions</Link>
              </Choice>
            </Box>
          </Column>
        </Main>
      </Page>
    )
  }

  // P9. It can only ever work on some systems. That is allowed.
  if (outcome !== 'waiting' && ready.length > 0 && failed.length === 0 && cannot.length > 0) {
    const only = systemsLine(ready)
    const not = systemsLine(cannot.map((b) => b.platform))
    return (
      <Page current="Publish" orbs={P9}>
        <CenterHero title={`This one can only work on ${only}`}
          sub={`That is allowed. You can share it for ${only}, and people on ${not} will be told it is not for their computer.`} />
        <Main>
          <Column>
            <Systems builds={builds} />
            <div className="panel" style={s('display:flex;gap:18px;padding:28px')}>
              <Mark kind="na" style={{ marginTop: 2 }} />
              <span style={s('display:flex;flex-direction:column;gap:8px')}>
                <span className="h2">Why it cannot work on {not}</span>
                {cannot.map((b) => b.message).filter(Boolean).slice(0, 1).map((m) => <span className="body" key={m}>{m}</span>)}
                <span className="body">Nothing is wrong with your project. Plenty of useful things only work on one kind of computer.</span>
              </span>
            </div>
            <Box title={<span style={{ display: 'block', marginBottom: 10 }}>What you can do</span>} gap={0}>
              <Choice title={`Share it for ${only} only`} body={`People on ${not} see that it is not for their computer. People on ${only} get it as normal.`}>
                <button type="button" className="btn" onClick={() => setAnyway(true)}>Share for {only} only</button>
              </Choice>
              <Choice title="Leave it for now" body="It stays a draft. Only you can see it, and nothing is shared.">
                <button type="button" className="ghost"
                  onClick={() => { void api.show(slug, 'private').then(() => navigate('/my-things')) }}>
                  Save as draft
                </button>
              </Choice>
            </Box>
          </Column>
        </Main>
      </Page>
    )
  }

  // P8. Some of it did not build, or none of it did.
  if (outcome !== 'waiting' && builds.length > 0) {
    const missing = systemsLine([...failed, ...cannot].map((b) => b.platform))
    return (
      <Page current="Publish" orbs={P8}>
        <CenterHero
          title={ready.length > 0 ? `Ready for ${systemsLine(ready)}, not ${missing} yet` : 'It did not build'}
          sub={ready.length > 0
            ? `You can share it for ${systemsLine(ready)} now. People on ${missing} are told it is not ready for their computer.`
            : 'Nothing has been shared. Nobody can get it until at least one system builds.'} />
        <Main>
          <Column>
            <Systems builds={builds} />
            <div className="panel" style={s('display:flex;gap:18px;padding:28px')}>
              <Mark kind="bad" style={{ marginTop: 2 }} />
              <span style={s('display:flex;flex-direction:column;gap:8px')}>
                <span className="h2">What went wrong</span>
                {failed.map((b) => (
                  <span className="body" key={b.platform}>
                    {SYSTEM_NAME[b.platform]}: {b.message || 'The build stopped before it finished.'}
                  </span>
                ))}
                <span className="body">This is the kind of thing that is usually a small fix.</span>
              </span>
            </div>
            <Box title={<span style={{ display: 'block', marginBottom: 10 }}>What you can do</span>} gap={0}>
              {ready.length > 0 ? (
                <Choice title={`Share it for ${systemsLine(ready)} for now`} body={`People on ${systemsLine(ready)} get it today. People on ${missing} are told it is not ready for their computer.`}>
                  <button type="button" className="ghost" onClick={() => setAnyway(true)}>Share for {systemsLine(ready)}</button>
                </Choice>
              ) : null}
              <Choice title="Fix it and share it again" body="Change the project, zip it again and share the new zip. Nothing you shared before is lost.">
                <Link className="ghost" to="/publish">Share a new zip</Link>
              </Choice>
              <Choice title="Leave it for now" body="It stays a draft. Only you can see it, and nothing is shared.">
                <button type="button" className="ghost"
                  onClick={() => { void api.show(slug, 'private').then(() => navigate('/my-things')) }}>
                  Save as draft
                </button>
              </Choice>
            </Box>
          </Column>
        </Main>
      </Page>
    )
  }

  // P6. Still going.
  const never = state !== null && builds.length === 0
  const stuck = never || (state !== null && !state.found && asks >= 8)
  return (
    <Page current="Publish" orbs={P6}>
      <CenterHero title={`${name} is being made ready`}
        sub="People can only get a version once it is built and checked. You can close this page; it carries on without you." />
      <Main>
        <Column>
          <Systems builds={builds} />
          {stuck ? (
            <p className="body" style={{ margin: 0, textAlign: 'center' }}>
              {never
                ? `Version ${page.version.number} has not been sent to be built yet. Until it is, people get the newest version that is ready.`
                : 'The builds have not started yet. If this stays the same for a few minutes, the build service may not be set up.'}
            </p>
          ) : null}
          <div style={s('display:flex;justify-content:center;margin-top:4px')}>
            <Link className="ghost" to={`/p/${slug}`}>See your project page</Link>
          </div>
          <p className="small" style={s('margin:0;text-align:center')}>
            {page.project.visibility === 'private' ? 'Only you can see it.' : 'Its page is up, and the download appears as soon as a system is ready.'}
          </p>
        </Column>
      </Main>
    </Page>
  )
}

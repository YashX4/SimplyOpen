import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type ProjectPage, type Visibility } from '../api'
import { Main, Page, Plain, Trouble } from '../components/bits'
import { tintFor } from '../components/Cover'
import {
  Box, CenterHero, CheckRows, KitWindow, Mark, SignedIn, Tally, Touches, TwoUp, useLoad,
} from '../components/kit'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const P3: OrbSpec[] = [[0.975, 0.92, 0.078, 'olive'], [0.02, 1.06, 0.11, 'ink']]

const WHO: [Visibility, string, string][] = [
  ['private', 'Only me', 'Nobody else can find it or open it.'],
  ['link', 'Anyone with the link', 'Not shown in browse. You choose who to send it to.'],
  ['public', 'Everyone', 'Shown in browse, where anyone can find it.'],
]

interface Problem { title: string; body: string }

/** What stops it being shared. Only things that were really found go here. */
function problemsIn(page: ProjectPage): Problem[] {
  const out: Problem[] = []
  const { check } = page
  if (check?.status === 'failed') {
    out.push({ title: 'Something in it did not pass the checks', body: check.summary })
  }
  const keys = check?.manifest?.capabilities?.reads_env_vars ?? []
  if (keys.length > 0) {
    out.push({
      title: 'This needs a key to run, and that is not supported yet',
      body: `It asks for ${keys.join(', ')} when it starts. Projects that need a key cannot be shared yet.`,
    })
  }
  return out
}

function SmallCover({ slug }: { slug: string }) {
  return (
    <div aria-hidden="true" style={s('flex:none;width:132px;height:92px;border-radius:12px;overflow:hidden;background:linear-gradient(162deg,#f2f3f0 0%,#e4e7e4 100%);display:flex;align-items:center;justify-content:center')}>
      <div style={s('width:84px;height:58px;border-radius:7px;background:#fff;border:1px solid rgba(9,23,23,0.12);box-shadow:0 4px 10px rgba(9,23,23,0.1);display:flex;flex-direction:column;gap:5px;padding:7px;box-sizing:border-box')}>
        <i style={s('display:block;width:70%;height:4px;border-radius:2px;background:rgba(9,23,23,0.22)')} />
        <i style={s('display:block;width:100%;height:18px;border-radius:4px;border:1px dashed rgba(9,23,23,0.2)')} />
        <i style={{ display: 'block', width: '100%', height: 9, borderRadius: 5, background: tintFor(slug) }} />
      </div>
    </div>
  )
}

/** P3, or P4 when something stops it. Everything the analyzer wrote can be changed here. */
export function Review() {
  return <SignedIn current="Publish" orbs={P3}><ReviewPage /></SignedIn>
}

function ReviewPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { data: page, error, again } = useLoad(() => api.project(slug), [slug])
  const [name, setName] = useState('')
  const [what, setWhat] = useState('')
  const [who, setWho] = useState<Visibility>('private')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    if (!page) return
    setName(page.project.name)
    setWhat(page.project.description)
    setWho(page.project.visibility)
  }, [page])

  if (error) return <Plain current="Publish" title="That did not work" line="The project could not be loaded."><Trouble message={error.message} again={again} /></Plain>
  if (!page) return <Page current="Publish" orbs={P3}><CenterHero title={<span style={{ color: 'rgba(9,23,23,0.46)' }}>Getting it</span>} /><Main>{null}</Main></Page>
  if (!page.can_edit) {
    return <Plain current="Publish" title="This is not yours to change" line="Only the person who made it can check it over."><div className="col"><Link className="btn" to={`/p/${slug}`}>See its page</Link></div></Plain>
  }

  const problems = problemsIn(page)
  const save = (visibility: Visibility, then: string) => {
    setBusy(true)
    setSaid(null)
    api.rename(slug, name, what)
      .then(() => api.show(slug, visibility))
      .then(() => navigate(then))
      .catch((e: Error) => { setSaid(e.message); setBusy(false) })
  }

  return (
    <Page current="Publish" orbs={P3}>
      <CenterHero title="Check it over before you share it" bottom={90}
        sub="Nothing is shared yet. Only you can see this page." />
      <Main>
        {problems.length > 0 ? (
          <div className="panel" style={s('display:flex;flex-direction:column;gap:0;padding:28px;margin-bottom:32px')}>
            <h2 className="h2" style={{ marginBottom: 14 }}>Fix {problems.length === 1 ? 'this' : 'these'} before you can share it</h2>
            {problems.map((p) => (
              <div className="prob" key={p.title}>
                <Mark kind="bad" />
                <span style={s('display:flex;flex-direction:column;gap:6px;flex:1')}>
                  <span className="h3">{p.title}</span>
                  <span className="body">{p.body}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="body" style={s('max-width:880px;margin:0 auto 32px;text-align:center')}>
            The name and what it does were written for you. Change anything.
          </p>
        )}

        <TwoUp
          left={<>
            <Box title="The basics" gap={22}>
              <label className="fld">
                <span className="lab">Name</span>
                <input className="inp" type="text" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="fld">
                <span className="lab">What it does</span>
                <textarea className="inp" value={what} onChange={(e) => setWhat(e.target.value)} />
              </label>
              <div className="fld">
                <span className="lab">Cover</span>
                <div style={s('display:flex;align-items:center;gap:18px')}>
                  <SmallCover slug={slug} />
                  <span className="small">We made this cover from the window people will get.</span>
                </div>
              </div>
            </Box>

            <Box title={<span style={{ display: 'block', marginBottom: 10 }}>Who can see it</span>} gap={6}>
              <div role="radiogroup" aria-label="Who can see it">
                {WHO.map(([value, title, note]) => (
                  <label className="opt" style={{ position: 'relative' }} key={value}>
                    <input type="radio" className="r" name="who" checked={who === value} onChange={() => setWho(value)} />
                    <span className="dot" aria-hidden="true" />
                    <span style={s('display:flex;flex-direction:column;gap:3px')}>
                      <span className="h3">{title}</span>
                      <span className="small">{note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Box>

            <Touches check={page.check} />

            <div className="panel" style={s('display:flex;flex-direction:column;gap:6px;padding:28px')}>
              <h2 className="h2" style={{ marginBottom: 10 }}>Checks</h2>
              <Tally kind="done">Read the files</Tally>
              <CheckRows check={page.check} builds={page.builds} />
              <p className="small" style={{ margin: '14px 0 0' }}>Only checks that really ran appear here. The builds carry on while you read this.</p>
            </div>
          </>}
          right={
            <Box title="How it will look" note="This is the window people get when they open it.">
              <KitWindow name={name || page.project.name} />
            </Box>
          }
        />

        <div className="panel" style={s('display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:22px 28px;margin-top:32px')}>
          <Link className="ghost" to="/publish">Back</Link>
          <div style={{ flex: 1 }} />
          {said ? <span className="small" role="alert" style={{ color: '#b4563c' }}>{said}</span> : null}
          {problems.length > 0 ? (
            <span className="small" style={{ textAlign: 'right' }}>
              Fix the {problems.length === 1 ? 'problem' : 'problems'} above<br />before you can share it.
            </span>
          ) : null}
          <button type="button" className="ghost" disabled={busy} onClick={() => save('private', '/my-things')}>Save as draft</button>
          <button type="button" className="btn" disabled={busy || problems.length > 0 || !name.trim()}
            onClick={() => save(who, `/publish/${slug}/ready`)}>
            Share it
          </button>
        </div>
      </Main>
    </Page>
  )
}

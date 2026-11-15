import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, thisSystem, type ProjectSummary } from '../api'
import { ProjectRow } from '../components/ProjectCard'
import { SearchField, TOPICS, searchPath } from '../components/Search'
import { Hero, HeroLine, Main, Page, Trouble } from '../components/bits'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const FOUND: OrbSpec[] = [[0.975, 0.92, 0.072, 'ink'], [0.02, 1.06, 0.1, 'teal']]
const NONE: OrbSpec[] = [[0.975, 0.88, 0.078, 'stone'], [0.02, 1.05, 0.105, 'violet']]
const MONTH = 30 * 24 * 60 * 60 * 1000

function Switch({ label, on, flip }: { label: string; on: boolean; flip: () => void }) {
  return (
    <label className="row2" style={{ alignItems: 'center', cursor: 'pointer' }}>
      <span className="body" style={{ color: '#091717', flex: 1 }}>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={flip}
        style={{ justifyContent: on ? 'flex-end' : 'flex-start', background: on ? '#2f6f6a' : 'rgba(9,23,23,0.22)' }}>
        <i />
      </button>
    </label>
  )
}

export function SearchResults() {
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const navigate = useNavigate()
  const [found, setFound] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The first two start switched on, as on the board: what you see by default is
  // what is safe and what will actually open on the computer in front of you.
  const [checked, setChecked] = useState(true)
  const [mine, setMine] = useState(true)
  const [recent, setRecent] = useState(false)

  const load = useCallback(() => {
    setFound(null)
    setError(null)
    // No words means "see all", which is browse with no limit on it.
    const ask = q ? api.search(q) : api.browse()
    ask.then((r) => setFound(r.projects)).catch((e: Error) => setError(e.message))
  }, [q])
  useEffect(load, [load])

  const system = thisSystem()
  const shown = (found ?? []).filter((p) =>
    (!checked || p.checked) &&
    (!mine || p.systems.includes(system)) &&
    (!recent || Date.now() - new Date(p.updated_at).getTime() < MONTH))

  const field = <SearchField initial={q} height={60} />

  if (error) {
    return (
      <Page current="Browse" orbs={NONE}>
        <Hero pre={field} title="That did not work" bottom={120} />
        <Main><Trouble message={error} again={load} /></Main>
      </Page>
    )
  }

  // W3. Nothing matched, so say so and offer other ways in.
  if (found !== null && found.length === 0) {
    return (
      <Page current="Browse" orbs={NONE}>
        <Hero pre={field} title={`Nothing found for ${q}`} bottom={120}
          sub={<HeroLine>Nothing here matches those words yet.</HeroLine>} />
        <Main>
          <div className="col" style={s('display:flex;flex-direction:column;gap:28px')}>
            <div className="panel" style={s('display:flex;flex-direction:column;gap:20px;padding:30px')}>
              <h2 className="h2">Try different words</h2>
              <p className="body" style={{ margin: 0 }}>
                Say what you want to do rather than what it might be called. "Turn my
                recordings into text" finds more than "transcription utility".
              </p>
              <div style={s('display:flex;flex-direction:column;gap:12px')}>
                <span className="lab">Or start from one of these</span>
                <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
                  {TOPICS.map((topic) => (
                    <button key={topic} type="button" className="chip" onClick={() => navigate(searchPath(topic))}>
                      {topic}
                    </button>
                  ))}
                </div>
              </div>
              <div className="door" style={{ paddingTop: 20 }}>
                <Link className="btn" to="/">Browse everything</Link>
              </div>
            </div>
          </div>
        </Main>
      </Page>
    )
  }

  const count = found === null
    ? 'Looking.'
    : shown.length === 1 ? '1 thing does that' : `${shown.length} things do that`

  return (
    <Page current="Browse" orbs={FOUND}>
      <Hero pre={field} title={q || 'Everything'} bottom={70} sub={<HeroLine>{count}</HeroLine>} />
      <Main>
        <div className="grid2" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
          <div style={s('display:flex;flex-direction:column;gap:20px')}>
            {shown.map((p) => <ProjectRow key={p.slug} project={p} />)}
            {found !== null && shown.length === 0 ? (
              <p className="body" style={{ margin: 0 }}>
                Nothing is left with those switched on. Turn one off to see more.
              </p>
            ) : null}
            {found !== null ? (
              <p className="small" style={{ margin: '10px 0 0' }}>
                Nothing here needs you to know what a terminal is.
              </p>
            ) : null}
          </div>

          <div style={s('display:flex;flex-direction:column;gap:32px;position:sticky;top:24px')}>
            <div className="panel" style={s('display:flex;flex-direction:column;gap:18px;padding:26px')}>
              <h2 className="h2">Narrow it down</h2>
              <div style={s('display:flex;flex-direction:column;gap:10px')}>
                <span className="lab">What you want to do</span>
                <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
                  {TOPICS.slice(0, 2).concat(TOPICS.slice(5)).map((topic) => (
                    <button key={topic} type="button"
                      className={topic.toLowerCase() === q.toLowerCase() ? 'chip on' : 'chip'}
                      onClick={() => navigate(searchPath(topic))}>
                      {topic}
                    </button>
                  ))}
                </div>
              </div>
              <div style={s('display:flex;flex-direction:column;gap:4px')}>
                <span className="lab" style={{ marginBottom: 6 }}>Only show</span>
                <Switch label="Checked for leaked keys" on={checked} flip={() => setChecked(!checked)} />
                <Switch label="Works on my computer" on={mine} flip={() => setMine(!mine)} />
                <Switch label="Made in the last month" on={recent} flip={() => setRecent(!recent)} />
              </div>
            </div>
          </div>
        </div>
      </Main>
    </Page>
  )
}

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type ProjectSummary } from '../api'
import { ProjectCard } from '../components/ProjectCard'
import { SearchField, TOPICS, searchPath } from '../components/Search'
import { Arrow, Backdrop, Page, Trouble } from '../components/bits'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const ORBS: OrbSpec[] = [
  [0.04, 0.62, 0.215, 'teal'],
  [0.935, 0.3, 0.082, 'clay'],
  [0.255, 0.085, 0.058, 'stone'],
]

const WEEK = 7 * 24 * 60 * 60 * 1000

function Shelf({ title, children, grid, count }: {
  title: string; grid: 'g3' | 'g4'; count: number; children: ReactNode
}) {
  // A row that is not full sits in the middle rather than hanging off the left.
  const across = grid === 'g3' ? 3 : 4
  const short = count < across
    ? { gridTemplateColumns: `repeat(${count}, minmax(0, ${grid === 'g3' ? 363 : 270}px))`, justifyContent: 'center' }
    : undefined
  return (
    <section style={s('display:flex;flex-direction:column;align-items:center;gap:64px;padding-bottom:160px')}>
      <h2 className="canon" style={s('margin:0;font-size:48px;line-height:1.2;letter-spacing:-0.021em;text-align:center')}>
        {title}
      </h2>
      <div className={grid} style={short}>{children}</div>
      <Link className="more" to="/search">See all<Arrow /></Link>
    </section>
  )
}

export function Browse() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const load = useCallback(() => {
    setError(null)
    api.browse()
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  // The front row is the team's: everything someone on the team shares, and
  // anything they picked, newest first. Until there is any, it is what people
  // have starred most. Whatever is left and was changed this week goes on the
  // second row, so nothing shows twice.
  const all = projects ?? []
  const featured = all.filter((p) => p.featured)
  const picks = featured.length > 0 ? featured.slice(0, 9) : [...all].sort((a, b) => b.stars - a.stars).slice(0, 6)
  const rest = all.filter((p) => !picks.includes(p))
  const fresh = rest.filter((p) => Date.now() - new Date(p.updated_at).getTime() < WEEK).slice(0, 8)
  const more = fresh.length > 0 ? fresh : rest.slice(0, 8)

  return (
    <Page orbs={ORBS}>
      <section style={s('position:relative;display:flex;flex-direction:column;align-items:center;padding-top:120px;padding-bottom:150px')}>
        <Backdrop />
        <div className="wrap" style={s('position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:0;width:100%')}>
          <p style={s('margin:0 0 26px;font-size:20px;line-height:1;color:rgba(9,23,23,0.64)')}>
            Open projects, made by people like you
          </p>
          <h1 className="canon" style={s('position:relative;margin:0;width:100%;height:178px;cursor:pointer;display:flex;align-items:center;justify-content:center;text-align:center;font-size:80px;line-height:1;letter-spacing:-0.02em')}>
            <span data-fb="1" style={{ display: 'block' }}>Everything here<br />just runs</span>
            <canvas data-head="1" data-line1="Everything here" data-line2="just runs" data-pad="40" aria-hidden="true"
              style={s('position:absolute;left:0;top:-61px;width:100%;height:300px;display:block;pointer-events:none')} />
          </h1>
          <div style={{ width: '100%', maxWidth: 620, marginTop: 44 }}>
            <SearchField />
          </div>
          <div style={s('display:flex;flex-wrap:wrap;justify-content:center;gap:10px;max-width:760px;margin-top:22px')}>
            {TOPICS.map((topic) => (
              <button key={topic} type="button" className="pill" onClick={() => navigate(searchPath(topic))}>
                {topic}
              </button>
            ))}
          </div>
          <p style={s('margin:40px 0 0;font-size:20px;line-height:1;color:rgba(9,23,23,0.64)')}>
            Download it, press Run. Mac, Windows and Linux.
          </p>
        </div>
      </section>

      <main className="wrap" style={s('position:relative;z-index:1;display:flex;flex-direction:column')}>
        {error ? (
          <div style={{ paddingBottom: 160 }}><Trouble message={error} again={load} /></div>
        ) : null}

        {projects !== null && all.length === 0 ? (
          <section style={s('display:flex;flex-direction:column;align-items:center;gap:24px;padding-bottom:160px;text-align:center')}>
            <h2 className="canon" style={s('margin:0;font-size:48px;line-height:1.2;letter-spacing:-0.021em')}>
              Nothing has been shared yet
            </h2>
            <p style={s('margin:0;font-size:20px;line-height:1.3;color:rgba(9,23,23,0.64)')}>
              Yours could be the first.
            </p>
            <Link className="btn" to="/publish">Publish something</Link>
          </section>
        ) : null}

        {picks.length > 0 ? (
          <div id="picks" style={{ display: 'contents' }}>
            <Shelf title="Picks from the team" grid="g3" count={picks.length}>
              {picks.map((p) => <ProjectCard key={p.slug} project={p} />)}
            </Shelf>
          </div>
        ) : null}

        {more.length > 0 ? (
          <Shelf title={fresh.length > 0 ? 'New this week' : 'More to try'} grid="g4" count={more.length}>
            {more.map((p) => <ProjectCard key={p.slug} project={p} size="small" />)}
          </Shelf>
        ) : null}

      </main>
    </Page>
  )
}

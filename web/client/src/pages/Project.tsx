import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api, ApiError, stillCollecting, readableDate, readableSize, systemsLine, SYSTEM_NAME, thisSystem,
  type Build, type Platform, type ProjectPage, type VersionRow,
} from '../api'
import {
  Avatar, Bang, Checked, Hero, Main, Page, Plain, Trouble, useMe,
} from '../components/bits'
import { GetItSheet, KitWindow, Mark, Touches } from '../components/kit'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const ORBS: OrbSpec[] = [[0.975, 0.9, 0.078, 'teal'], [0.02, 1.05, 0.108, 'clay']]
const ORDER: Platform[] = ['mac', 'windows', 'linux']

function people(n: number): string {
  if (n === 0) return 'Nobody has starred it yet'
  return n === 1 ? '1 person has starred it' : `${n} people have starred it`
}

function GetIt({ page, get }: { page: ProjectPage; get: (p: Platform) => void }) {
  const { version, builds, check } = page
  const [open, setOpen] = useState(false)
  const ready = ORDER.flatMap((p) => builds.filter((b) => b.platform === p && b.status === 'ready'))
  const here = thisSystem()
  const first: Build | undefined = ready.find((b) => b.platform === here) ?? ready[0]
  const others = ready.filter((b) => b !== first)
  const missing = ORDER.flatMap((p) => builds.filter((b) => b.platform === p && b.status !== 'ready'))

  if (!first) {
    return (
      <div className="panel" style={s('display:flex;flex-direction:column;gap:6px;padding:28px')}>
        <h2 className="h2" style={{ marginBottom: 10 }}>Not ready yet</h2>
        {missing.map((b) => (
          <div className="row2" key={b.platform}>
            <span className="h3" style={{ flex: 'none', width: 92 }}>{SYSTEM_NAME[b.platform]}</span>
            <span className="body">{b.message || (b.status === 'cannot'
              ? 'This cannot be built for that system.'
              : 'Still being built. Come back in a few minutes.')}</span>
          </div>
        ))}
        {missing.length === 0 ? <p className="body" style={{ margin: 0 }}>Nothing has been built for this version yet.</p> : null}
      </div>
    )
  }

  const facts = [`Version ${version.number}`, readableDate(version.created_at), readableSize(first.size_bytes)]
    .filter(Boolean).join(', ')

  return (
    <div className="panel" style={s('display:flex;flex-direction:column;gap:16px;padding:28px')}>
      <button type="button" className="btn" onClick={() => get(first.platform)} style={s('width:100%;box-sizing:border-box')}>
        Get it for {SYSTEM_NAME[first.platform]}
      </button>
      <div style={s('display:flex;flex-direction:column;gap:8px')}>
        <span className="small">{facts}</span>
        {check?.status === 'passed' ? <Checked size={16} /> : null}
        {first.platform !== here ? (
          <span className="small">There is no build for {SYSTEM_NAME[here]} yet.</span>
        ) : null}
      </div>
      {others.length > 0 ? (
        <div className="door" style={{ paddingTop: 16, gap: 10 }}>
          {open ? others.map((b) => (
            <button type="button" key={b.platform} className="ghost" onClick={() => get(b.platform)}
              style={{ height: 44, fontSize: 16 }}>
              Get it for {SYSTEM_NAME[b.platform]}
            </button>
          )) : (
            <button type="button" className="ghost" onClick={() => setOpen(true)} style={{ height: 44, fontSize: 16 }}>
              Also on {systemsLine(others.map((b) => b.platform))}
            </button>
          )}
        </div>
      ) : null}
      {missing.map((b) => (
        <span className="small" key={b.platform}>
          Not on {SYSTEM_NAME[b.platform]}. {b.message || 'There is no build for that system.'}
        </span>
      ))}
    </div>
  )
}

function Versions({ slug, current, get }: { slug: string; current: number; get: (id: string) => void }) {
  const [rows, setRows] = useState<VersionRow[] | null>(null)
  useEffect(() => {
    setRows(null)
    api.versions(slug).then((r) => setRows(r.versions)).catch(() => setRows([]))
  }, [slug])

  if (!rows || rows.length === 0) return null
  const shown = rows.slice(0, 3)

  return (
    <div className="panel" style={s('display:flex;flex-direction:column;gap:0;padding:28px')}>
      <div style={s('display:flex;align-items:baseline;gap:16px;margin-bottom:6px')}>
        <h2 className="h2">Versions</h2>
        <Link className="nav" to={`/p/${slug}/versions`} style={{ marginLeft: 'auto' }}>See all</Link>
      </div>
      {shown.map((v) => v.number === current ? (
        <div className="row2" key={v.id} style={{ alignItems: 'flex-start', gap: 12 }}>
          <span style={s('display:flex;flex-direction:column;gap:4px;flex:1')}>
            <span style={s('display:flex;align-items:center;gap:10px')}>
              <Link className="h3" to={`/p/${slug}/v/${v.number}`} style={{ textDecoration: 'none' }}>Version {v.number}</Link>
              <span className="chip on" style={s('height:28px;padding:0 12px;font-size:14px')}>Now</span>
            </span>
            <span className="body" style={{ color: '#091717' }}>{v.note || 'No note was left.'}</span>
            <span className="small">
              {readableDate(v.created_at)}
              {v.suggester_name ? `, with a change ${v.suggester_name} suggested` : ''}
            </span>
          </span>
        </div>
      ) : (
        <div className="row2" key={v.id} style={{ alignItems: 'flex-start', gap: 16 }}>
          <Link className="h3" to={`/p/${slug}/v/${v.number}`} style={{ flex: 'none', width: 92, textDecoration: 'none' }}>Version {v.number}</Link>
          <span style={s('display:flex;flex-direction:column;gap:4px;flex:1')}>
            <span className="body" style={{ color: '#091717' }}>{v.note || (v.number === 1 ? 'First version.' : 'No note was left.')}</span>
            <span className="small">{readableDate(v.created_at)}</span>
          </span>
          {v.systems_ready > 0 ? (
            <button type="button" className="nav" onClick={() => get(v.id)} style={{ flex: 'none' }}>Get this one</button>
          ) : null}
        </div>
      ))}
      <p className="small" style={{ margin: '16px 0 0' }}>
        Older versions still work. Getting one does not replace the one you have.
      </p>
    </div>
  )
}

function Doors({ page, onStars }: { page: ProjectPage; onStars: (n: number) => void }) {
  const me = useMe()
  const navigate = useNavigate()
  const [said, setSaid] = useState<string | null>(null)
  const slug = page.project.slug

  // Both of these belong to somebody, so both need to know who is asking.
  const act = (what: () => Promise<void>) => () => {
    if (!me) { navigate('/sign-in'); return }
    what().catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) navigate('/sign-in')
      else setSaid(e instanceof Error ? e.message : 'That did not work.')
    })
  }
  const link = s('min-height:44px;background:none;border:0;padding:0;cursor:pointer')

  return (
    <div className="panel" style={s('display:flex;flex-direction:column;gap:0;padding:8px 28px 18px')}>
      <div className="row2" style={{ alignItems: 'center' }}>
        <span className="body" style={{ color: '#091717', flex: 1 }}>{people(page.stars)}</span>
        <button type="button" className="nav" style={link}
          onClick={act(async () => { onStars((await api.star(slug)).stars) })}>
          Star it
        </button>
      </div>
      <div className="row2" style={{ alignItems: 'center' }}>
        <span className="body" style={{ color: '#091717', flex: 1 }}>{page.can_edit ? 'Change it by chatting' : 'Make my own copy'}</span>
        <Link className="nav" style={{ minHeight: 44 }}
          to={page.can_edit ? `/my-things/${slug}/change` : `/p/${slug}/copy`}>
          {page.can_edit ? 'Change it' : 'Copy'}
        </Link>
      </div>
      {said ? <p className="small" role="status" style={{ margin: '10px 0 0' }}>{said}</p> : null}
    </div>
  )
}

export function Project() {
  const { slug = '' } = useParams()
  const [page, setPage] = useState<ProjectPage | null>(null)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [sheet, setSheet] = useState<{ id: string; builds: Build[]; start: Platform; checked: boolean } | null>(null)
  const [older, setOlder] = useState<{ page: ProjectPage; newest: number } | null>(null)

  // Builds only move on when somebody asks the build service. While any are
  // still going, this page asks, so leaving the progress page loses nothing.
  const versionId = page?.version.id
  const pending = page?.builds.some((b) => b.status === 'waiting' || b.status === 'building' || stillCollecting(b)) ?? false
  useEffect(() => {
    if (!versionId || !pending) return
    let live = true
    const timer = window.setInterval(() => {
      api.refresh(versionId)
        .then((r) => { if (live) setPage((now) => (now && now.version.id === versionId ? { ...now, builds: r.builds } : now)) })
        .catch(() => undefined)
    }, 8000)
    return () => { live = false; window.clearInterval(timer) }
  }, [versionId, pending])

  // A build that finished before pictures were collected still has one waiting
  // on GitHub. Ask once, per version, per visit, then show it if it came.
  const hasPicture = Boolean(page?.version.picture_url)
  useEffect(() => {
    if (!versionId || pending || hasPicture) return
    const key = `picture-asked:${versionId}`
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* fine */ }
    let live = true
    api.refresh(versionId)
      .then(() => api.project(slug))
      .then((fresh) => { if (live && fresh.version.picture_url) setPage(fresh) })
      .catch(() => undefined)
    return () => { live = false }
  }, [versionId, pending, hasPicture, slug])

  // A new version is built after it is made. Until it is, offer the newest one
  // that is ready rather than nothing, and say so.
  useEffect(() => {
    setOlder(null)
    if (!page || page.builds.some((b) => b.status === 'ready')) return
    let live = true
    void api.versions(slug).then(async ({ versions }) => {
      const ready = versions.find((v) => v.number < page.version.number && v.systems_ready > 0)
      if (!ready || !live) return
      const d = await api.version(ready.id)
      if (!live) return
      setOlder({
        newest: page.version.number,
        page: { ...page, version: { ...page.version, ...d.version }, builds: d.builds, check: d.check ?? page.check },
      })
    }).catch(() => undefined)
    return () => { live = false }
  }, [page, slug])

  const load = useCallback(() => {
    setPage(null)
    setError(null)
    api.project(slug).then(setPage).catch(setError)
  }, [slug])
  useEffect(load, [load])

  if (error) {
    const gone = error instanceof ApiError && error.status === 404
    return (
      <Plain current="Browse" title={gone ? 'There is nothing here' : 'That did not work'}
        line={gone ? 'It may have been made private, or the address may be wrong.' : 'The page could not be loaded.'}>
        {gone
          ? <div className="col"><Link className="btn" to="/">Browse everything</Link></div>
          : <Trouble message={error.message} again={load} />}
      </Plain>
    )
  }

  if (!page) {
    return (
      <Page current="Browse" orbs={ORBS}>
        <Hero title={<span style={{ color: 'rgba(9,23,23,0.46)' }}>Getting it</span>} />
        <Main>{null}</Main>
      </Page>
    )
  }

  const { project, owner, builds, check } = page
  const offered = older?.page ?? page
  const systems = offered.builds.filter((b) => b.status === 'ready').map((b) => b.platform)
  const here = thisSystem()
  const mine = offered.builds.find((b) => b.platform === here)
  // W5. It is here for other computers, but not for this one.
  const notHere = systems.length > 0 && !systems.includes(here)

  const getThis = (platform: Platform) =>
    setSheet({ id: offered.version.id, builds: offered.builds, start: platform, checked: offered.check?.status === 'passed' })
  const getVersion = (id: string) => {
    void api.version(id).then((d) => {
      const ready = d.builds.filter((b) => b.status === 'ready').map((b) => b.platform)
      setSheet({ id, builds: d.builds, start: ready.includes(here) ? here : ready[0] ?? here, checked: d.check?.status === 'passed' })
    })
  }

  return (
    <Page current="Browse" orbs={ORBS}>
      <Hero
        pre={
          <p className="small" style={{ margin: 0 }}>
            <Link className="nav" to="/" style={{ minHeight: 0 }}>Browse</Link>
            <span style={{ padding: '0 8px', color: 'rgba(9,23,23,0.46)' }}>/</span>
            {project.name}
          </p>
        }
        title={project.name}
        sub={
          <div style={s('margin:0;font-size:20px;line-height:1.3;color:rgba(9,23,23,0.64);max-width:640px')}>
            <span className="who" style={{ fontSize: 20, color: 'rgba(9,23,23,0.64)' }}>
              <Avatar name={owner.name} />By {owner.name}
            </span>
            <div style={s('display:flex;gap:26px;flex-wrap:wrap;margin-top:6px')}>
              {check?.status === 'passed' ? <Checked size={16} /> : null}
              {systems.length > 0 ? <span className="small">{systemsLine(systems)}</span> : null}
              {page.stars > 0 ? <span className="small">{people(page.stars)}</span> : null}
            </div>
          </div>
        }
      />
      <Main>
        {/* W6. A project that reaches the internet says so before anything
            else, calmly, and before the button that downloads it. */}
        {check?.network_access ? (
          <div className="panel" style={s('display:flex;align-items:flex-start;gap:16px;padding:24px 28px;margin-bottom:32px')}>
            <span className="mark bad" aria-hidden="true"><Bang /></span>
            <span style={s('display:flex;flex-direction:column;gap:6px;flex:1')}>
              <span className="h3">This one uses the internet</span>
              <span className="body">
                Almost everything here runs with the internet off. This one cannot.
              </span>
            </span>
          </div>
        ) : null}

        {notHere ? (
          <div className="panel" style={s('display:flex;align-items:flex-start;gap:16px;padding:24px 28px;margin-bottom:32px')}>
            <Mark kind="na" />
            <span style={s('display:flex;flex-direction:column;gap:6px;flex:1')}>
              <span className="h3">You are on {SYSTEM_NAME[here]}, and this one is {systemsLine(systems)} only for now</span>
              <span className="body">
                {mine?.message || `${owner.name.split(/\s+/)[0]} would have to change it for ${SYSTEM_NAME[here]} to work.`} You
                can still get it for another computer below.
              </span>
            </span>
          </div>
        ) : null}

        <div className="grid2">
          <div style={s('display:flex;flex-direction:column;gap:32px')}>
            <div className="panel" style={s('display:flex;flex-direction:column;gap:18px;padding:28px')}>
              <div style={s('display:flex;flex-direction:column;gap:6px')}>
                <h2 className="h2">What it looks like</h2>
                <span className="small">This is the whole thing. There is nothing else to learn.</span>
              </div>
              <KitWindow name={project.name} picture={offered.version.picture_url} />
            </div>

            {project.description ? (
              <div className="panel" style={s('display:flex;flex-direction:column;gap:10px;padding:28px')}>
                <h2 className="h2">What it does</h2>
                <p className="body" style={{ margin: 0 }}>{project.description}</p>
              </div>
            ) : null}

            <Touches check={check} foot="This comes from reading the code before it was built. The checked label above is the part we could confirm ourselves." />
          </div>

          <div style={s('display:flex;flex-direction:column;gap:32px;position:sticky;top:24px')}>
            {older ? (
              <p className="small" style={{ margin: '0 0 -16px' }}>
                Version {older.newest} is still being made ready. Version {older.page.version.number} works now.
              </p>
            ) : null}
            <GetIt page={offered} get={getThis} />
            <Versions slug={project.slug} current={page.version.number} get={getVersion} />
            <Doors page={page} onStars={(stars) => setPage({ ...page, stars })} />
          </div>
        </div>
      </Main>
      {sheet ? (
        <GetItSheet name={project.name} versionId={sheet.id} builds={sheet.builds} start={sheet.start}
          checked={sheet.checked} onClose={() => setSheet(null)} />
      ) : null}
    </Page>
  )
}

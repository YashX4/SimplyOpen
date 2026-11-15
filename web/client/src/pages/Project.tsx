import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api, ApiError, readableDate, readableSize, systemsLine, SYSTEM_NAME, thisSystem,
  type Build, type Platform, type ProjectPage, type VersionRow,
} from '../api'
import {
  Avatar, Bang, Checked, Hero, Main, Page, Plain, Trouble, useMe,
} from '../components/bits'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const ORBS: OrbSpec[] = [[0.975, 0.9, 0.078, 'teal'], [0.02, 1.05, 0.108, 'clay']]
const ORDER: Platform[] = ['mac', 'windows', 'linux']

function people(n: number): string {
  if (n === 0) return 'Nobody has starred it yet'
  return n === 1 ? '1 person has starred it' : `${n} people have starred it`
}

/** The window someone gets when they open it. Drawn, not screenshotted. */
function KitWindow({ name }: { name: string }) {
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

function Touches({ page }: { page: ProjectPage }) {
  const { check } = page
  if (!check) return null
  const caps = check.manifest?.capabilities
  const rows: [string, string][] = [
    ['Reads', 'The files you drop in.'],
    ['Saves', 'Its results, on your own computer.'],
    ['Internet', check.network_access
      ? 'Yes. It cannot do its job with the internet off.'
      : 'Nothing. It runs on your computer only.'],
  ]
  if (caps) {
    rows.push(['Anything else', caps.runs_other_programs
      ? 'It starts other programs on your computer.'
      : 'Nothing.'])
  }
  return (
    <div className="panel" style={s('display:flex;flex-direction:column;gap:6px;padding:28px')}>
      <h2 className="h2" style={{ marginBottom: 10 }}>What it touches</h2>
      {rows.map(([label, text]) => (
        <div className="row2" key={label}>
          <span className="h3" style={{ flex: 'none', width: 112 }}>{label}</span>
          <span className="body">{text}</span>
        </div>
      ))}
      <p className="small" style={{ margin: '14px 0 0' }}>
        This comes from reading the code before it was built. The checked label
        above is the part we could confirm ourselves.
      </p>
    </div>
  )
}

function GetIt({ page }: { page: ProjectPage }) {
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
      <a className="btn" href={api.downloadUrl(version.id, first.platform)} style={s('width:100%;box-sizing:border-box')}>
        Get it for {SYSTEM_NAME[first.platform]}
      </a>
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
            <a key={b.platform} className="ghost" href={api.downloadUrl(version.id, b.platform)}
              style={{ height: 44, fontSize: 16 }}>
              Get it for {SYSTEM_NAME[b.platform]}
            </a>
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

function Versions({ slug, current }: { slug: string; current: number }) {
  const [rows, setRows] = useState<VersionRow[] | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    setRows(null)
    api.versions(slug).then((r) => setRows(r.versions)).catch(() => setRows([]))
  }, [slug])

  if (!rows || rows.length === 0) return null
  const shown = all ? rows : rows.slice(0, 3)
  const here = thisSystem()

  return (
    <div className="panel" style={s('display:flex;flex-direction:column;gap:0;padding:28px')}>
      <div style={s('display:flex;align-items:baseline;gap:16px;margin-bottom:6px')}>
        <h2 className="h2">Versions</h2>
        {rows.length > 3 && !all ? (
          <button type="button" className="nav" onClick={() => setAll(true)}
            style={s('margin-left:auto;background:none;border:0;padding:0;cursor:pointer')}>
            See all
          </button>
        ) : null}
      </div>
      {shown.map((v) => v.number === current ? (
        <div className="row2" key={v.id} style={{ alignItems: 'flex-start', gap: 12 }}>
          <span style={s('display:flex;flex-direction:column;gap:4px;flex:1')}>
            <span style={s('display:flex;align-items:center;gap:10px')}>
              <span className="h3">Version {v.number}</span>
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
          <span className="h3" style={{ flex: 'none', width: 92 }}>Version {v.number}</span>
          <span style={s('display:flex;flex-direction:column;gap:4px;flex:1')}>
            <span className="body" style={{ color: '#091717' }}>{v.note || (v.number === 1 ? 'First version.' : 'No note was left.')}</span>
            <span className="small">{readableDate(v.created_at)}</span>
          </span>
          {v.systems_ready > 0 ? (
            <a className="nav" href={api.downloadUrl(v.id, here)} style={{ flex: 'none' }}>Get this one</a>
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
        <span className="body" style={{ color: '#091717', flex: 1 }}>Make my own copy</span>
        <button type="button" className="nav" style={link}
          onClick={act(async () => { await api.copy(slug); setSaid('Copied. It is in My things.') })}>
          Copy
        </button>
      </div>
      {said ? <p className="small" role="status" style={{ margin: '10px 0 0' }}>{said}</p> : null}
    </div>
  )
}

export function Project() {
  const { slug = '' } = useParams()
  const [page, setPage] = useState<ProjectPage | null>(null)
  const [error, setError] = useState<ApiError | Error | null>(null)

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
  const systems = builds.filter((b) => b.status === 'ready').map((b) => b.platform)

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

        <div className="grid2">
          <div style={s('display:flex;flex-direction:column;gap:32px')}>
            <div className="panel" style={s('display:flex;flex-direction:column;gap:18px;padding:28px')}>
              <div style={s('display:flex;flex-direction:column;gap:6px')}>
                <h2 className="h2">What it looks like</h2>
                <span className="small">This is the whole thing. There is nothing else to learn.</span>
              </div>
              <KitWindow name={project.name} />
            </div>

            {project.description ? (
              <div className="panel" style={s('display:flex;flex-direction:column;gap:10px;padding:28px')}>
                <h2 className="h2">What it does</h2>
                <p className="body" style={{ margin: 0 }}>{project.description}</p>
              </div>
            ) : null}

            <Touches page={page} />
          </div>

          <div style={s('display:flex;flex-direction:column;gap:32px;position:sticky;top:24px')}>
            <GetIt page={page} />
            <Versions slug={project.slug} current={page.version.number} />
            <Doors page={page} onStars={(stars) => setPage({ ...page, stars })} />
          </div>
        </div>
      </Main>
    </Page>
  )
}

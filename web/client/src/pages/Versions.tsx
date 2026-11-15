import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  api, inWords, readableDate, readableSize, systemsLine, SYSTEM_NAME, thisSystem,
  type Build, type VersionRow,
} from '../api'
import { Avatar, Hero, Main, Page, Plain, Star, Trouble } from '../components/bits'
import {
  Box, CenterHero, Change, CheckRows, Crumbs, Door, Doors, GetItSheet, Item, KitWindow, Meta,
  ORDER, Rows, Tally, TwoUp, useLoad,
} from '../components/kit'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const V: OrbSpec[] = [[0.975, 0.9, 0.078, 'violet'], [0.02, 1.05, 0.108, 'teal']]

function Getting() {
  return <Page current="Browse" orbs={V}><Hero title={<span style={{ color: 'rgba(9,23,23,0.46)' }}>Getting it</span>} /><Main>{null}</Main></Page>
}

function Gone({ message, again }: { message: string; again: () => void }) {
  return <Plain current="Browse" title="That did not work" line="The versions could not be loaded."><Trouble message={message} again={again} /></Plain>
}

/** Which build to offer first: this computer's if there is one, else the first that is ready. */
function firstReady(builds: Build[]): Build | undefined {
  const ready = ORDER.flatMap((p) => builds.filter((b) => b.platform === p && b.status === 'ready'))
  return ready.find((b) => b.platform === thisSystem()) ?? ready[0]
}

/** Opens W8 for any version, asking for its builds first. */
function useSheet(name: string, checkedFor: (id: string) => boolean) {
  const [open, setOpen] = useState<{ id: string; builds: Build[] } | null>(null)
  const get = (id: string) => { void api.version(id).then((d) => setOpen({ id, builds: d.builds })) }
  const sheet = open ? (
    <GetItSheet name={name} versionId={open.id} builds={open.builds}
      start={firstReady(open.builds)?.platform ?? thisSystem()} checked={checkedFor(open.id)}
      onClose={() => setOpen(null)} />
  ) : null
  return { get, sheet }
}

/** V1. Every version, newest first, each one still there to get. */
export function Versions() {
  const { slug = '' } = useParams()
  const { data, error, again } = useLoad(async () => {
    const [page, list] = await Promise.all([api.project(slug), api.versions(slug)])
    return { page, versions: list.versions }
  }, [slug])
  const { get, sheet } = useSheet(data?.page.project.name ?? '', (id) =>
    data?.versions.find((v) => v.id === id)?.check_status === 'passed')

  if (error) return <Gone message={error.message} again={again} />
  if (!data) return <Getting />
  const { page, versions } = data
  const { project, owner } = page
  const oldest = versions[versions.length - 1]
  const n = versions.length

  return (
    <Page current="Browse" orbs={V}>
      <Hero pre={<Crumbs trail={[['Browse', '/'], [project.name, `/p/${slug}`], ['Versions']]} />}
        title={`Versions of ${project.name}`}
        sub={<Meta who={owner.name} facts={[n === 1 ? 'One version so far' : `${inWords(n)} versions since ${oldest ? readableDate(oldest.created_at) : ''}`]} />} />
      <Main>
        <TwoUp
          left={
            <Box title="Every version" note="Newest first. Each one still works, and still downloads.">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
                {versions.map((v: VersionRow, i) => (
                  <div className="prob" key={v.id} style={s('padding:24px 0;gap:24px;flex-wrap:wrap')}>
                    <span style={s('display:flex;flex-direction:column;gap:8px;flex:1;min-width:260px')}>
                      <span style={s('display:flex;align-items:center;gap:12px;flex-wrap:wrap')}>
                        <span className="h3">Version {v.number}</span>
                        {i === 0 ? <span className="chip on" style={s('flex:none;height:30px;padding:0 13px;font-size:14px')}>Now</span> : null}
                      </span>
                      <span className="body" style={{ color: '#091717' }}>{v.note || 'No note was left.'}</span>
                      <span className="small">{readableDate(v.created_at)}{v.systems_ready === 0 ? ', not built yet' : ''}</span>
                      <span className="who small" style={{ marginTop: 2 }}>
                        <Avatar name={v.author_name} size={24} />
                        {v.author_name}{v.suggester_name ? `, with ${v.suggester_name}` : ''}
                      </span>
                    </span>
                    <span style={s('display:flex;flex-direction:column;gap:10px;align-items:flex-start;flex:none')}>
                      {v.systems_ready > 0 ? (
                        <button type="button" className={i === 0 ? 'btn' : 'ghost'} onClick={() => get(v.id)}>Get this one</button>
                      ) : null}
                      <Link className="nav" to={`/p/${slug}/v/${v.number}`} style={{ minHeight: 0 }}>What changed</Link>
                    </span>
                  </div>
                ))}
              </div>
            </Box>
          }
          right={<>
            <Box title="What a version is">
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                <p className="body" style={{ margin: 0, color: '#091717' }}>
                  Every change somebody keeps becomes a version. Nothing is ever edited in place, so nothing you
                  already have can change under you.
                </p>
                <span className="small">That is why the list only grows.</span>
              </div>
            </Box>
            {n > 1 && versions[1] ? (
              <Box title="Still on an older one?">
                <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                  <Link className="ghost" to={`/p/${slug}/v/${versions[1].number}/back`} style={s('width:100%;box-sizing:border-box')}>
                    Go back to an older version
                  </Link>
                  <span className="small">An older one installs beside the one you have. You keep both.</span>
                </div>
              </Box>
            ) : null}
            <Doors>
              <div className="row2" style={{ alignItems: 'center', gap: 12 }}>
                <span style={s('display:flex;align-items:center;gap:7px;color:rgba(9,23,23,0.64)')}><Star />{page.stars}</span>
              </div>
              <Door label="Back to the project"><Link className="nav" to={`/p/${slug}`}>Open</Link></Door>
            </Doors>
          </>}
        />
      </Main>
      {sheet}
    </Page>
  )
}

function useVersion(slug: string, number: number) {
  return useLoad(async () => {
    const [page, list] = await Promise.all([api.project(slug), api.versions(slug)])
    const row = list.versions.find((v) => v.number === number)
    if (!row) throw new Error(`There is no version ${number} of this.`)
    const detail = await api.version(row.id)
    return { page, versions: list.versions, detail }
  }, [slug, number])
}

/** V2. One version: what changed, where it came from, and the way to get it. */
export function Version() {
  const { slug = '', n = '1' } = useParams()
  const number = Number(n)
  const { data, error, again } = useVersion(slug, number)
  const [open, setOpen] = useState(false)

  if (error) return <Gone message={error.message} again={again} />
  if (!data) return <Getting />
  const { page, versions, detail } = data
  const { project } = page
  const { version, builds, check, changes } = detail
  const newest = versions[0]?.number ?? number
  const first = firstReady(builds)
  const others = ORDER.filter((p) => p !== first?.platform && builds.some((b) => b.platform === p && b.status === 'ready'))

  return (
    <Page current="Browse" orbs={V}>
      <Hero pre={<Crumbs trail={[['Browse', '/'], [project.name, `/p/${slug}`], ['Versions', `/p/${slug}/versions`], [`Version ${number}`]]} />}
        title={`Version ${number}`}
        sub={<Meta facts={[readableDate(version.created_at), project.name, number === newest ? 'The newest version' : `The version before version ${number + 1}`]} />} />
      <Main>
        <TwoUp
          left={<>
            <Box title={number === 1 ? 'The first version' : `What changed from version ${number - 1}`}
              note={changes.length > 0 ? 'The same words the person who suggested it wrote.' : undefined}>
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-4px')}>
                {changes.length > 0
                  ? changes.map((c) => <Change key={c.title} title={c.title} before={c.before_text} after={c.after_text} />)
                  : <p className="body" style={{ margin: 0, color: '#091717' }}>{version.note || 'No note was left for this one.'}</p>}
              </div>
            </Box>
            {detail.suggester_name ? (
              <Box title="Where this came from">
                <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
                  <Item title={`${detail.suggester_name} suggested it`} pad="20px 0"
                    body="They made their own copy, changed it, and sent the change back." />
                  <Item title={`${detail.author_name} took it`} pad="20px 0"
                    body={`And made it version ${number} for everyone.`} />
                </div>
              </Box>
            ) : null}
            <Box title="What it looks like" note={`The window people get when they open version ${number}.`}>
              <KitWindow name={project.name} />
            </Box>
            <Box title="What was checked" note="Every version is checked again before anyone can get it.">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-6px')}>
                <CheckRows check={check} builds={builds} />
              </div>
            </Box>
          </>}
          right={<>
            <Box title={`Get version ${number}`}>
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                {first ? (
                  <button type="button" className="btn" onClick={() => setOpen(true)} style={s('width:100%;box-sizing:border-box')}>
                    Get it for {SYSTEM_NAME[first.platform]}
                  </button>
                ) : <span className="body">This version was not built, so there is nothing to get.</span>}
                <span className="small">
                  {[readableDate(version.created_at), readableSize(first?.size_bytes ?? null)].filter(Boolean).join(', ')}.
                  {number === newest ? ' This is the current one.' : ` Version ${newest} is the current one, and this one still downloads.`}
                </span>
                {others.length > 0 ? (
                  <button type="button" className="nav" onClick={() => setOpen(true)} style={{ minHeight: 0, alignSelf: 'flex-start' }}>
                    Also on {systemsLine(others)}
                  </button>
                ) : null}
              </div>
            </Box>
            <Box title="Who made this version">
              <Rows>
                <div className="row2" style={{ alignItems: 'center', gap: 12 }}>
                  <span className="who body" style={{ color: '#091717' }}><Avatar name={detail.author_name} size={24} />{detail.author_name}</span>
                  <span className="small" style={{ marginLeft: 'auto' }}>Made it</span>
                </div>
                {detail.suggester_name ? (
                  <div className="row2" style={{ alignItems: 'center', gap: 12 }}>
                    <span className="who body" style={{ color: '#091717' }}><Avatar name={detail.suggester_name} size={24} />{detail.suggester_name}</span>
                    <span className="small" style={{ marginLeft: 'auto' }}>Suggested the change</span>
                  </div>
                ) : null}
              </Rows>
            </Box>
            <Doors>
              {number > 1 ? (
                <Door label={`Version ${number - 1}, the one before`}><Link className="nav" to={`/p/${slug}/v/${number - 1}`}>See it</Link></Door>
              ) : null}
              {number < newest ? (
                <Door label={`Go back to version ${number}`}><Link className="nav" to={`/p/${slug}/v/${number}/back`}>How</Link></Door>
              ) : null}
              <Door label={versions.length === 1 ? 'The only version' : `All ${inWords(versions.length).toLowerCase()} versions`}>
                <Link className="nav" to={`/p/${slug}/versions`}>See all</Link>
              </Door>
            </Doors>
          </>}
        />
      </Main>
      {open ? (
        <GetItSheet name={project.name} versionId={version.id} builds={builds}
          start={first?.platform ?? thisSystem()} checked={check?.status === 'passed'} onClose={() => setOpen(false)} />
      ) : null}
    </Page>
  )
}

/** V3. Going back to an older one, and what that means. */
export function GoBack() {
  const { slug = '', n = '1' } = useParams()
  const number = Number(n)
  const { data, error, again } = useVersion(slug, number)
  const [open, setOpen] = useState(false)

  if (error) return <Gone message={error.message} again={again} />
  if (!data) return <Getting />
  const { page, versions, detail } = data
  const { project } = page
  const newer = versions.filter((v) => v.number > number)
  const current = versions[0]?.number ?? number
  const first = firstReady(detail.builds)

  return (
    <Page current="Browse" orbs={V}>
      <CenterHero bottom={100}
        pre={<Crumbs trail={[['Browse', '/'], [project.name, `/p/${slug}`], ['Versions', `/p/${slug}/versions`], [`Version ${number}`, `/p/${slug}/v/${number}`]]} />}
        title={`Go back to version ${number}`}
        sub="You can run an older version whenever you want. It installs beside the one you already have." />
      <Main>
        <TwoUp
          left={<>
            <Box title="What you will not have any more" note={`Version ${number} came before these, so it does not do them.`}>
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-4px')}>
                {newer.length === 0
                  ? <p className="body" style={{ margin: 0 }}>Nothing. This is the newest version.</p>
                  : newer.map((v) => <Item key={v.id} pad="20px 0" title={v.note || 'A change with no note.'} body={`Came in version ${v.number}, ${readableDate(v.created_at)}.`} />)}
              </div>
            </Box>
            <Box title="What does not change">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-6px')}>
                <Tally kind="done">Your own files are never touched</Tally>
                <Tally kind="done">Version {current} stays on your computer as well</Tally>
                <Tally kind="done">You can come back to version {current} at any time</Tally>
              </div>
              <p className="small" style={{ margin: 0 }}>Version {number} opens as its own app. Nothing is uninstalled.</p>
            </Box>
          </>}
          right={<>
            <Box title={`Get version ${number}`}>
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                {first ? (
                  <button type="button" className="btn" onClick={() => setOpen(true)} style={s('width:100%;box-sizing:border-box')}>
                    Get version {number} for {SYSTEM_NAME[first.platform]}
                  </button>
                ) : <span className="body">This version was not built, so there is nothing to get.</span>}
                <span className="small">{[readableDate(detail.version.created_at), readableSize(first?.size_bytes ?? null)].filter(Boolean).join(', ')}. Checked the same way every version is.</span>
              </div>
            </Box>
            <div style={s('display:flex;flex-direction:column;gap:12px')}>
              <Link className="ghost" to={`/p/${slug}/versions`} style={s('width:100%;box-sizing:border-box')}>See all versions</Link>
            </div>
          </>}
        />
      </Main>
      {open ? (
        <GetItSheet name={project.name} versionId={detail.version.id} builds={detail.builds}
          start={first?.platform ?? thisSystem()} checked={detail.check?.status === 'passed'} onClose={() => setOpen(false)} />
      ) : null}
    </Page>
  )
}

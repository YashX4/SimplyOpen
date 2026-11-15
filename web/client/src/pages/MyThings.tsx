import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, inWords, readableAgo, SEEN_BY, type MyThings as Things, type SuggestionDetail } from '../api'
import { Avatar, Hero, Main, Page, Plain, refreshSession, Trouble, useSession } from '../components/bits'
import { Box, CenterHero, Column, Door, Doors, Line, Meta, Rows, SignedIn, TwoUp, useLoad } from '../components/kit'
import type { OrbSpec } from '../fx'
import { s } from '../s'

export const M: OrbSpec[] = [[0.975, 0.9, 0.078, 'violet'], [0.02, 1.05, 0.108, 'teal']]

type Filter = 'all' | 'made' | 'copies'

function countLine(made: number, copies: number): string {
  const a = made === 1 ? 'One thing you made' : `${inWords(made)} things you made`
  if (copies === 0) return a
  return `${a}, ${copies === 1 ? 'one copy' : `${inWords(copies).toLowerCase()} copies`}`
}

/** M1 when there is nothing, M2 when there is. */
export function MyThings() {
  return <SignedIn current="My things" orbs={M}><MyThingsPage /></SignedIn>
}

function MyThingsPage() {
  const { me } = useSession()
  const navigate = useNavigate()
  const { data, error, again } = useLoad(() => api.things(), [])
  const [filter, setFilter] = useState<Filter>('all')
  const [waiting, setWaiting] = useState<SuggestionDetail[]>([])

  // The sidebar lists who is waiting, across everything this person made.
  useEffect(() => {
    if (!data) return
    const asks = data.made.filter((m) => m.waiting > 0).map((m) => api.suggestionsFor(m.project.slug))
    void Promise.all(asks).then((all) => {
      setWaiting(all.flatMap((a) => a.suggestions)
        .sort((x, y) => y.suggestion.created_at.localeCompare(x.suggestion.created_at)))
    }).catch(() => setWaiting([]))
  }, [data])

  if (error) return <Plain current="My things" title="My things" line="Your things could not be loaded."><Trouble message={error.message} again={again} /></Plain>
  if (!data || !me) return <Page current="My things" orbs={M}><Hero title="My things" /><Main>{null}</Main></Page>

  if (data.made.length === 0 && data.copies.length === 0) return <Empty />

  const signOut = () => { void api.signOut().then(() => refreshSession()).then(() => navigate('/')) }
  const showMade = filter !== 'copies'
  const showCopies = filter !== 'made'
  // Newest first, so the button opens the inbox of whichever project heard most recently.
  const inbox = waiting[0] ? `/my-things/${waiting[0].project_slug}/suggestions` : '/my-things'

  return (
    <Page current="My things" orbs={M}>
      <Hero pre={<p className="small" style={{ margin: 0 }}>My things</p>} title="My things"
        sub={<Meta who={me.name} facts={[countLine(data.made.length, data.copies.length)]} />} />
      <Main>
        <TwoUp
          left={<div style={s('display:flex;flex-direction:column;gap:20px')}>
            <div style={s('display:flex;flex-wrap:wrap;gap:8px')} role="group" aria-label="Show">
              {([['all', 'All'], ['made', 'Made by you'], ['copies', 'Copies']] as [Filter, string][]).map(([f, label]) => (
                <button key={f} type="button" className={filter === f ? 'chip on' : 'chip'} aria-pressed={filter === f}
                  onClick={() => setFilter(f)}>{label}</button>
              ))}
            </div>
            <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-4px')}>
              {showMade ? data.made.map(({ project, version, waiting: n, stars }) => (
                <div className="prob" key={project.id} style={s('padding:24px 0;gap:24px;flex-wrap:wrap')}>
                  <span style={s('display:flex;flex-direction:column;gap:8px;flex:1;min-width:250px')}>
                    <span style={s('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
                      <span className="h3">{project.name}</span>
                      {n > 0 ? <span className="badge" style={{ marginLeft: 0 }} aria-label={`${n} suggestions waiting`}>{n}</span> : null}
                    </span>
                    <span className="body" style={{ color: '#091717' }}>{project.description || 'No description yet.'}</span>
                    <span className="small">
                      Version {version?.number ?? 1}, {SEEN_BY[project.visibility]}{stars > 0 ? `, ${stars} ${stars === 1 ? 'star' : 'stars'}` : ''}
                    </span>
                  </span>
                  <span style={s('display:flex;flex-direction:column;gap:10px;align-items:flex-start;flex:none')}>
                    <Link className="ghost" to={`/my-things/${project.slug}`}>Open</Link>
                    {project.visibility === 'private'
                      ? <Link className="nav" to={`/publish/${project.slug}`} style={{ minHeight: 0 }}>Share it</Link>
                      : <Link className="nav" to={`/p/${project.slug}`} style={{ minHeight: 0 }}>See its page</Link>}
                  </span>
                </div>
              )) : null}
              {showCopies ? data.copies.map(({ copy, project, from_version }) => (
                <div className="prob" key={copy.id} style={s('padding:24px 0;gap:24px;flex-wrap:wrap')}>
                  <span style={s('display:flex;flex-direction:column;gap:8px;flex:1;min-width:250px')}>
                    <span className="h3">{project ? `${project.name}, your copy` : copy.name}</span>
                    <span className="body" style={{ color: '#091717' }}>
                      Your own copy, taken from version {from_version?.number ?? 1}.
                    </span>
                    <span className="small">Copied {readableAgo(copy.created_at).toLowerCase()}, not sent back</span>
                  </span>
                  <span style={s('display:flex;flex-direction:column;gap:10px;align-items:flex-start;flex:none')}>
                    <Link className="ghost" to={`/copies/${copy.id}`}>Open</Link>
                    <Link className="nav" to={`/copies/${copy.id}/change`} style={{ minHeight: 0 }}>Change it</Link>
                  </span>
                </div>
              )) : null}
              {showMade && data.made.length === 0 ? <p className="body" style={{ padding: '24px 0', margin: 0 }}>You have not shared anything yet.</p> : null}
              {showCopies && data.copies.length === 0 && filter === 'copies' ? <p className="body" style={{ padding: '24px 0', margin: 0 }}>You have not copied anything yet.</p> : null}
            </div>
          </div>}
          right={<>
            {waiting.length > 0 ? (
              <Box title="Waiting for you">
                <Rows>
                  {waiting.slice(0, 4).map((w) => (
                    <div className="row2" key={w.suggestion.id} style={{ alignItems: 'center', gap: 12 }}>
                      <span className="body" style={{ color: '#091717' }}>
                        <Link className="who" to={`/suggestions/${w.suggestion.id}`} style={{ textDecoration: 'none' }}>
                          <Avatar name={w.author_name} size={24} />{w.author_name.split(/\s+/)[0]}
                        </Link>
                      </span>
                      <span className="small" style={{ marginLeft: 'auto' }}>{readableAgo(w.suggestion.created_at)}</span>
                    </div>
                  ))}
                </Rows>
                <Link className="btn" to={inbox} style={s('width:100%;box-sizing:border-box')}>
                  {waiting.length === 1 ? 'Look at it' : `See all ${inWords(waiting.length).toLowerCase()}`}
                </Link>
              </Box>
            ) : null}
            <Box title="Made something new?">
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                <Link className="ghost" to="/publish" style={s('width:100%;box-sizing:border-box')}>Share something you made</Link>
                <span className="small">Nothing goes live until you say so.</span>
              </div>
            </Box>
            <Doors>
              <Door label={me.email}><span className="small">Signed in</span></Door>
              <Door label="Sign out of this computer" muted>
                <button type="button" className="nav" onClick={signOut}>Sign out</button>
              </Door>
            </Doors>
          </>}
        />
      </Main>
    </Page>
  )
}

/** M1. Nothing yet, and the two ways to change that. */
function Empty() {
  return (
    <Page current="My things" orbs={M}>
      <CenterHero title="Nothing here yet" bottom={100}
        sub="This is where the things you make, and the copies you keep, will live." />
      <Main>
        <Column>
          <div className="grid2">
            <Box title="Made something?">
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                <p className="body" style={{ margin: 0, color: '#091717' }}>
                  Drop in a script, a notebook, or a folder of files. You get back an app that anyone can open,
                  with no terminal and nothing to install first.
                </p>
                <Link className="btn" to="/publish" style={s('width:100%;box-sizing:border-box')}>Share something you made</Link>
              </div>
            </Box>
            <Box title="Looking for something?">
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                <p className="body" style={{ margin: 0, color: '#091717' }}>
                  People have shared converters, cleaners, renamers and sorters. Every one of them runs on your
                  own computer, not on a website.
                </p>
                <Link className="ghost" to="/" style={s('width:100%;box-sizing:border-box')}>Browse what people made</Link>
              </div>
            </Box>
          </div>
          <Box title="What ends up here">
            <Rows>
              <Line left="Things you made" right="Every version, and what people suggest" />
              <Line left="Copies you made" right="Your own version of someone else’s thing" />
            </Rows>
          </Box>
        </Column>
      </Main>
    </Page>
  )
}

export type { Things }

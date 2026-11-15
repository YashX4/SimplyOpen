import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, inWords, readableAgo, readableDate, type Visibility } from '../api'
import { Avatar, Hero, Main, Page, Plain, Star, Trouble } from '../components/bits'
import { Box, Crumbs, Door, Doors, Line, Meta, Rows, SignedIn, TwoUp, useLoad } from '../components/kit'
import { M } from './MyThings'
import { s } from '../s'

const WHO: [Visibility, string, string][] = [
  ['private', 'Only me', 'Nobody else can find it or open it.'],
  ['link', 'Anyone with the link', 'Not shown in browse. You choose who to send it to.'],
  ['public', 'Everyone', 'Shown in browse, where anyone can find it.'],
]

const SEEN: Record<Visibility, string> = {
  private: 'Only you can see it',
  link: 'Anyone with the link',
  public: 'Anyone can find it',
}

/** M3. One thing you made, from the side only you see. */
export function Manage() {
  return <SignedIn current="My things" orbs={M}><ManagePage /></SignedIn>
}

function ManagePage() {
  const { slug = '' } = useParams()
  const { data, error, again, set } = useLoad(async () => {
    const [page, versions, inbox] = await Promise.all([
      api.project(slug),
      api.versions(slug),
      api.suggestionsFor(slug).catch(() => ({ suggestions: [] })),
    ])
    return { page, versions: versions.versions, waiting: inbox.suggestions }
  }, [slug])
  const [saving, setSaving] = useState(false)

  if (error) return <Plain current="My things" title="That did not work" line="This project could not be loaded."><Trouble message={error.message} again={again} /></Plain>
  if (!data) return <Page current="My things" orbs={M}><Hero title={<span style={{ color: 'rgba(9,23,23,0.46)' }}>Getting it</span>} /><Main>{null}</Main></Page>

  const { page, versions, waiting } = data
  if (!page.can_edit) {
    return <Plain current="My things" title="This is not yours" line="Only the person who made it can see this side of it."><div className="col"><Link className="btn" to={`/p/${slug}`}>See its page</Link></div></Plain>
  }
  const { project, version } = page
  const oldest = versions[versions.length - 1]
  const show = (v: Visibility) => {
    setSaving(true)
    api.show(slug, v)
      .then(() => set({ ...data, page: { ...page, project: { ...project, visibility: v } } }))
      .finally(() => setSaving(false))
  }

  return (
    <Page current="My things" orbs={M}>
      <Hero pre={<Crumbs trail={[['My things', '/my-things'], [project.name]]} />} title={project.name}
        sub={<Meta facts={['Made by you', `Version ${version.number}`, SEEN[project.visibility]]} />} />
      <Main>
        <TwoUp
          left={<>
            <Box title={waiting.length === 0 ? 'No suggestions waiting' : `${inWords(waiting.length)} ${waiting.length === 1 ? 'suggestion' : 'suggestions'} waiting`}
              note="People who made a copy and changed something.">
              {waiting.length === 0 ? (
                <p className="body" style={{ margin: '-4px 0 0' }}>When somebody offers you a change, it shows up here. Nothing changes until you take it.</p>
              ) : (
                <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-4px')}>
                  {waiting.map((w) => (
                    <div className="prob" key={w.suggestion.id} style={s('padding:22px 0;gap:24px;flex-wrap:wrap')}>
                      <span style={s('display:flex;flex-direction:column;gap:8px;flex:1;min-width:250px')}>
                        <span className="who small">
                          <Avatar name={w.author_name} size={24} />{w.author_name}
                          <span style={{ color: 'rgba(9,23,23,0.46)' }}>/</span>{readableAgo(w.suggestion.created_at)}
                        </span>
                        <span className="body" style={{ color: '#091717' }}>{w.suggestion.note || w.changes[0]?.title}</span>
                      </span>
                      <Link className="ghost" to={`/suggestions/${w.suggestion.id}`} style={{ flex: 'none' }}>Look at it</Link>
                    </div>
                  ))}
                </div>
              )}
            </Box>
            <Box title="Versions">
              <Rows>
                <Line left={`Version ${version.number}, the one people get`} right={readableDate(version.created_at)} />
                {versions.length > 1 && oldest ? (
                  <Line left={`${inWords(versions.length - 1)} ${versions.length === 2 ? 'version' : 'versions'} before it`}
                    right={`Back to ${readableDate(oldest.created_at)}`} />
                ) : null}
              </Rows>
              <Link className="nav" to={`/p/${slug}/versions`} style={{ minHeight: 0 }}>See all versions</Link>
            </Box>
            <Box title="How it is doing">
              <Rows>
                <Line left={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Star />Stars</span>} right={String(page.stars)} />
                <Line left="Copies people made of it" right={String(page.copies)} />
              </Rows>
              <p className="small" style={{ margin: 0 }}>You cannot see who they are, or anything they ran. Nobody can see that about you either.</p>
            </Box>
          </>}
          right={<>
            <div className="panel" style={s('display:flex;flex-direction:column;gap:6px;padding:28px')}>
              <h2 className="h2" style={{ marginBottom: 10 }}>Who can see it</h2>
              <div role="radiogroup" aria-label="Who can see it" aria-busy={saving}>
                {WHO.map(([value, title, note]) => (
                  <label className="opt" style={{ position: 'relative' }} key={value}>
                    <input type="radio" className="r" name="who" checked={project.visibility === value}
                      disabled={saving} onChange={() => show(value)} />
                    <span className="dot" aria-hidden="true" />
                    <span style={s('display:flex;flex-direction:column;gap:3px')}>
                      <span className="h3">{title}</span>
                      <span className="small">{note}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="small" style={{ margin: '10px 0 0' }}>This changes straight away.</p>
            </div>
            <Doors>
              <Door label="Open the page people see"><Link className="nav" to={`/p/${slug}`}>Open</Link></Door>
              <Door label="Check it over again"><Link className="nav" to={`/publish/${slug}`}>Check</Link></Door>
              <Door label="How the builds went"><Link className="nav" to={`/publish/${slug}/ready`}>See</Link></Door>
              {project.visibility !== 'private' ? (
                <Door label="Take it down" muted>
                  <button type="button" className="nav" onClick={() => show('private')}>Take down</button>
                </Door>
              ) : null}
            </Doors>
          </>}
        />
      </Main>
    </Page>
  )
}

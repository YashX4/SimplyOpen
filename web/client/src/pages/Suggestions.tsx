import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, inWords, readableAgo, readableDate, type SuggestionDetail } from '../api'
import { Avatar, Hero, Main, Page, Plain, refreshSession, Trouble, useSession } from '../components/bits'
import {
  Box, CenterHero, Change, Column, Crumbs, Done, Item, Meta, SignedIn, TwoUp, useLoad,
} from '../components/kit'
import { M } from './MyThings'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const Y6: OrbSpec[] = [[0.975, 0.88, 0.08, 'teal'], [0.02, 1.05, 0.108, 'violet']]

const first = (name: string) => name.split(/\s+/)[0] ?? name

function Getting() {
  return <Page current="My things" orbs={M}><Hero title={<span style={{ color: 'rgba(9,23,23,0.46)' }}>Getting it</span>} /><Main>{null}</Main></Page>
}

/** M4. Everything waiting on one project, newest first. */
export function Inbox() {
  return <SignedIn current="My things" orbs={M}><InboxPage /></SignedIn>
}

function InboxPage() {
  const { slug = '' } = useParams()
  const { data, error, again } = useLoad(async () => {
    const [page, inbox] = await Promise.all([api.project(slug), api.suggestionsFor(slug)])
    return { page, waiting: inbox.suggestions }
  }, [slug])

  if (error) return <Plain current="My things" title="That did not work" line="The suggestions could not be loaded."><Trouble message={error.message} again={again} /></Plain>
  if (!data) return <Getting />
  const { page, waiting } = data
  const n = waiting.length

  return (
    <Page current="My things" orbs={M}>
      <Hero pre={<Crumbs trail={[['My things', '/my-things'], [page.project.name, `/my-things/${slug}`], ['Suggestions']]} />}
        title={n === 0 ? 'Nothing waiting' : 'Suggestions waiting'}
        sub={<p className="small" style={{ margin: 0 }}>{n === 0 ? `Nothing on ${page.project.name} right now` : `${inWords(n)}, all on ${page.project.name}`}</p>} />
      <Main>
        <TwoUp
          left={
            <Box title={n === 0 ? 'Nobody has sent one yet' : `${inWords(n)} waiting`}
              note={n === 0 ? 'When someone copies it, changes it and offers the change back, it lands here.' : 'Newest first. Looking at one does not accept it.'}>
              {n > 0 ? (
                <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-4px')}>
                  {waiting.map((w) => (
                    <div className="prob" key={w.suggestion.id} style={s('padding:22px 0;gap:24px;flex-wrap:wrap')}>
                      <span style={s('display:flex;flex-direction:column;gap:8px;flex:1;min-width:250px')}>
                        <span className="who small">
                          <Avatar name={w.author_name} size={24} />{w.author_name}
                          <span style={{ color: 'rgba(9,23,23,0.46)' }}>/</span>{readableAgo(w.suggestion.created_at)}
                        </span>
                        <span className="body" style={{ color: '#091717' }}>{w.suggestion.note || w.changes.map((c) => c.title).join(' ')}</span>
                      </span>
                      <Link className="ghost" to={`/suggestions/${w.suggestion.id}`} style={{ flex: 'none' }}>Look at it</Link>
                    </div>
                  ))}
                </div>
              ) : null}
            </Box>
          }
          right={
            <Box title="Where these come from">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-6px')}>
                <Item kind={1} pad="18px 0" title="Somebody made a copy" body="They changed it for their own work." />
                <Item kind={2} pad="18px 0" title="It worked for them" body="So they offered the change back to you." />
                <Item kind={3} pad="18px 0" title="You decide" body="Take it, or leave it." />
              </div>
              <p className="small" style={{ margin: 0 }}>Nothing here expires, and nobody is waiting on a clock. Leaving one for a month costs you nothing.</p>
            </Box>
          }
        />
      </Main>
    </Page>
  )
}

function useSuggestion(id: string) {
  return useLoad(async () => {
    const detail = await api.suggestion(id)
    const page = await api.project(detail.project_slug)
    return { detail, page }
  }, [id])
}

const ENDED: Record<Exclude<SuggestionDetail['suggestion']['state'], 'waiting'>, string> = {
  taken: 'This one was taken.',
  left: 'This one was left.',
  withdrawn: 'The person who sent this pulled it back.',
}

/** Y4. One suggestion, in plain words, with the decision beside it. */
export function Suggestion() {
  return <SignedIn current="My things" orbs={M}><SuggestionPage /></SignedIn>
}

function SuggestionPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { me } = useSession()
  const { data, error, again } = useSuggestion(id)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  if (error) return <Plain current="My things" title="That did not work" line="This suggestion could not be loaded."><Trouble message={error.message} again={again} /></Plain>
  if (!data) return <Getting />
  const { detail, page } = data
  const { suggestion, changes, author_name: author } = detail
  const maker = page.can_edit
  const mine = me?.id === suggestion.author
  const slug = page.project.slug

  const leave = () => {
    setBusy(true)
    api.leave(suggestion.id)
      .then(() => refreshSession())
      .then(() => navigate(maker ? `/my-things/${slug}/suggestions` : '/my-things'))
      .catch((e: Error) => { setSaid(e.message); setBusy(false) })
  }

  return (
    <Page current="My things" orbs={M}>
      <Hero
        pre={<Crumbs trail={[['My things', '/my-things'], [page.project.name, maker ? `/my-things/${slug}` : `/p/${slug}`], ['Suggestions', maker ? `/my-things/${slug}/suggestions` : undefined]]} />}
        title={mine ? 'Your suggestion' : `A suggestion from ${first(author)}`}
        sub={<Meta who={author} facts={[readableAgo(suggestion.created_at), `about ${page.project.name}`]} />} />
      <Main>
        <TwoUp
          left={<>
            {suggestion.note ? (
              <Box title={mine ? 'What you said' : `What ${first(author)} says`}>
                <div style={s('display:flex;flex-direction:column;gap:16px;margin-top:-4px')}>
                  <p style={s('margin:0;font-size:18px;line-height:1.4;color:#091717')}>{suggestion.note}</p>
                  <span className="who small"><Avatar name={author} size={24} />{author}, who uses this</span>
                </div>
              </Box>
            ) : null}
            <Box title="What would change" note={mine ? 'The same words the maker reads.' : `${first(author)}’s words and yours are the same words. Nothing is hidden in here.`}>
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-4px')}>
                {changes.filter((c) => c.included).map((c) => (
                  <Change key={c.id} title={c.title} before={c.before_text} after={c.after_text} />
                ))}
              </div>
              <p className="small" style={{ margin: 0 }}>Nothing else moved. Everything not listed here works the way it does now.</p>
            </Box>
          </>}
          right={<>
            {suggestion.state !== 'waiting' ? (
              <Box title="Already decided">
                <p className="body" style={{ margin: '-4px 0 0' }}>{ENDED[suggestion.state]}</p>
                {suggestion.state === 'taken' ? <Link className="ghost" to={`/p/${slug}/versions`} style={s('width:100%;box-sizing:border-box')}>See the versions</Link> : null}
              </Box>
            ) : maker ? (
              <Box title="Decide">
                <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                  <Link className="btn" to={`/suggestions/${suggestion.id}/take`} style={s('width:100%;box-sizing:border-box')}>Take it</Link>
                  <span className="small">Taking it makes version {page.version.number + 1}, for everyone. There is no deadline on this.</span>
                  <div className="door" style={{ paddingTop: 16 }}>
                    <button type="button" className="nav" disabled={busy} onClick={leave} style={{ minHeight: 0 }}>Leave it</button>
                    <span className="small" style={{ marginLeft: 'auto' }}>{first(author)} is told, kindly</span>
                  </div>
                  {said ? <span className="small" role="alert" style={{ color: '#b4563c' }}>{said}</span> : null}
                </div>
              </Box>
            ) : mine ? (
              <Box title="Waiting for an answer">
                <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                  <p className="body" style={{ margin: 0, color: '#091717' }}>The maker has not decided yet. There is no deadline, and your copy keeps working either way.</p>
                  <button type="button" className="ghost" disabled={busy} onClick={leave} style={s('width:100%;box-sizing:border-box')}>Pull it back</button>
                </div>
              </Box>
            ) : null}
            <Box title={`About ${first(author)}`}>
              <div style={s('display:flex;flex-direction:column;gap:12px;margin-top:-4px')}>
                <span className="who body" style={{ color: '#091717' }}><Avatar name={author} size={24} />{author}</span>
                <span className="small">Made a copy of {page.project.name} and changed it, then sent this on {readableDate(suggestion.created_at)}.</span>
              </div>
            </Box>
          </>}
        />
      </Main>
    </Page>
  )
}

/** Y5, then Y6. Write what people will read, press the button, see it out. */
export function TakeIt() {
  return <SignedIn current="My things" orbs={M}><TakeItPage /></SignedIn>
}

function TakeItPage() {
  const { id = '' } = useParams()
  const { me } = useSession()
  const { data, error, again } = useSuggestion(id)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [out, setOut] = useState<{ number: number; note: string } | null>(null)

  useEffect(() => {
    // What changed, not why they wanted it: the note is to the maker, this is for everyone.
    if (data) {
      const titles = data.detail.changes.filter((c) => c.included).map((c) => c.title.replace(/[.?!]*$/, '.'))
      setNote(titles.join(' ') || data.detail.suggestion.note)
    }
  }, [data])

  if (error) return <Plain current="My things" title="That did not work" line="This suggestion could not be loaded."><Trouble message={error.message} again={again} /></Plain>
  if (!data || !me) return <Getting />
  const { detail, page } = data
  const author = detail.author_name
  const slug = page.project.slug
  const next = page.version.number + 1

  if (out) {
    return (
      <Page current="My things" orbs={Y6}>
        <CenterHero
          pre={<Crumbs trail={[['My things', '/my-things'], [page.project.name, `/my-things/${slug}`], ['Versions']]} />}
          title={<><Done />Version {out.number} is out</>}
          sub={`It is the newest version of ${page.project.name} now, with ${first(author)}’s change in it.`} />
        <Main>
          <Column>
            <Box title="What people will read">
              <div style={s('display:flex;flex-direction:column;gap:16px;margin-top:-4px')}>
                <div style={s('display:flex;align-items:center;gap:12px;flex-wrap:wrap')}>
                  <span className="h3">Version {out.number}</span>
                  <span className="chip on" style={s('height:30px;padding:0 13px;font-size:14px')}>Now</span>
                  <span className="small">{readableDate(new Date().toISOString())}</span>
                </div>
                <p style={s('margin:0;font-size:18px;line-height:1.4;color:#091717')}>{out.note}</p>
                <div className="door" style={{ paddingTop: 18, gap: 12 }}>
                  <span className="who small"><Avatar name={me.name} size={24} />{me.name}</span>
                  <span className="who small"><Avatar name={author} size={24} />with {author}</span>
                </div>
              </div>
            </Box>
            <div style={s('display:flex;flex-wrap:wrap;gap:14px')}>
              <Link className="btn" to={`/p/${slug}`}>See your project page</Link>
              <Link className="ghost" to="/my-things">Back to My things</Link>
            </div>
          </Column>
        </Main>
      </Page>
    )
  }

  if (detail.suggestion.state !== 'waiting' || !page.can_edit) {
    return <Plain current="My things" title="This one cannot be taken" line={detail.suggestion.state !== 'waiting' ? ENDED[detail.suggestion.state] : 'Only the person who made it can take a suggestion.'}><div className="col"><Link className="btn" to="/my-things">Back to My things</Link></div></Plain>
  }

  const take = () => {
    setBusy(true)
    setSaid(null)
    api.take(detail.suggestion.id, note.trim())
      .then((r) => { setOut({ number: r.version.number, note: r.version.note }); void refreshSession() })
      .catch((e: Error) => { setSaid(e.message); setBusy(false) })
  }

  return (
    <Page current="My things" orbs={M}>
      <CenterHero bottom={100}
        pre={<Crumbs trail={[['My things', '/my-things'], [page.project.name, `/my-things/${slug}`], ['Suggestions', `/suggestions/${detail.suggestion.id}`], ['Take it']]} />}
        title={`Make this version ${next}`}
        sub={`Everyone who opens ${page.project.name} from now on sees ${first(author)}’s change as the newest version.`} />
      <Main>
        <TwoUp
          left={<>
            <Box title="What everyone will get">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
                {detail.changes.filter((c) => c.included).map((c) => (
                  <Change key={c.id} title={c.title} before={c.before_text} after={c.after_text} />
                ))}
              </div>
            </Box>
            <Box title="Tell people what changed">
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                <label className="fld">
                  <span className="lab">This shows up next to Version {next}</span>
                  <textarea className="inp" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <span className="small">We wrote this from the change itself. Say it however you would say it.</span>
              </div>
            </Box>
          </>}
          right={<>
            <Box title="Who gets credit">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
                <div className="row2" style={{ alignItems: 'center', gap: 12 }}>
                  <span className="who body" style={{ color: '#091717' }}><Avatar name={me.name} size={24} />{me.name}</span>
                  <span className="small" style={{ marginLeft: 'auto' }}>Made it</span>
                </div>
                <div className="row2" style={{ alignItems: 'center', gap: 12 }}>
                  <span className="who body" style={{ color: '#091717' }}><Avatar name={author} size={24} />{author}</span>
                  <span className="small" style={{ marginLeft: 'auto' }}>Suggested this change</span>
                </div>
              </div>
              <p className="small" style={{ margin: 0 }}>Both names go on version {next} and stay there.</p>
            </Box>
            <Box title="What happens when you press it">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-6px')}>
                <Item kind={1} pad="18px 0" title={`It becomes version ${next}`} body="The newest version, shown first on its page." />
                <Item kind={2} pad="18px 0" title={`${first(author)} is told`} body="They can see their change went in, with their name on it." />
                <Item kind={3} pad="18px 0" title="Nothing breaks for anyone" body={`Version ${page.version.number} keeps working. Nobody has to update to carry on.`} />
              </div>
            </Box>
            <div style={s('display:flex;flex-direction:column;gap:12px')}>
              {said ? <span className="small" role="alert" style={{ color: '#b4563c' }}>{said}</span> : null}
              <button type="button" className="btn" disabled={busy || !note.trim()} onClick={take} style={s('width:100%;box-sizing:border-box')}>
                Make it version {next}
              </button>
              <Link className="ghost" to={`/suggestions/${detail.suggestion.id}`} style={s('width:100%;box-sizing:border-box')}>Not yet</Link>
            </div>
          </>}
        />
      </Main>
    </Page>
  )
}

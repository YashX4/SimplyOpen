import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, readableAgo, readableDate, type ChatVersion, type CopyDetail } from '../api'
import { Avatar, Hero, Main, Page, Plain, refreshSession, Trouble, useSession } from '../components/bits'
import {
  Box, CenterHero, Column, Crumbs, Done, Door, Doors, Item, KitWindow, Meta, SignedIn, TwoUp, useLoad,
} from '../components/kit'
import { keptChanges, plain } from './Chat'
import { M } from './MyThings'
import { s } from '../s'

const first = (name: string) => name.split(/\s+/)[0] ?? name
const STATE: Record<CopyDetail['suggestions'][number]['state'], string> = {
  waiting: 'Waiting for an answer',
  taken: 'Taken. It is in a version now, with your name on it',
  left: 'Left, kindly',
  withdrawn: 'You pulled it back',
}

/** Y1. What a copy means, and the first thing it should do differently. */
export function MakeCopy() {
  return <SignedIn current="Browse" orbs={M}><MakeCopyPage /></SignedIn>
}

function MakeCopyPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { data: page, error, again } = useLoad(() => api.project(slug), [slug])
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  if (error) return <Plain current="Browse" title="That did not work" line="This project could not be loaded."><Trouble message={error.message} again={again} /></Plain>
  if (!page) return <Page current="Browse" orbs={M}><CenterHero title="Make your own copy" /><Main>{null}</Main></Page>
  const maker = first(page.owner.name)

  const make = () => {
    setBusy(true)
    setSaid(null)
    api.copy(slug)
      .then((r) => navigate(`/copies/${r.copy.id}/change`, { state: ask.trim() ? { ask: ask.trim() } : null }))
      .catch((e: Error) => { setSaid(e.message); setBusy(false) })
  }

  return (
    <Page current="Browse" orbs={M}>
      <CenterHero bottom={100}
        pre={<Crumbs trail={[['Browse', '/'], [page.project.name, `/p/${slug}`], ['Make a copy']]} />}
        title="Make your own copy"
        sub="You get your own version to change however you like. The one everyone else downloads stays exactly as it is." />
      <Main>
        <TwoUp
          left={
            <Box title="What a copy means" note="Four things, and then you are done reading.">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-4px')}>
                <Item pad="20px 0" title="It is yours." body="Your copy sits in My things. Nobody else can see it until you say so." />
                <Item pad="20px 0" title="Theirs does not change." body="Nothing you do in here touches the version other people download." />
                <Item pad="20px 0" title="You change it by chatting." body="Say what you want it to do differently, in your own words. You never have to read the code." />
                <Item pad="20px 0" title="You can offer a change back."
                  body={`If your change would help everyone, you can send it to ${maker}. That is your choice, not a step you owe anyone.`} />
              </div>
              <p className="small" style={{ margin: 0 }}>{maker} made the original. Their name stays on it, and on anything you make from it.</p>
            </Box>
          }
          right={<>
            <Box title="Copying from">
              <div style={s('display:flex;flex-direction:column;gap:10px;margin-top:-4px')}>
                <span className="h3">{page.project.name}</span>
                <span className="body">{page.project.description}</span>
                <span style={s('display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:4px')}>
                  <span className="who small"><Avatar name={page.owner.name} size={24} />{maker} made this</span>
                  <span className="chip on" style={s('height:28px;padding:0 12px;font-size:14px')}>Version {page.version.number}</span>
                  <span className="small">{readableDate(page.version.created_at)}</span>
                </span>
              </div>
            </Box>
            <Box title="What should your copy do differently?">
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                <label className="fld">
                  <span className="lab">In your own words</span>
                  <textarea className="inp" rows={4} value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={4000}
                    placeholder="It would be perfect if it also saved a plain spreadsheet I could open in Excel." />
                </label>
                <span className="small">You can leave this blank and work it out in the chat.</span>
                {said ? <span className="small" role="alert" style={{ color: '#b4563c' }}>{said}</span> : null}
                <button type="button" className="btn" disabled={busy} onClick={make} style={s('width:100%;box-sizing:border-box')}>
                  {busy ? 'Making it' : 'Make my copy'}
                </button>
                <span className="small">Nothing is shared with anyone.</span>
              </div>
            </Box>
          </>}
        />
      </Main>
    </Page>
  )
}

/** Y2. Your copy: what it is, what you sent from it, and where to go next. */
export function YourCopy() {
  return <SignedIn current="My things" orbs={M}><YourCopyPage /></SignedIn>
}

function YourCopyPage() {
  const { id = '' } = useParams()
  const { me } = useSession()
  const { data, error, again } = useLoad(() => api.copyOf(id), [id])

  if (error) return <Plain current="My things" title="That did not work" line="This copy could not be loaded."><Trouble message={error.message} again={again} /></Plain>
  if (!data || !me) return <Page current="My things" orbs={M}><Hero title="Your copy" /><Main>{null}</Main></Page>
  const { copy, project, from_version: from, suggestions } = data
  const name = project?.name ?? copy.name
  const maker = first(project?.maker ?? '')

  return (
    <Page current="My things" orbs={M}>
      <Hero pre={<Crumbs trail={[['My things', '/my-things'], [`Your copy of ${name}`]]} />}
        title={`Your copy of ${name}`}
        sub={<Meta who={me.name} facts={['Your copy', `Started from ${maker ? `${maker}’s` : 'their'} version ${from?.number ?? 1}`]} />} />
      <Main>
        <TwoUp
          left={<>
            <Box title="What it looks like now" note={copy.changed ? 'Your copy, with the changes you kept.' : 'Exactly like the original, until you change it.'}>
              <KitWindow name={name} />
            </Box>
            {suggestions.length > 0 ? (
              <Box title="What you sent back">
                <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
                  {suggestions.map((x) => (
                    <div className="prob" key={x.id} style={s('padding:20px 0;gap:24px;flex-wrap:wrap')}>
                      <span style={s('display:flex;flex-direction:column;gap:6px;flex:1;min-width:230px')}>
                        <span className="h3">{STATE[x.state]}</span>
                        <span className="body">{x.note || 'No note.'}</span>
                        <span className="small">Sent {readableAgo(x.created_at).toLowerCase()}</span>
                      </span>
                      <Link className="ghost" to={`/suggestions/${x.id}`} style={{ flex: 'none' }}>See it</Link>
                    </div>
                  ))}
                </div>
              </Box>
            ) : null}
          </>}
          right={<>
            <Box title={copy.changed ? 'Change it more' : 'Make it yours'}>
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                <Link className="btn" to={`/copies/${copy.id}/change`} style={s('width:100%;box-sizing:border-box')}>Change it by chatting</Link>
                <span className="small">Say what you want it to do differently. You never have to read the code.</span>
              </div>
            </Box>
            {copy.changed ? (
              <Box title="Think everyone should have this?">
                <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                  <Link className="ghost" to={`/copies/${copy.id}/suggest`} style={s('width:100%;box-sizing:border-box')}>Suggest it{maker ? ` to ${maker}` : ''}</Link>
                  <span className="small">{maker || 'They'} can take it or leave it. Your copy keeps working either way.</span>
                </div>
              </Box>
            ) : null}
            <Doors>
              {project ? <Door label="The original"><Link className="nav" to={`/p/${project.slug}`}>See it</Link></Door> : null}
              <Door label="Copied"><span className="small">{readableDate(copy.created_at)}</span></Door>
            </Doors>
          </>}
        />
      </Main>
    </Page>
  )
}

/** Y3, then Y3b. Pick what to send, say why, and send it. */
export function SuggestBack() {
  return <SignedIn current="My things" orbs={M}><SuggestBackPage /></SignedIn>
}

function SuggestBackPage() {
  const { id = '' } = useParams()
  const { me } = useSession()
  const [detail, setDetail] = useState<CopyDetail | null>(null)
  const [changes, setChanges] = useState<ChatVersion[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [own, setOwn] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [sent, setSent] = useState<{ titles: string[]; note: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.copyOf(id).then(async (d) => {
      setDetail(d)
      if (d.chat) {
        const c = await api.chat(d.chat.id).catch(() => null)
        const kept = c ? keptChanges(c.versions) : []
        setChanges(kept)
        setPicked(new Set(kept.map((v) => v.number)))
      }
    }).catch((e: Error) => setError(e.message))
  }, [id])

  if (error) return <Plain current="My things" title="That did not work" line="This copy could not be loaded."><Trouble message={error} /></Plain>
  if (!detail || !me) return <Page current="My things" orbs={M}><CenterHero title="Send your change" /><Main>{null}</Main></Page>
  const maker = first(detail.project?.maker ?? '') || 'them'
  const projectName = detail.project?.name ?? detail.copy.name

  if (sent) {
    return (
      <Page current="My things" orbs={M}>
        <CenterHero title={<><Done />Your suggestion is with {maker}</>}
          sub="They have your change and your note. Nothing about your own copy changed." />
        <Main>
          <Column>
            <Box title="What you sent">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
                {sent.titles.map((t) => <Item key={t} pad="20px 0" title={t} />)}
              </div>
              {sent.note ? <p style={s('margin:0;font-size:18px;line-height:1.4;color:#091717')}>{sent.note}</p> : null}
              <span className="who small"><Avatar name={detail.project?.maker ?? maker} size={24} />Sent to {detail.project?.maker ?? maker}, a moment ago</span>
            </Box>
            <div style={s('display:flex;flex-wrap:wrap;gap:14px')}>
              <Link className="btn" to={`/copies/${id}`}>Back to your copy</Link>
              {detail.project ? <Link className="ghost" to={`/p/${detail.project.slug}`}>See their project page</Link> : null}
            </div>
            <Box title={<span style={{ display: 'block', marginBottom: 10 }}>What next</span>} gap={0}>
              <Item pad="20px 0" title={`You do not have to wait for ${maker}`} body="Your copy already does this. Use it today, whatever they decide." />
              <Item pad="20px 0" title={`If ${maker} takes it`} body="It becomes the next version for everyone, with your name on it. Your copy stays yours either way." />
            </Box>
          </Column>
        </Main>
      </Page>
    )
  }

  const titles = [
    ...changes.filter((v) => picked.has(v.number)).map((v) => plain(v.label)),
    ...(own.trim() ? [own.trim()] : []),
  ]

  const send = async () => {
    setBusy(true)
    setSaid(null)
    try {
      // Keep the chat's latest first, so what they try is what you sent.
      if (detail.chat) await api.keep(detail.chat.id).catch(() => undefined)
      await api.suggestFrom(id, note.trim(), titles.map((title) => ({ title })))
      void refreshSession()
      setSent({ titles, note: note.trim() })
    } catch (e) {
      setSaid(e instanceof Error ? e.message : 'That did not work.')
      setBusy(false)
    }
  }

  return (
    <Page current="My things" orbs={M}>
      <CenterHero bottom={100}
        pre={<Crumbs trail={[['My things', '/my-things'], [`Your copy of ${projectName}`, `/copies/${id}`], ['Suggest it']]} />}
        title={`Send your change to ${maker}`}
        sub={`${maker} sees what you changed in plain words, and a note from you. Then it is theirs to take or leave.`} />
      <Main>
        <TwoUp
          left={<>
            <Box title="What you are sending" note={changes.length > 1 ? 'Send them all, or just the ones you are sure about.' : 'Say it the way you would say it to them.'}>
              <div style={{ marginTop: -4 }}>
                {changes.map((v) => (
                  <label className="opt" key={v.number} style={{ position: 'relative' }}>
                    <input className="r" type="checkbox" checked={picked.has(v.number)}
                      onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(v.number)) n.delete(v.number); else n.add(v.number); return n })} />
                    <span className="sq" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    </span>
                    <span style={s('display:flex;flex-direction:column;gap:3px')}>
                      <span className="h3">{plain(v.label)}</span>
                      {v.changes.length > 0 ? <span className="small">Changed {v.changes.map((c) => c.path).join(', ')}</span> : null}
                    </span>
                  </label>
                ))}
                <label className="fld" style={{ marginTop: changes.length > 0 ? 14 : 0 }}>
                  <span className="lab">{changes.length > 0 ? 'Anything else you changed' : 'What you changed, in a sentence'}</span>
                  <input className="inp" type="text" value={own} onChange={(e) => setOwn(e.target.value)} placeholder="It saves a spreadsheet as well." />
                </label>
              </div>
            </Box>
            <Box title="Anything you want to say">
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                <label className="fld">
                  <span className="lab">A note to {maker}</span>
                  <textarea className="inp" rows={5} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="I work through interviews in Excel, so having a spreadsheet next to the NVivo file saves me a step every time. Happy to be told no." />
                </label>
                <span className="small">They read this before they look at anything else. Two or three sentences is plenty.</span>
              </div>
            </Box>
          </>}
          right={<>
            <Box title="What happens next">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-6px')}>
                <Item kind={1} pad="18px 0" title={`${maker} gets it`} body="They see your changes in the same plain words you are reading now." />
                <Item kind={2} pad="18px 0" title="They decide" body="Take it or leave it. There is no deadline and no queue." />
                <Item kind={3} pad="18px 0" title="If they take it" body="It becomes the next version for everyone who downloads it, and your name goes on it." />
              </div>
            </Box>
            <Box title="What they can see">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
                <div className="row2" style={{ alignItems: 'center', gap: 12 }}>
                  <span className="who body" style={{ color: '#091717' }}><Avatar name={me.name} size={24} />Your name</span>
                  <span className="small" style={{ marginLeft: 'auto' }}>{me.name}</span>
                </div>
                <div className="row2" style={{ alignItems: 'center', gap: 12 }}>
                  <span className="body" style={{ color: '#091717' }}>Your copy, so it can be built for everyone</span>
                  <span className="small" style={{ marginLeft: 'auto' }}>If they take it</span>
                </div>
                <div className="row2" style={{ alignItems: 'center', gap: 12 }}>
                  <span className="body" style={{ color: '#091717' }}>Your files, or anything you ran</span>
                  <span className="small" style={{ marginLeft: 'auto' }}>Never</span>
                </div>
              </div>
            </Box>
            <div style={s('display:flex;flex-direction:column;gap:12px')}>
              {said ? <span className="small" role="alert" style={{ color: '#b4563c' }}>{said}</span> : null}
              <button type="button" className="btn" disabled={busy || titles.length === 0} onClick={() => { void send() }} style={s('width:100%;box-sizing:border-box')}>
                {busy ? 'Sending it' : `Send it to ${maker}`}
              </button>
              <Link className="ghost" to={`/copies/${id}`} style={s('width:100%;box-sizing:border-box')}>Not yet</Link>
            </div>
          </>}
        />
      </Main>
    </Page>
  )
}

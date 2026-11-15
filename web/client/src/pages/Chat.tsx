import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, readableAgo, type ChatAnswer, type ChatInfo, type ChatVersion } from '../api'
import { Hero, Main, Page, Plain } from '../components/bits'
import {
  Box, CenterHero, Column, Crumbs, Item, KitWindow, Mark, Meta, SignedIn, TwoUp,
} from '../components/kit'
import { M } from './MyThings'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const C11: OrbSpec[] = [[0.975, 0.88, 0.08, 'stone'], [0.02, 1.05, 0.108, 'violet']]

/* ---------- what the conversation remembers on this computer ---------- */

type Said =
  | { who: 'me'; text: string; held?: boolean }
  | { who: 'claude'; text: string; version?: ChatVersion | null; stopped?: boolean }
  | { who: 'held'; text: string; found: string[]; reminder: string }

const GREETING_MINE = 'Tell me what you want to change, in your own words. Nothing happens to the version people download until you make a new one yourself.'
const greetingCopy = (maker: string) =>
  `This is your copy, so change it however suits your work. ${maker ? `${maker}’s` : 'The original'} version does not move, and nobody is watching what you do in here.`

const IDEAS = ['Make the window simpler', 'Say what went wrong when it fails', 'Change what the files are called']

function remember(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}
function recall<T>(key: string): T | null {
  try { const v = sessionStorage.getItem(key); return v ? (JSON.parse(v) as T) : null } catch { return null }
}
const chatFor = (target: Target) => target.kind === 'maker' ? `chat-for:mine:${target.slug}` : `chat-for:copy:${target.copyId}`

/** "You asked: shorter names" is how the chat labels a change. People read just the words. */
export function plain(label: string): string {
  return label.replace(/^You asked:\s*/i, '').replace(/^./, (c) => c.toUpperCase())
}

/** The changes that are still in it: everything since the start, minus what was undone. */
export function keptChanges(versions: ChatVersion[]): ChatVersion[] {
  return versions.filter((v) => v.number > 0 && /^You asked:/i.test(v.label))
}

type Target = { kind: 'maker'; slug: string } | { kind: 'copy'; copyId: string }

/**
 * Starts the chat, or picks the one already going back up. Asked twice
 * for the same thing at once, which React does on purpose in development,
 * it still starts only one.
 */
const opening = new Map<string, Promise<{ chat: ChatInfo; versions: ChatVersion[] }>>()
function openChat(target: Target): Promise<{ chat: ChatInfo; versions: ChatVersion[] }> {
  const key = chatFor(target)
  let once = opening.get(key)
  if (!once) {
    once = startOrRejoin(target).finally(() => { setTimeout(() => opening.delete(key), 1000) })
    opening.set(key, once)
  }
  return once
}

async function startOrRejoin(target: Target): Promise<{ chat: ChatInfo; versions: ChatVersion[] }> {
  const known = recall<string>(chatFor(target))
  if (known) {
    try { return await api.chat(known) } catch (e) {
      if (!(e instanceof ApiError && e.status === 410)) throw e
    }
  }
  const made = target.kind === 'maker' ? await api.chatOnMine(target.slug) : await api.chatOnCopy(target.copyId)
  remember(chatFor(target), made.chat.id)
  return made
}

const SEND = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
)

function Rules() {
  const ok = ['Change what it makes, and what the files are called', 'Add or take away a choice in the window', 'Change what it does when something goes wrong']
  const no: [string, string][] = [
    ['Make it reach the internet', 'It would fail its checks. People trust these because they do not.'],
    ['Make it do something unrelated', 'A new thing is a new project, not a change to this one.'],
  ]
  return (
    <details className="dis">
      <summary>What you can ask for, and what you cannot</summary>
      <div className="inner" style={s('display:flex;flex-direction:column;gap:0')}>
        {ok.map((t) => <Item key={t} kind="done" small title={t} pad="14px 0" />)}
        {no.map(([t, why]) => <Item key={t} kind="na" small title={t} body={why} pad="14px 0" />)}
      </div>
    </details>
  )
}

function changedLine(v: ChatVersion): string {
  const files = v.changes.length
  const what = files === 0 ? 'Nothing in the files moved.' : `Changed ${files === 1 ? v.changes[0]?.path : `${files} files`}.`
  const checks = v.checks?.status === 'passed' ? ' The checks passed.'
    : v.checks?.status === 'failed' ? ' The checks found a problem.' : ''
  return what + checks
}

/** C1 to C10, and C8 for a copy. One conversation, with the window beside it. */
export function ChangeIt({ mode }: { mode: 'maker' | 'copy' }) {
  return <SignedIn current="My things" orbs={M}><ChangeItPage mode={mode} /></SignedIn>
}

function ChangeItPage({ mode }: { mode: 'maker' | 'copy' }) {
  const { slug = '', id: copyId = '' } = useParams()
  const navigate = useNavigate()
  const where = useLocation()
  const target: Target = mode === 'maker' ? { kind: 'maker', slug } : { kind: 'copy', copyId }
  const [chat, setChat] = useState<ChatInfo | null>(null)
  const [versions, setVersions] = useState<ChatVersion[]>([])
  const [said, setSaid] = useState<Said[]>([])
  const [maker, setMaker] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [kept, setKept] = useState(false)
  const [trouble, setTrouble] = useState<{ status: number; message: string } | null>(null)
  const asked = useRef(false)
  const end = useRef<HTMLDivElement>(null)

  // Start or rejoin, once.
  useEffect(() => {
    let live = true
    openChat(target)
      .then(async ({ chat: c, versions: v }) => {
        if (!live) return
        setChat(c)
        setVersions(v)
        setSaid(recall<Said[]>(`chat:${c.id}`) ?? [])
        if (c.kind === 'copy' && c.copy_id) {
          const d = await api.copyOf(c.copy_id).catch(() => null)
          if (live && d?.project) setMaker(d.project.maker)
        }
      })
      .catch((e: unknown) => {
        if (!live) return
        setTrouble(e instanceof ApiError ? { status: e.status, message: e.message } : { status: 0, message: 'That did not work.' })
      })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, copyId, mode])

  useEffect(() => { if (chat) remember(`chat:${chat.id}`, said) }, [chat, said])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [said.length, busy])

  const say = (message: string, confirmPrivate = false) => {
    if (!chat || busy || !message.trim()) return
    setBusy(true)
    setKept(false)
    setSaid((now) => confirmPrivate
      ? [...now.filter((m) => m.who !== 'held'), { who: 'me', text: message }]
      : [...now, { who: 'me', text: message }])
    setText('')
    api.say(chat.id, message.trim(), confirmPrivate)
      .then((answer: ChatAnswer) => {
        if (answer.kind === 'privacy_reminder') {
          setSaid((now) => [...now.slice(0, -1), { who: 'held', text: message, found: answer.found, reminder: answer.reminder }])
          return
        }
        setSaid((now) => [...now, { who: 'claude', text: answer.reply, version: answer.version, stopped: answer.stoppedEarly }])
        if (answer.version) setVersions((v) => [...v, answer.version as ChatVersion])
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 410) { setTrouble({ status: 410, message: e.message }); return }
        setSaid((now) => [...now, { who: 'claude', text: e instanceof Error ? e.message : 'That did not work. Try again.' }])
      })
      .finally(() => setBusy(false))
  }

  // Y1 can arrive with the first thing to ask already written.
  useEffect(() => {
    const first = (where.state as { ask?: string } | null)?.ask
    if (chat && first && !asked.current && said.length === 0) {
      asked.current = true
      say(first)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat])

  const step = (go: Promise<{ version: ChatVersion | null }>, words: string) => {
    if (!chat) return
    setBusy(true)
    go.then(({ version }) => {
      if (version) setVersions((v) => [...v, version])
      setSaid((now) => [...now, { who: 'me', text: words }, { who: 'claude', text: version ? `Done. ${plain(version.label)}.` : 'There was nothing to undo.', version }])
    }).catch((e: Error) => setSaid((now) => [...now, { who: 'claude', text: e.message }]))
      .finally(() => setBusy(false))
  }

  if (trouble?.status === 410) return <Ended slug={chat?.project.slug ?? slug} copyId={mode === 'copy' ? copyId : null} />
  if (trouble) {
    const notSetUp = trouble.status === 503
    return (
      <Plain current="My things" title={notSetUp ? 'Chatting is not running' : 'That did not work'}
        line={notSetUp ? 'The chat service is not answering, so nothing can be changed by chatting right now.' : trouble.message}>
        <Column>
          {notSetUp ? (
            <Box title="To start it on your computer">
              <p className="body" style={{ margin: 0 }}>{trouble.message}</p>
              <p className="small" style={{ margin: 0 }}>In the chat folder: npm install, then npm run dev with ANTHROPIC_API_KEY set. Then add CHAT_URL=http://127.0.0.1:3100 to web/.env and restart the API.</p>
            </Box>
          ) : null}
          <Link className="ghost" to={mode === 'maker' ? `/my-things/${slug}` : `/copies/${copyId}`} style={{ alignSelf: 'flex-start' }}>Back</Link>
        </Column>
      </Plain>
    )
  }
  if (!chat) {
    return (
      <Page current="My things" orbs={M}>
        <Hero title="Change it by chatting" sub={<Meta facts={['Opening your files']} />} />
        <Main>{null}</Main>
      </Page>
    )
  }

  const changes = keptChanges(versions)
  const latest = versions[versions.length - 1]
  const changedSinceStart = (latest?.number ?? 0) > 0 && changes.length > 0
  const name = chat.project.name
  const isCopy = chat.kind === 'copy'
  const lastClaude = [...said].reverse().find((m) => m.who === 'claude') as Extract<Said, { who: 'claude' }> | undefined

  const keepIt = (then?: string) => {
    setBusy(true)
    api.keep(chat.id).then(() => { setKept(true); if (then) navigate(then) })
      .catch((e: Error) => setSaid((now) => [...now, { who: 'claude', text: e.message }]))
      .finally(() => setBusy(false))
  }

  return (
    <Page current="My things" orbs={M}>
      <Hero
        pre={<Crumbs trail={isCopy
          ? [['My things', '/my-things'], [`Your copy of ${name}`, `/copies/${chat.copy_id}`], ['Change it']]
          : [['My things', '/my-things'], [name, `/my-things/${chat.project.slug}`], ['Change it']]} />}
        title={isCopy ? 'Change your copy' : 'Change it by chatting'}
        sub={<Meta facts={isCopy
          ? [`Your copy of ${name}`, `Started from ${maker ? `${maker.split(/\s+/)[0]}’s` : 'their'} version ${chat.from_version}`]
          : [name, `Version ${chat.from_version}`, 'Made by you']} />} />
      <Main>
        <div className="split">
          <div style={s('display:flex;flex-direction:column;gap:28px')}>
            <div className="room" aria-live="polite">
              <div className="msg plain">{isCopy ? greetingCopy(maker.split(/\s+/)[0] ?? '') : GREETING_MINE}</div>
              {said.map((m, i) => {
                if (m.who === 'me') return <div key={i} className="msg me">{m.text}</div>
                if (m.who === 'held') {
                  return (
                    <div key={i} style={s('display:flex;flex-direction:column;gap:14px')}>
                      <div className="msg" style={s('align-self:flex-end;background:transparent;border:1px dashed rgba(9,23,23,0.46);border-bottom-right-radius:6px')}>
                        {m.text}<span className="small" style={{ display: 'block', marginTop: 6 }}>Not sent</span>
                      </div>
                      <div className="panel" style={s('display:flex;flex-direction:column;gap:14px;padding:24px')}>
                        <div style={s('display:flex;flex-direction:column;gap:6px')}>
                          <h2 className="h2">This has not been sent yet</h2>
                          <span className="small">There is {m.found.join(' and ')} in what you wrote.</span>
                        </div>
                        <p className="body" style={{ margin: 0 }}>
                          Messages go to Claude, so anything you write in one leaves your computer. Your files never do,
                          and nothing about this message has gone anywhere yet.
                        </p>
                        <div style={s('display:flex;flex-wrap:wrap;gap:10px')}>
                          <button type="button" className="btn" disabled={busy} onClick={() => say(m.text, true)}>Send it anyway</button>
                          <button type="button" className="ghost" onClick={() => { setText(m.text); setSaid((now) => now.filter((x) => x !== m)) }}>Let me change it first</button>
                        </div>
                        <span className="small">This check runs in plain code. No AI read your message to find that.</span>
                      </div>
                    </div>
                  )
                }
                const newest = m === lastClaude
                return (
                  <div key={i} className="msg plain" style={{ whiteSpace: 'pre-wrap' }}>
                    {m.text}
                    {m.version && m.version.number > 0 ? <span className="small" style={{ display: 'block', marginTop: 10 }}>{changedLine(m.version)}</span> : null}
                    {newest && !busy && m.stopped ? (
                      <div className="acts">
                        <button type="button" className="chip on" onClick={() => say('Carry on from where you stopped.')}>Carry on from here</button>
                        <button type="button" className="chip" onClick={() => step(api.undo(chat.id), 'Undo that')}>Undo the whole thing</button>
                      </div>
                    ) : newest && !busy && m.version && m.version.number > 0 ? (
                      <div className="acts">
                        <button type="button" className="chip" onClick={() => step(api.undo(chat.id), 'Undo that')}>Undo</button>
                        <button type="button" className="chip" onClick={() => document.getElementById('say')?.focus()}>Change something else</button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {busy ? (
                <div className="msg plain" style={s('display:flex;align-items:center;gap:12px;color:rgba(9,23,23,0.64)')}>
                  <Mark kind="now" />Working on it. Bigger changes can take a minute.
                </div>
              ) : null}
              <div ref={end} />
            </div>

            {said.length === 0 && !busy ? (
              <div style={s('display:flex;flex-direction:column;gap:10px')}>
                <span className="small">Or start from one of these</span>
                <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
                  {IDEAS.map((idea) => <button key={idea} type="button" className="chip" onClick={() => say(idea)}>{idea}</button>)}
                </div>
              </div>
            ) : null}

            <form className="composer" onSubmit={(e) => { e.preventDefault(); say(text) }}>
              <input id="say" className="inp" type="text" placeholder="Say what you want to change" aria-label="Say what you want to change"
                value={text} onChange={(e) => setText(e.target.value)} disabled={busy} maxLength={4000} />
              <button type="submit" className="send" aria-label="Send" disabled={busy || !text.trim()}>{SEND}</button>
            </form>

            {versions.length > 1 ? (
              <details className="dis">
                <summary>Everything you have asked for</summary>
                <div className="inner" style={s('display:flex;flex-direction:column;gap:0')}>
                  {[...versions].reverse().map((v, i) => (
                    <div className="prob" key={v.number} style={s('padding:16px 0;gap:16px;flex-wrap:wrap')}>
                      <span style={s('display:flex;flex-direction:column;gap:4px;flex:1;min-width:200px')}>
                        <span style={s('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
                          <span className="body" style={{ color: '#091717' }}>{v.number === 0 ? (isCopy ? 'Where your copy started' : `Version ${chat.from_version}, as people have it`) : plain(v.label)}</span>
                          {i === 0 ? <span className="chip on" style={s('height:26px;padding:0 11px;font-size:14px')}>Now</span> : null}
                        </span>
                        <span className="small">{readableAgo(v.createdAt)}</span>
                      </span>
                      {i > 0 ? (
                        <button type="button" className="ghost" disabled={busy} style={s('height:40px;font-size:16px;padding:0 18px')}
                          onClick={() => step(api.restore(chat.id, v.number), `Go back to ${v.number === 0 ? 'the start' : `“${plain(v.label)}”`}`)}>
                          Go back to here
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            <Rules />
          </div>

          <div className="panel" style={s('position:sticky;top:24px;display:flex;flex-direction:column;gap:18px;padding:28px')}>
            <div style={s('display:flex;align-items:baseline;gap:16px;flex-wrap:wrap')}>
              <h2 className="h2">{changedSinceStart ? 'What it would look like' : 'What it looks like now'}</h2>
              <span className="small" style={{ marginLeft: 'auto' }}>
                {changedSinceStart ? (isCopy ? 'Your copy, a preview' : 'A preview, not saved') : isCopy ? 'Your copy' : `Version ${chat.from_version}`}
              </span>
            </div>
            <KitWindow name={name} />
            <div style={s('display:flex;flex-direction:column;gap:12px;padding-top:18px;border-top:1px solid rgba(9,23,23,0.16)')}>
              {!changedSinceStart ? (
                <p className="body" style={{ margin: 0, color: '#091717' }}>
                  {isCopy
                    ? 'Nothing you say here touches the original. It is your copy to change.'
                    : `Nothing you say here touches version ${chat.from_version}. People keep downloading that one until you make a new version yourself.`}
                </p>
              ) : isCopy ? (
                <>
                  <p className="body" style={{ margin: 0, color: '#091717' }}>
                    {kept ? 'Kept. Your copy works this way now.' : 'Keeping this makes your copy work your way. It does not make a version, because this one is not yours to version.'}
                  </p>
                  <button type="button" className="btn" disabled={busy || kept} onClick={() => keepIt()} style={s('width:100%;box-sizing:border-box')}>
                    {kept ? 'Kept, just for you' : 'Keep it, just for me'}
                  </button>
                  <button type="button" className="ghost" disabled={busy} onClick={() => navigate(`/copies/${chat.copy_id}/suggest`)} style={s('width:100%;box-sizing:border-box')}>
                    Keep it and suggest it{maker ? ` to ${maker.split(/\s+/)[0]}` : ''}
                  </button>
                </>
              ) : (
                <>
                  <p className="body" style={{ margin: 0, color: '#091717' }}>
                    Your app on other people’s computers has not changed, and will not until you make a new version.
                  </p>
                  <button type="button" className="btn" disabled={busy} onClick={() => navigate(`/my-things/${chat.project.slug}/change/version`)} style={s('width:100%;box-sizing:border-box')}>
                    Make it version {chat.from_version + 1}
                  </button>
                  <button type="button" className="ghost" disabled={busy} onClick={() => step(api.undo(chat.id), 'Undo that')} style={s('width:100%;box-sizing:border-box')}>
                    Undo the last change
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </Main>
    </Page>
  )
}

/** C11. The chat service forgot it, which it does after an hour. */
function Ended({ slug, copyId }: { slug: string; copyId: string | null }) {
  return (
    <Page current="My things" orbs={C11}>
      <CenterHero title="This chat has ended" bottom={100}
        sub="Chats are kept for an hour after you last use one. Nothing you made a version of, or kept, is lost." />
      <Main>
        <Column>
          <Box title="What happened to your changes">
            <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
              <Item kind="done" small title={copyId ? 'Anything you kept is safe' : 'Every version you made is safe'}
                body={copyId ? 'Your copy works the way you kept it.' : 'You made it a version, so it is real. People can get it, and it is in your history.'} />
              <Item kind="na" small title="Anything you tried but did not keep" body="That is gone. It only ever existed inside the chat." />
            </div>
            <div style={s('display:flex;flex-wrap:wrap;gap:14px;padding-top:6px')}>
              <button type="button" className="btn" onClick={() => {
                try { sessionStorage.removeItem(copyId ? `chat-for:copy:${copyId}` : `chat-for:mine:${slug}`) } catch { /* fine */ }
                window.location.reload()
              }}>Start another chat</button>
              <Link className="ghost" to={copyId ? `/copies/${copyId}` : `/my-things/${slug}`}>{copyId ? 'See your copy' : 'See your project'}</Link>
            </div>
          </Box>
          <Box title="Why it works this way">
            <p className="body" style={{ margin: 0 }}>
              Your project is only unpacked on our side while you are talking about it. When you stop, that copy is
              deleted. Keeping chats open forever would mean keeping your files forever, and we would rather not hold
              them at all.
            </p>
          </Box>
        </Column>
      </Main>
    </Page>
  )
}

/** C4. What is in the chat becomes the next version, for everyone. */
export function MakeVersion() {
  return <SignedIn current="My things" orbs={M}><MakeVersionPage /></SignedIn>
}

function MakeVersionPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<{ chat: ChatInfo; versions: ChatVersion[] } | null>(null)
  const [ended, setEnded] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    const id = recall<string>(`chat-for:mine:${slug}`)
    if (!id) { setEnded(true); return }
    api.chat(id).then((r) => {
      setState(r)
      setNote(keptChanges(r.versions).map((v) => plain(v.label).replace(/[.?!]*$/, '.')).join(' '))
    }).catch(() => setEnded(true))
  }, [slug])

  if (ended) return <Ended slug={slug} copyId={null} />
  if (!state) return <Page current="My things" orbs={M}><CenterHero title="Make a version" /><Main>{null}</Main></Page>

  const { chat, versions } = state
  const changes = keptChanges(versions)
  const next = chat.from_version + 1
  const checked = changes.filter((v) => v.checks?.status === 'passed').length
  const failed = changes.some((v) => v.checks?.status === 'failed')

  const make = () => {
    setBusy(true)
    setSaid(null)
    api.release(chat.id, note.trim())
      .then(() => {
        try { sessionStorage.removeItem(`chat-for:mine:${slug}`) } catch { /* fine */ }
        void api.endChat(chat.id)
        navigate(`/publish/${slug}/ready`)
      })
      .catch((e: Error) => { setSaid(e.message); setBusy(false) })
  }

  return (
    <Page current="My things" orbs={M}>
      <CenterHero bottom={100}
        pre={<Crumbs trail={[['My things', '/my-things'], [chat.project.name, `/my-things/${slug}`], ['Change it', `/my-things/${slug}/change`], ['Make a version']]} />}
        title={`Make this version ${next}`}
        sub="This is the one people will get from now on. The changes you made in the chat, and nothing else." />
      <Main>
        <TwoUp
          left={<>
            <Box title="What everyone will get">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
                {changes.length > 0
                  ? changes.map((v) => (
                      <Item key={v.number} pad="20px 0" title={plain(v.label)}
                        body={v.changes.length > 0 ? `Changed ${v.changes.map((c) => c.path).join(', ')}.` : undefined} />
                    ))
                  : <p className="body" style={{ margin: '10px 0 0' }}>Nothing has changed in the chat yet.</p>}
              </div>
            </Box>
            <Box title="Tell people what changed">
              <div style={s('display:flex;flex-direction:column;gap:14px;margin-top:-4px')}>
                <label className="fld">
                  <span className="lab">This shows up next to Version {next}</span>
                  <textarea className="inp" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <span className="small">We wrote this from what you asked for. Say it however you would say it.</span>
              </div>
            </Box>
          </>}
          right={<>
            <Box title="Checked as you went" note="Every change was checked the moment it was made.">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-10px')}>
                <div className="row2" style={{ alignItems: 'center' }}>
                  <Mark kind={failed ? 'bad' : 'done'} />
                  <span className="body" style={{ color: '#091717' }}>
                    {failed ? 'One change did not pass its checks' : `${checked} of ${changes.length} ${changes.length === 1 ? 'change' : 'changes'} passed`}
                  </span>
                </div>
              </div>
            </Box>
            <Box title="What happens when you press it">
              <div style={s('display:flex;flex-direction:column;gap:0;margin-top:-6px')}>
                <Item kind={1} pad="18px 0" title="It gets built again" body="For Mac, Windows and Linux, and checked again before anyone can get it." />
                <Item kind={2} pad="18px 0" title="It becomes the newest version" body="Shown first on its page, the moment it is ready." />
                <Item kind={3} pad="18px 0" title="Nothing breaks for anyone" body={`Version ${chat.from_version} keeps working. Nobody has to update to carry on.`} />
              </div>
            </Box>
            <div style={s('display:flex;flex-direction:column;gap:12px')}>
              {said ? <span className="small" role="alert" style={{ color: '#b4563c' }}>{said}</span> : null}
              <button type="button" className="btn" disabled={busy || changes.length === 0 || !note.trim()} onClick={make} style={s('width:100%;box-sizing:border-box')}>
                {busy ? 'Making it' : `Make it version ${next}`}
              </button>
              <Link className="ghost" to={`/my-things/${slug}/change`} style={s('width:100%;box-sizing:border-box')}>Not yet</Link>
            </div>
          </>}
        />
      </Main>
    </Page>
  )
}


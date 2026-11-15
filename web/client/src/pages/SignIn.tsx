import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Me } from '../api'
import { Main, Page, refreshSession, useSession } from '../components/bits'
import { Box, CenterHero, Column, Line, Rows } from '../components/kit'
import type { OrbSpec } from '../fx'
import { s } from '../s'

const W9: OrbSpec[] = [[0.975, 0.88, 0.08, 'ink'], [0.02, 1.05, 0.108, 'teal']]
const W10: OrbSpec[] = [[0.975, 0.88, 0.08, 'stone'], [0.02, 1.05, 0.108, 'violet']]

function afterSignIn(): string {
  try {
    const next = sessionStorage.getItem('after-sign-in')
    sessionStorage.removeItem('after-sign-in')
    if (next && next.startsWith('/') && !next.startsWith('/sign-in')) return next
  } catch { /* private mode */ }
  return '/my-things'
}

type Way = 'in' | 'up' | 'link'

/**
 * W9. Three ways in, one at a time: a password you already have, a new
 * account with a password, or a link by email. All three end in the same
 * session, and getting things never needs any of them.
 */
export function SignIn() {
  const { me } = useSession()
  const navigate = useNavigate()
  const [way, setWay] = useState<Way>('in')
  const [login, setLogin] = useState('')
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (me) navigate('/my-things', { replace: true }) }, [me, navigate])

  const done = () => refreshSession().then(() => navigate(afterSignIn(), { replace: true }))
  const fail = (e: Error) => { setError(e.message); setBusy(false) }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    if (way === 'in') {
      api.signIn(login.trim(), password).then(done).catch(fail)
    } else if (way === 'up') {
      api.signUp({ username: username.trim(), email: email.trim(), password, name: name.trim() }).then(done).catch(fail)
    } else {
      api.emailLink(email.trim())
        .then((r) => navigate(`/sign-in/check?email=${encodeURIComponent(email.trim())}`, { state: { link: r.link } }))
        .catch(fail)
    }
  }

  const switchTo = (next: Way) => { setWay(next); setError(null) }
  const field = (label: string, input: React.ReactNode, note?: string) => (
    <label className="fld">
      <span className="lab">{label}</span>
      {input}
      {note ? <span className="small">{note}</span> : null}
    </label>
  )

  return (
    <Page orbs={W9}>
      <CenterHero title={way === 'up' ? 'Make an account' : 'Sign in'} bottom={100}
        sub="You only need an account to put something in, not to take something out." />
      <Main>
        <Column width={560}>
          <div className="panel" style={s('display:flex;flex-direction:column;gap:18px;padding:28px')}>
            <div style={s('display:flex;flex-wrap:wrap;gap:8px')} role="tablist" aria-label="How to sign in">
              {([['in', 'Sign in'], ['up', 'Make an account'], ['link', 'Email me a link']] as [Way, string][]).map(([w, label]) => (
                <button key={w} type="button" role="tab" aria-selected={way === w}
                  className={way === w ? 'chip on' : 'chip'} onClick={() => switchTo(w)}>{label}</button>
              ))}
            </div>
            <form onSubmit={submit} style={s('display:flex;flex-direction:column;gap:18px')}>
              {way === 'in' ? <>
                {field('Your username or email', <input className="inp" type="text" required autoComplete="username"
                  value={login} onChange={(e) => setLogin(e.target.value)} />)}
                {field('Your password', <input className="inp" type="password" required autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />)}
              </> : way === 'up' ? <>
                {field('Your name', <input className="inp" type="text" required autoComplete="name" maxLength={80}
                  value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Raman" />, 'Shown on what you share, and on changes you suggest.')}
                {field('A username', <input className="inp" type="text" required autoComplete="username" maxLength={30}
                  value={username} onChange={(e) => setUsername(e.target.value)} placeholder="priya" />, 'Letters, numbers, dashes or underscores, starting with a letter.')}
                {field('Your email address', <input className="inp" type="email" required autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu" />, 'Nobody sees it. It is how you get back in if you forget your password.')}
                {field('A password', <input className="inp" type="password" required autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />, 'At least 8 characters, and not one you use anywhere else.')}
              </> : <>
                {field('Your email address', <input className="inp" type="email" required placeholder="you@university.edu" autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)} />)}
              </>}
              {error ? <span className="small" role="alert" style={{ color: '#b4563c' }}>{error}</span> : null}
              <button className="btn" type="submit" disabled={busy} style={s('width:100%;box-sizing:border-box')}>
                {busy ? 'One moment' : way === 'in' ? 'Sign in' : way === 'up' ? 'Make my account' : 'Email me a link to sign in'}
              </button>
              <span className="small">
                {way === 'in' ? 'Forgotten your password? Ask for a link by email instead.'
                  : way === 'up' ? 'You are signed in straight away. We also email you a link to confirm the address is yours.'
                  : 'We send you a link to click. It signs you in, and makes your account if you do not have one yet.'}
              </span>
            </form>
          </div>
          <Box title="What an account is for">
            <Rows>
              <Line left="Sharing something you made" right="Needs one" />
              <Line left="Keeping your own copy of something" right="Needs one" />
              <Line left="Suggesting a change to someone" right="Needs one" />
              <Line left="Finding and getting things" right="Needs nothing" />
            </Rows>
          </Box>
          <div style={s('display:flex;flex-wrap:wrap;gap:14px;align-items:center')}>
            <Link className="ghost" to="/">Back to browsing</Link>
            <span className="small">You can get anything here without ever signing in.</span>
          </div>
        </Column>
      </Main>
    </Page>
  )
}

/** W10. The link is on its way. */
export function CheckEmail() {
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const where = useLocation()
  const navigate = useNavigate()
  const [again, setAgain] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [link, setLink] = useState<string | null>((where.state as { link?: string } | null)?.link ?? null)
  const open = () => { if (link) { const u = new URL(link); navigate(u.pathname + u.search) } }

  return (
    <Page orbs={W10}>
      <CenterHero title="Check your email" bottom={100}
        sub={`We sent a link to ${email || 'your address'}. Open it on this computer and you are in.`} />
      <Main>
        <Column width={560}>
          {link ? (
            <Box title="No email is sent on this computer" note="The site is running on your own computer, so here is the link that email would have had.">
              <button type="button" className="btn" onClick={open} style={s('width:100%;box-sizing:border-box')}>Open my sign in link</button>
              <span className="small">On the real site this comes by email, and this button is never shown.</span>
            </Box>
          ) : null}
          <Box title="Nothing to type in">
            <Rows>
              <Line left="The link signs you in" right="One click" />
              <Line left="It works once" right="Then it is dead" />
              <Line left="It stops working after an hour" right="Ask for another one" />
            </Rows>
          </Box>
          <Box title="Nothing arrived?">
            <Rows>
              <div className="row2" style={{ alignItems: 'center' }}>
                <span className="body" style={{ color: '#091717' }}>
                  {again === 'sent' ? 'Sent again' : 'Send it again'}
                </span>
                <button type="button" className="nav" disabled={!email || again === 'sending'}
                  style={{ marginLeft: 'auto', minHeight: 44 }}
                  onClick={() => {
                    setAgain('sending')
                    api.emailLink(email).then((r) => { setAgain('sent'); if (r.link) setLink(r.link) }).catch(() => setAgain('idle'))
                  }}>
                  Send
                </button>
              </div>
              <div className="row2" style={{ alignItems: 'center' }}>
                <span className="body" style={{ color: '#091717' }}>Wrong address? {email}</span>
                <Link className="nav" to="/sign-in" style={{ marginLeft: 'auto', minHeight: 44 }}>Change it</Link>
              </div>
            </Rows>
            <p className="small" style={{ margin: 0 }}>
              Look in spam as well. University mail systems often hold links for a few minutes before letting them through.
            </p>
          </Box>
          <div style={s('display:flex;flex-wrap:wrap;gap:14px;align-items:center')}>
            <Link className="ghost" to="/">Back to browsing</Link>
            <span className="small">Signing in is not needed to look around.</span>
          </div>
        </Column>
      </Main>
    </Page>
  )
}

/** A link works once, so each one is only ever spent once, however often React asks. */
const spent = new Map<string, Promise<Me>>()

/** Where the link in the email lands. Finishes signing in, asks a new person their name, then goes on. */
export function SignInDone() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [failed, setFailed] = useState<string | null>(null)
  const [nameless, setNameless] = useState<Me | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const token = params.get('token') ?? ''
    let once = spent.get(token)
    if (!once) {
      once = api.finishSignIn(token).then(async (r) => { await refreshSession(); return r.user })
      spent.set(token, once)
    }
    let live = true
    once
      .then((user) => {
        if (!live) return
        if (!user.name.trim()) setNameless(user)
        else navigate(afterSignIn(), { replace: true })
      })
      .catch((e: Error) => { if (live) setFailed(e.message) })
    return () => { live = false }
  }, [params, navigate])

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    api.name(name)
      .then(() => refreshSession())
      .then(() => navigate(afterSignIn(), { replace: true }))
      .catch((e: Error) => { setFailed(e.message); setBusy(false) })
  }

  if (nameless) {
    return (
      <Page orbs={W9}>
        <CenterHero title="You are in" bottom={100} sub="One last thing, and only this once." />
        <Main>
          <Column width={560}>
            <Box title="What should people call you?" note="It goes on what you share, and on changes you suggest to other people.">
              <form onSubmit={save} style={s('display:flex;flex-direction:column;gap:18px;margin-top:-4px')}>
                <label className="fld">
                  <span className="lab">Your name</span>
                  <input className="inp" type="text" required autoComplete="name" maxLength={80} autoFocus
                    value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Raman" />
                </label>
                {failed ? <span className="small" role="alert" style={{ color: '#b4563c' }}>{failed}</span> : null}
                <button className="btn" type="submit" disabled={busy || !name.trim()} style={s('width:100%;box-sizing:border-box')}>
                  {busy ? 'Saving it' : 'Carry on'}
                </button>
                <span className="small">Signed in as {nameless.email}. Nobody sees your email address.</span>
              </form>
            </Box>
          </Column>
        </Main>
      </Page>
    )
  }

  return (
    <Page orbs={W9}>
      <CenterHero bottom={100}
        title={failed ? 'That link did not work' : 'Signing you in'}
        sub={failed ?? 'One moment.'} />
      <Main>
        {failed ? (
          <Column width={560}>
            <div style={s('display:flex;flex-wrap:wrap;gap:14px;align-items:center')}>
              <Link className="btn" to="/sign-in">Send me a new one</Link>
              <Link className="ghost" to="/">Back to browsing</Link>
            </div>
          </Column>
        ) : null}
      </Main>
    </Page>
  )
}

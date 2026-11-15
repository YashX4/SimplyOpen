import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
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

/** W9. One field, one button, and why you might want an account at all. */
export function SignIn() {
  const { me } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (me) navigate('/my-things', { replace: true }) }, [me, navigate])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    api.emailLink(email.trim())
      .then(() => navigate(`/sign-in/check?email=${encodeURIComponent(email.trim())}`))
      .catch((e: Error) => { setError(e.message); setBusy(false) })
  }

  return (
    <Page orbs={W9}>
      <CenterHero title="Sign in" bottom={100}
        sub="You only need an account to put something in, not to take something out." />
      <Main>
        <Column width={560}>
          <Box title="Sign in, or make an account" note="The same link does both.">
            <form onSubmit={submit} style={s('display:flex;flex-direction:column;gap:18px;margin-top:-4px')}>
              <label className="fld">
                <span className="lab">Your email address</span>
                <input className="inp" type="email" required placeholder="you@university.edu" autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error ? true : undefined} />
              </label>
              {error ? <span className="small" role="alert" style={{ color: '#b4563c' }}>{error}</span> : null}
              <button className="btn" type="submit" disabled={busy} style={s('width:100%;box-sizing:border-box')}>
                {busy ? 'Sending it' : 'Email me a link to sign in'}
              </button>
              <span className="small">We send you a link to click. There is no password to make up, and none to forget.</span>
            </form>
          </Box>
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
  const [again, setAgain] = useState<'idle' | 'sending' | 'sent'>('idle')

  return (
    <Page orbs={W10}>
      <CenterHero title="Check your email" bottom={100}
        sub={`We sent a link to ${email || 'your address'}. Open it on this computer and you are in.`} />
      <Main>
        <Column width={560}>
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
                    api.emailLink(email).then(() => setAgain('sent')).catch(() => setAgain('idle'))
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
            {import.meta.env.DEV ? (
              <p className="small" style={{ margin: 0 }}>
                While the site runs on your own computer, no email is sent. The link is printed in the
                terminal running the API instead.
              </p>
            ) : null}
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
const spent = new Map<string, Promise<unknown>>()

/** Where the link in the email lands. Finishes signing in, then goes on. */
export function SignInDone() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const token = params.get('token') ?? ''
    let once = spent.get(token)
    if (!once) {
      once = api.finishSignIn(token).then(() => refreshSession())
      spent.set(token, once)
    }
    let live = true
    once
      .then(() => { if (live) navigate(afterSignIn(), { replace: true }) })
      .catch((e: Error) => { if (live) setFailed(e.message) })
    return () => { live = false }
  }, [params, navigate])

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

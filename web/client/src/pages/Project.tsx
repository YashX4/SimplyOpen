import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  api, readableDate, readableSize, SYSTEM_NAME,
  type Build, type Platform, type ProjectPage,
} from '../api'
import { Avatar, MarkRow, Panel, Shell, Star, Trouble, Waiting, Who } from '../components/bits'

const ORDER: Platform[] = ['mac', 'windows', 'linux']

/** The window someone gets when they open it. Drawn, not screenshotted. */
function AppWindow({ name }: { name: string }) {
  return (
    <div className="win">
      <div className="wbar" aria-hidden="true">
        <i className="wdot" /><i className="wdot" style={{ opacity: 0.7 }} />
        <i className="wdot" style={{ opacity: 0.45 }} />
        <span style={{ width: 8 }} />
        <span className="small">{name}</span>
      </div>
      <div className="wdrop">
        <span className="h3">Drop files or a folder here</span>
        <span className="small">or choose them from your computer</span>
      </div>
      <div className="ghost wide" style={{ height: 46, fontSize: 16, pointerEvents: 'none' }}>
        Run
      </div>
      <span className="small" style={{ textAlign: 'center' }}>
        This is the whole thing. There is nothing else to learn.
      </span>
    </div>
  )
}

function Download({ versionId, builds }: { versionId: string; builds: Build[] }) {
  const sorted = [...builds].sort((a, b) => ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform))
  const ready = sorted.filter((b) => b.status === 'ready')
  const first = ready[0]
  const others = ready.slice(1)
  const missing = sorted.filter((b) => b.status !== 'ready')

  if (!first) {
    return (
      <Panel title="Not ready yet">
        <div className="stack" style={{ gap: 0, marginTop: -10 }}>
          {sorted.map((b) => (
            <MarkRow key={b.platform} kind={b.status === 'cannot' ? 'na' : 'bad'}
              label={SYSTEM_NAME[b.platform]}
              note={b.message || 'This one has not been built yet.'} />
          ))}
        </div>
      </Panel>
    )
  }

  return (
    <Panel>
      <div className="stack" style={{ gap: 14 }}>
        <a className="btn wide" href={api.downloadUrl(versionId, first.platform)}>
          Get it for {SYSTEM_NAME[first.platform]}
        </a>
        <span className="small">
          {readableSize(first.size_bytes)}
          {first.size_bytes ? '. ' : ''}
          You do not need an account.
        </span>

        {others.length > 0 ? (
          <div className="door" style={{ gap: 10 }}>
            {others.map((b) => (
              <a key={b.platform} className="ghost" style={{ height: 44, fontSize: 16 }}
                href={api.downloadUrl(versionId, b.platform)}>
                Also on {SYSTEM_NAME[b.platform]}
              </a>
            ))}
          </div>
        ) : null}

        {/* W5. Saying which systems it will not run on, and why, up front. */}
        {missing.length > 0 ? (
          <div className="stack" style={{ gap: 0, paddingTop: 4 }}>
            {missing.map((b) => (
              <MarkRow key={b.platform} kind="na" label={`Not on ${SYSTEM_NAME[b.platform]}`}
                note={b.message || 'There is no build for that system.'} />
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

export function Project() {
  const { slug = '' } = useParams()
  const [page, setPage] = useState<ProjectPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPage(null)
    setError(null)
    api.project(slug)
      .then(setPage)
      .catch((e: Error) => setError(e.message))
  }, [slug])

  if (error) return <Shell><Trouble message={error} /></Shell>
  if (!page) return <Shell><Waiting what="the project" /></Shell>

  const { project, owner, version, builds, check } = page

  return (
    <Shell>
      <section className="wrap" style={{ paddingTop: 80, paddingBottom: 48 }}>
        <div className="stack" style={{ gap: 16 }}>
          <h1 className="canon title">{project.name}</h1>
          <p className="small" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Who name={owner.name} />
            <span style={{ color: 'var(--control-line)' }}>/</span>
            <span>Version {version.number}</span>
            <span style={{ color: 'var(--control-line)' }}>/</span>
            <span>{readableDate(version.created_at)}</span>
            {page.stars > 0 ? (
              <>
                <span style={{ color: 'var(--control-line)' }}>/</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <Star />{page.stars}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </section>

      <div className="wrap">
        {/* W6. A project that reaches the internet says so before anything
            else, calmly, with what that means. */}
        {check?.network_access ? (
          <div className="panel" style={{ display: 'flex', gap: 16, marginBottom: 32, padding: 24 }}>
            <span className="mark bad" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                strokeLinecap="round"><path d="M12 6v8M12 17.5v.5" /></svg>
            </span>
            <span className="stack" style={{ gap: 8, flex: 1 }}>
              <span className="h3">This one uses the internet</span>
              <span className="body">
                Almost everything here runs with the internet off. This one cannot.
                The maker has said what it sends, below.
              </span>
            </span>
          </div>
        ) : null}

        <div className="grid2">
          <div className="stack" style={{ gap: 32 }}>
            <Panel title="What it does">
              <p className="body" style={{ margin: 0 }}>{project.description}</p>
            </Panel>

            <Panel title="What it looks like"
              note="This is the whole thing. There is nothing else to learn.">
              <AppWindow name={project.name} />
            </Panel>

            <Panel title="What was checked"
              note="Every version is checked again before anyone can get it.">
              <div className="stack" style={{ gap: 0, marginTop: -6 }}>
                {check ? (
                  <>
                    <MarkRow kind={check.status === 'passed' ? 'done' : 'bad'}
                      label="No keys or passwords left in it" />
                    <MarkRow kind={check.network_access ? 'bad' : 'done'}
                      label={check.network_access ? 'Reaches the internet' : 'Does not reach the internet'}
                      note={check.network_access ? 'Told you above. We do not hide this one in a list.' : undefined} />
                    {ORDER.map((p) => {
                      const build = builds.find((b) => b.platform === p)
                      return (
                        <MarkRow key={p}
                          kind={build?.status === 'ready' ? 'done' : 'na'}
                          label={`Built for ${SYSTEM_NAME[p]}`}
                          note={build && build.status !== 'ready' ? build.message || undefined : undefined} />
                      )
                    })}
                  </>
                ) : (
                  <p className="small" style={{ margin: 0 }}>
                    The checks have not finished for this version yet.
                  </p>
                )}
              </div>
            </Panel>
          </div>

          <div className="stack" style={{ gap: 32, position: 'sticky', top: 24 }}>
            <Download versionId={version.id} builds={builds} />

            <Panel title="This version">
              <div className="stack" style={{ gap: 10, marginTop: -4 }}>
                <span className="body">{version.note}</span>
                <span className="small">
                  Version {version.number}, {readableDate(version.created_at)}
                </span>
                {version.suggested_by ? (
                  <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={owner.name} />
                    With a change somebody suggested
                  </span>
                ) : null}
              </div>
            </Panel>

            <Panel>
              <p className="body" style={{ margin: 0 }}>
                Older versions still work. Getting one does not replace the one
                you have.
              </p>
            </Panel>
          </div>
        </div>
      </div>
    </Shell>
  )
}

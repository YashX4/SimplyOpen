import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type ProjectSummary } from '../api'
import { ProjectCard } from '../components/ProjectCard'
import { SearchField } from '../components/Search'
import { Shell, Trouble, Waiting } from '../components/bits'

export function SearchResults() {
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setProjects(null)
    setError(null)
    api.search(q)
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message))
  }, [q])

  const found = projects?.length ?? 0

  return (
    <Shell>
      <section className="wrap" style={{ paddingTop: 80, paddingBottom: 48 }}>
        <div className="stack" style={{ gap: 24, maxWidth: 880 }}>
          <h1 className="canon title">
            {projects === null ? 'Looking' : found > 0
              ? `${found} thing${found === 1 ? '' : 's'} for "${q}"`
              : `Nothing for "${q}"`}
          </h1>
          <SearchField initial={q} />
        </div>
      </section>

      <div className="wrap">
        {error ? <Trouble message={error} /> : null}
        {!error && projects === null ? <Waiting what="results" /> : null}

        {projects !== null && found > 0 ? (
          <div className="stack" style={{ gap: 24, maxWidth: 880 }}>
            {projects.map((p) => <ProjectCard key={p.slug} project={p} />)}
          </div>
        ) : null}

        {/* W3. Nothing found is not an error, so it does not look like one. */}
        {projects !== null && found === 0 ? (
          <div className="panel stack" style={{ gap: 20, maxWidth: 680 }}>
            <h2 className="h2">Nothing matched that</h2>
            <p className="body">
              Try fewer words, or the thing you are trying to do rather than the
              name of a program. Someone searching for a way to rename photos
              will find more with "rename photos" than with the name of an app
              they once used.
            </p>
            <div className="door">
              <Link className="btn" to="/">See everything</Link>
              <span className="small">
                Or make the thing yourself. It is how most of these started.
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </Shell>
  )
}

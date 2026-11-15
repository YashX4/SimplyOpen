import { useEffect, useState } from 'react'
import { api, type ProjectSummary } from '../api'
import { CardGrid } from '../components/ProjectCard'
import { SearchField } from '../components/Search'
import { Shell, Trouble, Waiting } from '../components/bits'

export function Browse() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.browse()
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <Shell>
      <section className="wrap" style={{ paddingTop: 110, paddingBottom: 120 }}>
        <div className="stack" style={{ alignItems: 'center', gap: 24, textAlign: 'center' }}>
          <p className="lead" style={{ margin: 0 }}>Open projects, made by people like you</p>
          <h1 className="canon hero" style={{ maxWidth: 820 }}>
            Everything here just runs
          </h1>
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginTop: 16 }}>
            <SearchField />
          </div>
          <p className="small" style={{ maxWidth: 520 }}>
            Every one of these is an app for your own computer. Nothing you drop
            into one leaves it.
          </p>
        </div>
      </section>

      <div className="wrap">
        {error ? <Trouble message={error} /> : null}
        {!error && projects === null ? <Waiting what="what people have made" /> : null}
        {projects !== null ? (
          <div className="stack" style={{ gap: 48 }}>
            <h2 className="canon section" style={{ textAlign: 'center' }}>
              People are using
            </h2>
            {projects.length === 0 ? (
              <p className="lead" style={{ textAlign: 'center' }}>
                Nothing has been shared yet. Yours could be the first.
              </p>
            ) : (
              <CardGrid projects={projects} />
            )}
          </div>
        ) : null}
      </div>
    </Shell>
  )
}

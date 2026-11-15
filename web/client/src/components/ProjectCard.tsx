import { Link } from 'react-router-dom'
import type { ProjectSummary } from '../api'
import { Star, Who } from './bits'

/**
 * One project, as it appears in browse and in search results.
 *
 * The whole card is the link, so the target is big and anyone using a
 * keyboard tabs to one thing rather than three.
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link className="panel stack" to={`/p/${project.slug}`} style={{ gap: 12 }}>
      <span className="h3">{project.name}</span>
      <span className="body">{project.description}</span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
        <Who name={project.owner_name} />
        <span className="small">Version {project.version_number}</span>
        {project.stars > 0 ? (
          <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Star />
            {project.stars}
          </span>
        ) : null}
      </span>

      {/* Almost nothing here touches the internet, so the ones that do say so
          before you open the page, not after you have downloaded them. */}
      {project.network_access ? (
        <span className="small" style={{ color: 'var(--clay)' }}>Uses the internet</span>
      ) : null}
    </Link>
  )
}

export function CardGrid({ projects }: { projects: ProjectSummary[] }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 32,
    }}>
      {projects.map((p) => <ProjectCard key={p.slug} project={p} />)}
    </div>
  )
}

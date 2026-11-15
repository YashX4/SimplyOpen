import { Link } from 'react-router-dom'
import type { ProjectSummary } from '../api'
import { Checked, Star } from './bits'
import { Cover, Thumb } from './Cover'
import { s } from '../s'

const SMALL = "font-size:14px;font-variation-settings:'opsz' 20,'slnt' 0,'wdth' 100,'wght' 300"

/** What sits at the foot of a card: the thing most worth knowing about it. */
function Foot({ project }: { project: ProjectSummary }) {
  // Almost nothing here touches the internet, so the ones that do say so
  // before you open the page, not after you have downloaded them.
  if (project.network_access) {
    return <span style={s(`display:inline-flex;align-items:center;gap:6px;color:#b4563c;${SMALL}`)}>Uses the internet</span>
  }
  if (project.stars > 0) {
    return (
      <span style={s(`display:inline-flex;align-items:center;gap:6px;color:rgba(9,23,23,0.64);${SMALL}`)}>
        <Star />{project.stars}
      </span>
    )
  }
  if (project.checked) return <Checked />
  return <span style={s(`color:rgba(9,23,23,0.64);${SMALL}`)}>By {project.owner_name}</span>
}

/**
 * One project on browse. The whole card is the link, so the target is
 * big and a keyboard tabs to one thing rather than three. `size` is the
 * difference between the three across row and the four across row.
 */
export function ProjectCard({ project, size = 'big' }: { project: ProjectSummary; size?: 'big' | 'small' }) {
  const big = size === 'big'
  return (
    <Link className="panel card" to={`/p/${project.slug}`}
      style={s(`display:flex;flex-direction:column;gap:${big ? 18 : 14}px;padding:${big ? 24 : 18}px;text-decoration:none;color:#091717`)}>
      <Cover slug={project.slug} picture={project.picture_url} />
      <div style={s('display:flex;flex-direction:column;gap:7px;flex:1')}>
        <div style={s(big
          ? "font-size:24px;line-height:1.2;letter-spacing:-0.03em;font-variation-settings:'opsz' 24,'slnt' 0,'wdth' 100,'wght' 300"
          : "font-size:20px;line-height:1.2;letter-spacing:-0.03em;font-variation-settings:'opsz' 20,'slnt' 0,'wdth' 100,'wght' 300")}>
          {project.name}
        </div>
        <div style={s("font-size:16px;line-height:1.35;color:rgba(9,23,23,0.64);font-variation-settings:'opsz' 16,'slnt' 0,'wdth' 100,'wght' 300")}>
          {project.description}
        </div>
        <div style={{ flex: 1, minHeight: 12 }} />
        <Foot project={project} />
      </div>
    </Link>
  )
}

/** One project in search results: a row, with the way in at the right. */
export function ProjectRow({ project }: { project: ProjectSummary }) {
  return (
    <Link className="panel card" to={`/p/${project.slug}`}
      style={s('display:flex;align-items:center;gap:22px;padding:20px;text-decoration:none;color:#091717')}>
      <Thumb slug={project.slug} picture={project.picture_url} />
      <span style={s('display:flex;flex-direction:column;gap:6px;flex:1;min-width:180px')}>
        <span className="h3" style={{ fontSize: 20 }}>{project.name}</span>
        <span className="body" style={{ color: 'rgba(9,23,23,0.64)' }}>{project.description}</span>
        <Foot project={{ ...project, stars: 0 }} />
      </span>
      <span className="ghost" style={{ flex: 'none' }}>Get it</span>
    </Link>
  )
}

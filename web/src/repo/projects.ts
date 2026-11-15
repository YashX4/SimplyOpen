import { one, type Db } from '../db.js'
import type { Project, ProjectPage, Visibility } from '../types.js'

export interface ProjectSummary {
  slug: string
  name: string
  description: string
  owner_name: string
  version_number: number
  note: string
  network_access: boolean
  stars: number
  updated_at: string
  /** True once the latest version has passed its checks. */
  checked: boolean
  /** The systems the latest version has a finished build for. */
  systems: string[]
}

/** Everything browse shows. Public only, newest change first. */
export async function listPublic(db: Db, limit = 24, offset = 0): Promise<ProjectSummary[]> {
  const { rows } = await db.query<ProjectSummary>(
    `select p.slug, p.name, p.description, u.name as owner_name,
            v.number as version_number, v.note, v.created_at as updated_at,
            coalesce(c.network_access, false) as network_access,
            coalesce(c.status = 'passed', false) as checked,
            coalesce((select array_agg(b.platform::text order by b.platform) from builds b
                       where b.version_id = v.id and b.status = 'ready'), '{}') as systems,
            (select count(*)::int from stars s where s.project_id = p.id) as stars
     from projects p
     join users u on u.id = p.owner
     join lateral (
       select * from versions where project_id = p.id order by number desc limit 1
     ) v on true
     left join checks c on c.version_id = v.id
     where p.visibility = 'public'
     order by v.created_at desc
     limit $1 offset $2`,
    [limit, offset],
  )
  return rows
}

/**
 * Search, W2 and W3. Name and description only: a handful of projects does
 * not need an index, and a weekend does not need a search engine.
 */
export async function search(db: Db, q: string, limit = 24): Promise<ProjectSummary[]> {
  const term = `%${q.trim()}%`
  const { rows } = await db.query<ProjectSummary>(
    `select p.slug, p.name, p.description, u.name as owner_name,
            v.number as version_number, v.note, v.created_at as updated_at,
            coalesce(c.network_access, false) as network_access,
            coalesce(c.status = 'passed', false) as checked,
            coalesce((select array_agg(b.platform::text order by b.platform) from builds b
                       where b.version_id = v.id and b.status = 'ready'), '{}') as systems,
            (select count(*)::int from stars s where s.project_id = p.id) as stars
     from projects p
     join users u on u.id = p.owner
     join lateral (
       select * from versions where project_id = p.id order by number desc limit 1
     ) v on true
     left join checks c on c.version_id = v.id
     where p.visibility = 'public'
       and (p.name ilike $1 or p.description ilike $1)
     order by (p.name ilike $1) desc, v.created_at desc
     limit $2`,
    [term, limit],
  )
  return rows
}

export async function bySlug(db: Db, slug: string): Promise<Project | null> {
  return one(await db.query<Project>('select * from projects where slug = $1', [slug]))
}

export async function byId(db: Db, id: string): Promise<Project | null> {
  return one(await db.query<Project>('select * from projects where id = $1', [id]))
}

export async function listOwnedBy(db: Db, owner: string): Promise<Project[]> {
  const { rows } = await db.query<Project>(
    'select * from projects where owner = $1 order by created_at desc',
    [owner],
  )
  return rows
}

export interface NewProject {
  owner: string
  slug: string
  name: string
  description?: string
  visibility?: Visibility
}

export async function create(db: Db, input: NewProject): Promise<Project> {
  const row = one(
    await db.query<Project>(
      `insert into projects (owner, slug, name, description, visibility)
       values ($1, $2, $3, $4, $5) returning *`,
      [input.owner, input.slug, input.name, input.description ?? '', input.visibility ?? 'private'],
    ),
  )
  if (!row) throw new Error('project insert returned nothing')
  return row
}

export async function setDetails(db: Db, id: string, name: string, description: string): Promise<void> {
  await db.query('update projects set name = $2, description = $3 where id = $1', [id, name, description])
}

export async function setVisibility(db: Db, id: string, visibility: Visibility): Promise<void> {
  await db.query('update projects set visibility = $2 where id = $1', [id, visibility])
}

/** A slug nobody is using yet. "Zoom transcripts" becomes zoom-transcripts, then -2. */
export async function freeSlug(db: Db, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  for (let n = 0; n < 200; n += 1) {
    const slug = n === 0 ? base : `${base}-${n + 1}`
    const taken = one(await db.query<{ id: string }>('select id from projects where slug = $1', [slug]))
    if (!taken) return slug
  }
  return `${base}-${Date.now()}`
}

/** The whole project page in one call. */
export async function page(db: Db, slug: string): Promise<ProjectPage | null> {
  const project = await bySlug(db, slug)
  if (!project) return null
  const owner = one(
    await db.query<{ id: string; name: string }>('select id, name from users where id = $1', [
      project.owner,
    ]),
  )
  const version = one(
    await db.query<ProjectPage['version']>(
      'select * from versions where project_id = $1 order by number desc limit 1',
      [project.id],
    ),
  )
  if (!owner || !version) return null
  const builds = (
    await db.query<ProjectPage['builds'][number]>(
      `select * from builds where version_id = $1
       order by case platform when 'mac' then 1 when 'windows' then 2 else 3 end`,
      [version.id],
    )
  ).rows
  const check = one(
    await db.query<NonNullable<ProjectPage['check']>>('select * from checks where version_id = $1', [
      version.id,
    ]),
  )
  const counts = one(
    await db.query<{ stars: number; copies: number; waiting: number }>(
      `select (select count(*)::int from stars where project_id = $1) as stars,
              (select count(*)::int from copies where project_id = $1) as copies,
              (select count(*)::int from suggestions
                 where project_id = $1 and state = 'waiting') as waiting`,
      [project.id],
    ),
  )
  return {
    project,
    owner,
    version,
    builds,
    check,
    stars: counts?.stars ?? 0,
    copies: counts?.copies ?? 0,
    waiting_suggestions: counts?.waiting ?? 0,
  }
}

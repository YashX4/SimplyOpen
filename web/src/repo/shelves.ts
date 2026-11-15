/**
 * The home page shelves: Picks from the team, Hot, New this week, and
 * Lists made by people. Only public projects ever appear on a shelf.
 */

import { one, type Db } from '../db.js'

/** One project as a card on a shelf. */
export interface Card {
  slug: string
  name: string
  description: string
  owner_name: string
  stars: number
  copies: number
  /** Whether its newest version passed the automatic checks. */
  checked: boolean
  network_access: boolean
  created_at: string
  /** When its newest version was made. */
  updated_at: string
}

/** A list as a card: its name, who made it, and a peek at what is in it. */
export interface ListCard {
  id: string
  name: string
  owner_name: string
  /** How many public projects are in it. */
  projects: number
  /** The first three, for the little preview. */
  preview: { slug: string; name: string }[]
}

const DAY = 24 * 60 * 60 * 1000

/** How far back "this week" and "recent" reach. */
export const WEEK_DAYS = 7
/** A project stops counting as new enough to be "hot" after this long. */
export const HOT_WINDOW_DAYS = 30

/**
 * Every public project as a card, plus anything `extra` adds. `$1` is
 * always the start of the recent period (one week ago).
 */
const CARDS = `
  select p.id, p.slug, p.name, p.description, u.name as owner_name,
         p.created_at, v.created_at as updated_at,
         coalesce(c.network_access, false) as network_access,
         coalesce(c.status = 'passed', false) as checked,
         (select count(*)::int from stars s where s.project_id = p.id) as stars,
         (select count(*)::int from copies k where k.project_id = p.id) as copies,
         (select count(*)::int from stars s where s.project_id = p.id and s.created_at >= $1) as recent_stars,
         (select count(*)::int from copies k where k.project_id = p.id and k.created_at >= $1) as recent_copies
  from projects p
  join users u on u.id = p.owner
  join lateral (select * from versions where project_id = p.id order by number desc limit 1) v on true
  left join checks c on c.version_id = v.id
  where p.visibility = 'public'`

type Row = Card & { id: string; recent_stars: number; recent_copies: number }

function card(row: Row): Card {
  const { id: _id, recent_stars: _s, recent_copies: _c, ...rest } = row
  return rest
}

/** The team's picks, in the order the team put them. */
export async function picks(db: Db, limit = 6, now = new Date()): Promise<Card[]> {
  const { rows } = await db.query<Row>(
    `select x.* from (${CARDS}) x join picks k on k.project_id = x.id
     order by k.position, k.created_at limit $2`,
    [weekAgo(now), limit],
  )
  return rows.map(card)
}

/** Public projects first shared in the last week, newest first. */
export async function newThisWeek(db: Db, limit = 8, now = new Date()): Promise<Card[]> {
  const { rows } = await db.query<Row>(
    `select x.* from (${CARDS}) x where x.created_at >= $1 order by x.created_at desc limit $2`,
    [weekAgo(now), limit],
  )
  return rows.map(card)
}

/**
 * How "hot" a new project is: what people did with it this week, fading
 * as the project gets older, so something new and liked rises above
 * something old with many stars.
 *
 *   score = (1 + 3 × stars this week + 2 × copies this week) ÷ (age in days + 2)^1.5
 *
 * A star counts a little more than a copy because more people leave one.
 * Everything starts at 1 so a brand new project with nothing yet still
 * shows, below ones people have reacted to.
 */
export function hotScore(recentStars: number, recentCopies: number, ageDays: number): number {
  return (1 + 3 * recentStars + 2 * recentCopies) / Math.pow(Math.max(ageDays, 0) + 2, 1.5)
}

/** Hot new projects: shared in the last 30 days, highest score first. */
export async function hot(db: Db, limit = 8, now = new Date()): Promise<Card[]> {
  const { rows } = await db.query<Row>(`select x.* from (${CARDS}) x where x.created_at >= $2`, [
    weekAgo(now),
    new Date(now.getTime() - HOT_WINDOW_DAYS * DAY).toISOString(),
  ])
  const age = (row: Row): number => (now.getTime() - new Date(row.created_at).getTime()) / DAY
  return rows
    .map((row) => ({ row, score: hotScore(row.recent_stars, row.recent_copies, age(row)) }))
    .sort((a, b) => b.score - a.score || age(a.row) - age(b.row))
    .slice(0, limit)
    .map(({ row }) => card(row))
}

/** Lists with at least one public project in them, the fullest first. */
export async function lists(db: Db, limit = 6): Promise<ListCard[]> {
  const { rows } = await db.query<{ id: string; name: string; owner_name: string; projects: number }>(
    `select l.id, l.name, u.name as owner_name, count(*)::int as projects
     from lists l
     join users u on u.id = l.owner
     join list_items i on i.list_id = l.id
     join projects p on p.id = i.project_id and p.visibility = 'public'
     group by l.id, l.name, u.name, l.created_at
     order by count(*) desc, l.created_at desc
     limit $1`,
    [limit],
  )
  const out: ListCard[] = []
  for (const row of rows) {
    const preview = await db.query<{ slug: string; name: string }>(
      `select p.slug, p.name from list_items i join projects p on p.id = i.project_id
       where i.list_id = $1 and p.visibility = 'public' order by i.created_at limit 3`,
      [row.id],
    )
    out.push({ ...row, preview: preview.rows })
  }
  return out
}

export interface ListRow {
  id: string
  owner: string
  name: string
  created_at: string
}

export async function listById(db: Db, id: string): Promise<ListRow | null> {
  return one(await db.query<ListRow>('select * from lists where id = $1', [id]))
}

/** The public projects in a list, in the order they were added. */
export async function listProjects(db: Db, listId: string, now = new Date()): Promise<Card[]> {
  const { rows } = await db.query<Row>(
    `select x.* from (${CARDS}) x join list_items i on i.project_id = x.id
     where i.list_id = $2 order by i.created_at`,
    [weekAgo(now), listId],
  )
  return rows.map(card)
}

export async function createList(db: Db, owner: string, name: string): Promise<ListRow> {
  const row = one(await db.query<ListRow>('insert into lists (owner, name) values ($1, $2) returning *', [owner, name]))
  if (!row) throw new Error('list insert returned nothing')
  return row
}

export async function deleteList(db: Db, id: string): Promise<void> {
  await db.query('delete from lists where id = $1', [id])
}

export async function addToList(db: Db, listId: string, projectId: string): Promise<void> {
  await db.query('insert into list_items (list_id, project_id) values ($1, $2) on conflict do nothing', [listId, projectId])
}

export async function removeFromList(db: Db, listId: string, projectId: string): Promise<void> {
  await db.query('delete from list_items where list_id = $1 and project_id = $2', [listId, projectId])
}

/** Make a project a team pick, at the end of the shelf unless a position is given. */
export async function pick(db: Db, projectId: string, pickedBy: string, position?: number): Promise<void> {
  await db.query(
    `insert into picks (project_id, picked_by, position)
     values ($1, $2, coalesce($3, (select coalesce(max(position), 0) + 1 from picks)))
     on conflict (project_id) do update set position = coalesce($3, picks.position)`,
    [projectId, pickedBy, position ?? null],
  )
}

export async function unpick(db: Db, projectId: string): Promise<void> {
  await db.query('delete from picks where project_id = $1', [projectId])
}

/** Whether this person is on the team: their address is on the team list, and they have proved it is theirs. */
export async function isTeam(db: Db, userId: string, teamEmails: readonly string[]): Promise<boolean> {
  const user = one(
    await db.query<{ email: string; email_verified_at: string | null }>('select email, email_verified_at from users where id = $1', [userId]),
  )
  if (!user || !user.email_verified_at) return false
  return teamEmails.some((email) => email.trim().toLowerCase() === user.email.toLowerCase())
}

function weekAgo(now: Date): string {
  return new Date(now.getTime() - WEEK_DAYS * DAY).toISOString()
}

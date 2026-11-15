/**
 * The facts a project page shows around the project itself: how many
 * people starred and copied it, how many versions it has, which systems it
 * is ready for, and what it touches on a person's computer.
 *
 * Facts only. The page's own templates turn them into sentences ("Nothing.
 * It runs on your computer only."), so the wording can never claim more
 * than was found.
 */

import { one, type Db } from '../db.js'
import type { BuildStatus, Platform, Project } from '../types.js'

/** What the project touches, read from the Analyzer's manifest for the latest version. */
export interface Touches {
  /** What it reads: the labels of the files and folders the person gives it. */
  reads: string[]
  /** What it saves: the labels of the files and folders it writes. */
  saves: string[]
  /** Whether it can reach the internet. */
  internet: boolean
  /** "Anything else". All false or empty means nothing else. */
  other: {
    /** It starts other programs. */
    runs_other_programs: boolean
    /** Settings it reads from the computer (environment variables), by name. */
    reads_settings: string[]
    /** It reads or writes files beyond the ones the person picks. */
    reaches_other_files: boolean
  }
}

export interface ProjectFacts {
  stars: number
  /** How many copies people have made ("forks"). */
  copies: number
  versions: number
  waiting_suggestions: number
  created_at: string
  /** When the latest version was made. */
  updated_at: string
  latest_version: { number: number; note: string; created_at: string }
  /** One entry per system the latest version was built for. */
  systems: { platform: Platform; status: BuildStatus; size_bytes: number | null }[]
  /** Whether the latest version passed the automatic checks. */
  checked: boolean
  /** Null when there is no manifest for the latest version (nothing can be said). */
  touches: Touches | null
  /** About the person asking; null when nobody is signed in. */
  you: { starred: boolean; copy_ids: string[]; is_owner: boolean } | null
}

/** The facts for one project the viewer is allowed to see. Null if it has no version yet. */
export async function forProject(db: Db, project: Project, viewerId: string | null): Promise<ProjectFacts | null> {
  const latest = one(
    await db.query<{ id: string; number: number; note: string; created_at: string }>(
      'select id, number, note, created_at from versions where project_id = $1 order by number desc limit 1',
      [project.id],
    ),
  )
  if (!latest) return null

  const counts = one(
    await db.query<{ stars: number; copies: number; versions: number; waiting: number }>(
      `select (select count(*)::int from stars where project_id = $1) as stars,
              (select count(*)::int from copies where project_id = $1) as copies,
              (select count(*)::int from versions where project_id = $1) as versions,
              (select count(*)::int from suggestions where project_id = $1 and state = 'waiting') as waiting`,
      [project.id],
    ),
  )
  const systems = (
    await db.query<ProjectFacts['systems'][number]>(
      `select platform, status, size_bytes from builds where version_id = $1
       order by case platform when 'mac' then 1 when 'windows' then 2 else 3 end`,
      [latest.id],
    )
  ).rows
  const check = one(
    await db.query<{ status: string; manifest: unknown; network_access: boolean }>(
      'select status, manifest, network_access from checks where version_id = $1',
      [latest.id],
    ),
  )

  let you: ProjectFacts['you'] = null
  if (viewerId) {
    const starred = one(await db.query('select 1 from stars where project_id = $1 and user_id = $2', [project.id, viewerId]))
    const mine = await db.query<{ id: string }>(
      'select id from copies where project_id = $1 and owner = $2 order by created_at',
      [project.id, viewerId],
    )
    you = { starred: starred !== null, copy_ids: mine.rows.map((r) => r.id), is_owner: project.owner === viewerId }
  }

  return {
    stars: counts?.stars ?? 0,
    copies: counts?.copies ?? 0,
    versions: counts?.versions ?? 0,
    waiting_suggestions: counts?.waiting ?? 0,
    created_at: project.created_at,
    updated_at: latest.created_at,
    latest_version: { number: latest.number, note: latest.note, created_at: latest.created_at },
    systems,
    checked: check?.status === 'passed',
    touches: check?.manifest ? touchesFrom(check.manifest, check.network_access) : null,
    you,
  }
}

/**
 * Read "what it touches" out of a manifest. The manifest came from an AI
 * reading the code, so every field is treated as possibly missing or the
 * wrong type, and anything unclear counts as touching (never as "nothing").
 */
export function touchesFrom(manifest: unknown, networkAccess: boolean): Touches {
  const m = record(manifest)
  const capabilities = record(m.capabilities)
  const labels = (list: unknown): string[] =>
    (Array.isArray(list) ? list : [])
      .map(record)
      .filter((item) => item.kind === 'file' || item.kind === 'folder')
      .map((item) => (typeof item.label === 'string' ? item.label.trim() : ''))
      .filter((label) => label !== '')
  const settings = Array.isArray(capabilities.reads_env_vars)
    ? capabilities.reads_env_vars.filter((name): name is string => typeof name === 'string')
    : []
  return {
    reads: labels(m.inputs),
    saves: labels(m.outputs),
    internet: networkAccess || capabilities.network_access === true,
    other: {
      runs_other_programs: capabilities.runs_other_programs !== false,
      reads_settings: settings,
      reaches_other_files: capabilities.filesystem_access !== 'none' && capabilities.filesystem_access !== 'declared_inputs_outputs_only',
    },
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Take a star back. Returns how many stars are left. */
export async function unstar(db: Db, projectId: string, userId: string): Promise<number> {
  await db.query('delete from stars where project_id = $1 and user_id = $2', [projectId, userId])
  return one(await db.query<{ n: number }>('select count(*)::int as n from stars where project_id = $1', [projectId]))?.n ?? 0
}

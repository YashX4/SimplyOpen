import { one, type Db } from '../db.js'
import type { Build, Check, Platform, Version } from '../types.js'

export interface NewVersion {
  project_id: string
  note: string
  created_by: string
  suggested_by?: string | null
  source_zip_url?: string | null
  build_id?: string | null
}

/**
 * Append a version. The number is handed out inside the statement, so two
 * writers cannot both make version 5; the unique index would reject the
 * loser anyway, but this way there is nothing to retry.
 */
export async function append(db: Db, input: NewVersion): Promise<Version> {
  const row = one(
    await db.query<Version>(
      `insert into versions (project_id, number, note, created_by, suggested_by,
                             source_zip_url, build_id)
       values ($1,
               (select coalesce(max(number), 0) + 1 from versions where project_id = $1),
               $2, $3, $4, $5, $6)
       returning *`,
      [
        input.project_id,
        input.note,
        input.created_by,
        input.suggested_by ?? null,
        input.source_zip_url ?? null,
        input.build_id ?? null,
      ],
    ),
  )
  if (!row) throw new Error('version insert returned nothing')
  return row
}

export async function list(db: Db, projectId: string): Promise<Version[]> {
  const { rows } = await db.query<Version>(
    'select * from versions where project_id = $1 order by number desc',
    [projectId],
  )
  return rows
}

export async function latest(db: Db, projectId: string): Promise<Version | null> {
  return one(
    await db.query<Version>(
      'select * from versions where project_id = $1 order by number desc limit 1',
      [projectId],
    ),
  )
}

export async function byNumber(db: Db, projectId: string, number: number): Promise<Version | null> {
  return one(
    await db.query<Version>('select * from versions where project_id = $1 and number = $2', [
      projectId,
      number,
    ]),
  )
}

export async function byId(db: Db, id: string): Promise<Version | null> {
  return one(await db.query<Version>('select * from versions where id = $1', [id]))
}

/** A version made before its files were known, as taking a suggestion does, gets them here. */
export async function setSource(db: Db, versionId: string, sourceZipUrl: string, buildId: string): Promise<void> {
  await db.query('update versions set source_zip_url = $2, build_id = $3 where id = $1', [
    versionId,
    sourceZipUrl,
    buildId,
  ])
}

export async function setBuildId(db: Db, versionId: string, buildId: string): Promise<void> {
  await db.query('update versions set build_id = $2 where id = $1', [versionId, buildId])
}

/** One version with everything hanging off it, for V2. */
export interface VersionDetail {
  version: Version
  builds: Build[]
  check: Check | null
  author_name: string
  suggester_name: string | null
  /** When it came from a suggestion: which one, and its Before and Now rows. */
  suggestion_id: string | null
  changes: { title: string; before_text: string; after_text: string }[]
}

export async function detail(db: Db, versionId: string): Promise<VersionDetail | null> {
  const version = await byId(db, versionId)
  if (!version) return null
  const builds = (
    await db.query<Build>(
      `select * from builds where version_id = $1
       order by case platform when 'mac' then 1 when 'windows' then 2 else 3 end`,
      [versionId],
    )
  ).rows
  const check = one(await db.query<Check>('select * from checks where version_id = $1', [versionId]))
  const author = one(
    await db.query<{ name: string }>('select name from users where id = $1', [version.created_by]),
  )
  const suggester = version.suggested_by
    ? one(await db.query<{ name: string }>('select name from users where id = $1', [version.suggested_by]))
    : null
  const from = one(
    await db.query<{ id: string }>('select id from suggestions where taken_version_id = $1', [versionId]),
  )
  const changes = from
    ? (
        await db.query<{ title: string; before_text: string; after_text: string }>(
          `select title, before_text, after_text from suggestion_changes
           where suggestion_id = $1 and included order by position`,
          [from.id],
        )
      ).rows
    : []
  return {
    version,
    builds,
    check,
    author_name: author?.name ?? '',
    suggester_name: suggester?.name ?? null,
    suggestion_id: from?.id ?? null,
    changes,
  }
}

/** Every version of a project with its platform readiness folded in, for V1. */
export interface VersionRow extends Version {
  author_name: string
  suggester_name: string | null
  systems_ready: number
  check_status: string | null
}

export async function listForPage(db: Db, projectId: string): Promise<VersionRow[]> {
  const { rows } = await db.query<VersionRow>(
    `select v.*, u.name as author_name, s.name as suggester_name,
            (select count(*)::int from builds b
               where b.version_id = v.id and b.status = 'ready') as systems_ready,
            c.status as check_status
     from versions v
     join users u on u.id = v.created_by
     left join users s on s.id = v.suggested_by
     left join checks c on c.version_id = v.id
     where v.project_id = $1
     order by v.number desc`,
    [projectId],
  )
  return rows
}

/** What the download route resolves. */
export async function buildFor(
  db: Db,
  versionId: string,
  platform: Platform,
): Promise<Build | null> {
  return one(
    await db.query<Build>('select * from builds where version_id = $1 and platform = $2', [
      versionId,
      platform,
    ]),
  )
}

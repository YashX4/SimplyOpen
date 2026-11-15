import { one, type Db } from '../db.js'
import type { Build, BuildStatus, Check, CheckStatus, Confidence, Platform } from '../types.js'

export const PLATFORMS: Platform[] = ['mac', 'windows', 'linux']

/**
 * Open three build rows for a version, one per system, all waiting.
 * Called the moment the version exists, before the Factory is told anything,
 * so P6 has something to draw straight away.
 */
export async function open(db: Db, versionId: string, declared: string[] = []): Promise<Build[]> {
  const says = new Set(declared.map((d) => d.toLowerCase()))
  const out: Build[] = []
  for (const platform of PLATFORMS) {
    // The manifest calls it macos; everything else here calls it mac.
    const named = platform === 'mac' ? 'macos' : platform
    const cannot = says.size > 0 && !says.has(named)
    const row = one(
      await db.query<Build>(
        `insert into builds (version_id, platform, status, message)
         values ($1, $2, $3, $4)
         on conflict (version_id, platform) do update set status = excluded.status
         returning *`,
        [
          versionId,
          platform,
          cannot ? 'cannot' : 'waiting',
          cannot ? 'The project does not say it works on this system.' : '',
        ],
      ),
    )
    if (row) out.push(row)
  }
  return out
}

export interface BuildUpdate {
  status: BuildStatus
  message?: string
  download_url?: string | null
  size_bytes?: number | null
  /** Set when the app is too big to copy and stays with the Factory. */
  artifact_id?: number | null
}

export async function update(
  db: Db,
  versionId: string,
  platform: Platform,
  patch: BuildUpdate,
): Promise<Build | null> {
  return one(
    await db.query<Build>(
      `update builds
          set status = $3,
              message = coalesce($4, message),
              download_url = coalesce($5, download_url),
              size_bytes = coalesce($6, size_bytes),
              artifact_id = coalesce($7, artifact_id)
        where version_id = $1 and platform = $2
        returning *`,
      [
        versionId,
        platform,
        patch.status,
        patch.message ?? null,
        patch.download_url ?? null,
        patch.size_bytes ?? null,
        patch.artifact_id ?? null,
      ],
    ),
  )
}

export async function list(db: Db, versionId: string): Promise<Build[]> {
  const { rows } = await db.query<Build>(
    `select * from builds where version_id = $1
     order by case platform when 'mac' then 1 when 'windows' then 2 else 3 end`,
    [versionId],
  )
  return rows
}

/**
 * Which screen the publish flow should show once the builds settle.
 * P7 when every system that could build did. P8 when some made it and
 * some did not. P9 when the project only ever claimed one system.
 */
export function outcome(builds: Build[]): 'waiting' | 'all' | 'partial' | 'none' {
  if (builds.some((b) => b.status === 'waiting' || b.status === 'building')) return 'waiting'
  const ready = builds.filter((b) => b.status === 'ready')
  if (ready.length === 0) return 'none'
  if (ready.length === builds.length) return 'all'
  return 'partial'
}

export interface NewCheck {
  version_id: string
  status: CheckStatus
  summary: string
  manifest?: unknown
  network_access?: boolean
  operating_systems?: string[]
  confidence?: Confidence | null
}

export async function recordCheck(db: Db, input: NewCheck): Promise<Check> {
  const row = one(
    await db.query<Check>(
      `insert into checks (version_id, status, summary, manifest, network_access,
                           operating_systems, confidence)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (version_id) do update set
         status = excluded.status, summary = excluded.summary,
         manifest = excluded.manifest, network_access = excluded.network_access,
         operating_systems = excluded.operating_systems, confidence = excluded.confidence
       returning *`,
      [
        input.version_id,
        input.status,
        input.summary,
        input.manifest === undefined ? null : JSON.stringify(input.manifest),
        input.network_access ?? false,
        input.operating_systems ?? [],
        input.confidence ?? null,
      ],
    ),
  )
  if (!row) throw new Error('check insert returned nothing')
  return row
}

export async function checkFor(db: Db, versionId: string): Promise<Check | null> {
  return one(await db.query<Check>('select * from checks where version_id = $1', [versionId]))
}

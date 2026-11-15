/**
 * The API, typed. Everything on the browsing path works with no
 * account, which is the promise the whole product rests on. The session
 * cookie rides along on its own for the few things that do need one.
 */

export type Platform = 'mac' | 'windows' | 'linux'
export type BuildStatus = 'waiting' | 'building' | 'ready' | 'failed' | 'cannot'

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
  systems: Platform[]
}

export interface Me {
  id: string
  name: string
  email: string
}

/** One line of a project's history, as the versions panel shows it. */
export interface VersionRow {
  id: string
  number: number
  note: string
  created_at: string
  author_name: string
  suggester_name: string | null
  systems_ready: number
  check_status: string | null
}

export interface Build {
  id: string
  platform: Platform
  status: BuildStatus
  message: string
  download_url: string | null
  size_bytes: number | null
}

export interface Check {
  status: 'passed' | 'failed' | 'unavailable'
  summary: string
  network_access: boolean
  operating_systems: string[]
  confidence: 'high' | 'medium' | 'low' | null
  manifest: {
    capabilities?: { runs_other_programs?: boolean; reads_env_vars?: string[] }
  } | null
}

export interface ProjectPage {
  project: {
    id: string
    slug: string
    name: string
    description: string
    visibility: 'private' | 'link' | 'public'
  }
  owner: { id: string; name: string }
  version: {
    id: string
    number: number
    note: string
    created_at: string
    suggested_by: string | null
  }
  builds: Build[]
  check: Check | null
  stars: number
  copies: number
  waiting_suggestions: number
  can_edit: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
  }
}

/** In development the usual reason for a failure is that the API is not running. */
const UNREACHABLE = import.meta.env.DEV
  ? 'The website could not reach its own server. Start it with npm run dev in the web folder, then try again.'
  : 'Something went wrong at our end.'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { ...init, headers: { accept: 'application/json', ...init?.headers } })
  } catch {
    throw new ApiError(UNREACHABLE, 0, 'UNREACHABLE')
  }
  const body = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null
  if (!response.ok) {
    throw new ApiError(
      body?.error?.message ?? (response.status >= 500 ? UNREACHABLE : 'Something went wrong at our end.'),
      response.status,
      body?.error?.code ?? 'UNKNOWN',
    )
  }
  if (body === null) throw new ApiError(UNREACHABLE, response.status, 'UNREACHABLE')
  return body as T
}

const get = <T,>(path: string) => call<T>(path)
const post = <T,>(path: string) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })

export const api = {
  browse: () => get<{ projects: ProjectSummary[] }>('/api/browse'),
  search: (q: string) =>
    get<{ q: string; projects: ProjectSummary[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  project: (slug: string) => get<ProjectPage>(`/api/projects/${encodeURIComponent(slug)}`),
  versions: (slug: string) =>
    get<{ versions: VersionRow[] }>(`/api/projects/${encodeURIComponent(slug)}/versions`),
  me: () => get<{ user: Me | null }>('/api/me'),
  star: (slug: string) => post<{ stars: number }>(`/api/projects/${encodeURIComponent(slug)}/star`),
  copy: (slug: string) => post<{ copy: { id: string } }>(`/api/projects/${encodeURIComponent(slug)}/copies`),
  downloadUrl: (versionId: string, platform: Platform) => `/api/download/${versionId}/${platform}`,
}

/** "mac" is what the API calls it. "Mac" is what a person calls it. */
export const SYSTEM_NAME: Record<Platform, string> = {
  mac: 'Mac',
  windows: 'Windows',
  linux: 'Linux',
}

export function readableSize(bytes: number | null): string {
  if (!bytes) return ''
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

export function readableDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

/** A colour per person, steady across the site, from their name. */
export function colourFor(name: string): string {
  const palette = ['#2f6f6a', '#3b63a8', '#b4563c', '#8f826e', '#6b5ca8']
  let n = 0
  for (const ch of name) n = (n + ch.charCodeAt(0)) % palette.length
  return palette[n] ?? '#6b5ca8'
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}

/** Which system the person is most likely sitting at. */
export function thisSystem(): Platform {
  const hint = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  if (hint.includes('win')) return 'windows'
  if (hint.includes('mac') || hint.includes('iphone') || hint.includes('ipad')) return 'mac'
  if (hint.includes('linux') || hint.includes('x11')) return 'linux'
  return 'mac'
}

/** "Mac, Windows and Linux", from whatever is actually there. */
export function systemsLine(systems: Platform[]): string {
  const names = (['mac', 'windows', 'linux'] as Platform[])
    .filter((p) => systems.includes(p))
    .map((p) => SYSTEM_NAME[p])
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

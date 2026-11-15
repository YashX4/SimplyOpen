/**
 * The API, typed. Everything on the browsing path works with no
 * account, which is the promise the whole product rests on, so nothing
 * here sends credentials or expects a session.
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

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null
    throw new ApiError(
      body?.error?.message ?? 'Something went wrong at our end.',
      response.status,
      body?.error?.code ?? 'UNKNOWN',
    )
  }
  return (await response.json()) as T
}

export const api = {
  browse: () => get<{ projects: ProjectSummary[] }>('/api/browse'),
  search: (q: string) =>
    get<{ q: string; projects: ProjectSummary[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  project: (slug: string) => get<ProjectPage>(`/api/projects/${encodeURIComponent(slug)}`),
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
  const palette = ['#6b5ca8', '#2f6f6a', '#3b63a8', '#b4563c', '#8f826e']
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

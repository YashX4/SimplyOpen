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

export type Visibility = 'private' | 'link' | 'public'

export interface VersionDetail {
  version: ProjectPage['version'] & { project_id: string }
  builds: Build[]
  check: Check | null
  author_name: string
  suggester_name: string | null
  suggestion_id: string | null
  changes: { title: string; before_text: string; after_text: string }[]
}

export interface RefreshResult {
  found: boolean
  finished: boolean
  builds: Build[]
  outcome: 'waiting' | 'all' | 'partial' | 'none'
}

export interface UploadResult {
  project: ProjectPage['project']
  version: { id: string; number: number }
  builds: Build[]
  simple_window: boolean
}

export interface SuggestionDetail {
  suggestion: {
    id: string
    copy_id: string
    project_id: string
    author: string
    note: string
    state: 'waiting' | 'taken' | 'left' | 'withdrawn'
    taken_version_id: string | null
    created_at: string
  }
  changes: { id: string; title: string; before_text: string; after_text: string; included: boolean }[]
  author_name: string
  project_slug: string
}

export interface MyThings {
  made: {
    project: ProjectPage['project']
    version: { id: string; number: number; note: string; created_at: string } | null
    waiting: number
    stars: number
  }[]
  copies: {
    copy: { id: string; name: string; created_at: string }
    project: ProjectPage['project'] | null
    from_version: { id: string; number: number } | null
  }[]
  waiting_suggestions: number
}

export interface ChatVersion {
  number: number
  label: string
  createdAt: string
  changes: { path: string; change: string }[]
  checks?: { status: 'passed' | 'failed' | 'unavailable'; summary: string } | null
}

export interface ChatInfo {
  id: string
  kind: 'maker' | 'copy'
  project: { slug: string; name: string }
  copy_id: string | null
  from_version: number
  started_at: string
}

export interface ChatStart { chat: ChatInfo; versions: ChatVersion[] }

export type ChatAnswer =
  | { kind: 'reply'; reply: string; version: ChatVersion | null; readyToDownload: { version: number } | null; stoppedEarly: boolean }
  | { kind: 'privacy_reminder'; reminder: string; found: string[] }

export interface CopyDetail {
  copy: { id: string; name: string; created_at: string; changed: boolean }
  project: { slug: string; name: string; maker: string } | null
  from_version: { id: string; number: number; note: string } | null
  suggestions: { id: string; state: 'waiting' | 'taken' | 'left' | 'withdrawn'; note: string; created_at: string }[]
  chat: ChatInfo | null
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
    visibility: Visibility
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
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
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
const send = <T,>(method: 'POST' | 'PATCH', path: string, body: unknown = {}) =>
  call<T>(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const post = <T,>(path: string, body?: unknown) => send<T>('POST', path, body)
const slugged = (slug: string) => `/api/projects/${encodeURIComponent(slug)}`

export const api = {
  browse: () => get<{ projects: ProjectSummary[] }>('/api/browse'),
  search: (q: string) =>
    get<{ q: string; projects: ProjectSummary[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  project: (slug: string) => get<ProjectPage>(slugged(slug)),
  versions: (slug: string) => get<{ versions: VersionRow[] }>(`${slugged(slug)}/versions`),
  version: (id: string) => get<VersionDetail>(`/api/versions/${id}`),
  refresh: (id: string) => post<RefreshResult>(`/api/versions/${id}/refresh`),
  me: () => get<{ user: Me | null; waiting_suggestions?: number }>('/api/me'),
  things: () => get<MyThings>('/api/me/things'),
  star: (slug: string) => post<{ stars: number }>(`${slugged(slug)}/star`),
  copy: (slug: string) => post<{ copy: { id: string } }>(`${slugged(slug)}/copies`),
  rename: (slug: string, name: string, description: string) =>
    send<{ project: ProjectPage['project'] }>('PATCH', slugged(slug), { name, description }),
  show: (slug: string, visibility: Visibility) =>
    send<{ visibility: Visibility }>('PATCH', `${slugged(slug)}/visibility`, { visibility }),
  suggestionsFor: (slug: string) => get<{ suggestions: SuggestionDetail[] }>(`${slugged(slug)}/suggestions`),
  suggestion: (id: string) => get<SuggestionDetail>(`/api/suggestions/${id}`),
  take: (id: string, note: string) =>
    post<{ version: { id: string; number: number; note: string } }>(`/api/suggestions/${id}/take`, { note }),
  leave: (id: string) => post<{ suggestion: SuggestionDetail['suggestion'] }>(`/api/suggestions/${id}/leave`),
  signUp: (body: { username: string; email: string; password: string; name: string }) =>
    post<{ user: Me }>('/api/auth/sign-up', body),
  signIn: (login: string, password: string) => post<{ user: Me }>('/api/auth/sign-in', { login, password }),
  emailLink: (email: string) => post<{ sent: true; link?: string }>('/api/auth/link', { email }),
  name: (name: string) => send<{ user: Me }>('PATCH', '/api/me', { name }),
  finishSignIn: (token: string) =>
    get<{ user: Me }>(`/api/auth/callback?token=${encodeURIComponent(token)}`),
  signOut: () => post<{ signed_out: true }>('/api/auth/sign-out'),
  /** P1. The zip goes up whole; the answer comes back once it has been read. */
  upload: (file: File, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return call<UploadResult>('/api/projects', { method: 'POST', body: form, signal })
  },
  downloadUrl: (versionId: string, platform: Platform) => `/api/download/${versionId}/${platform}`,

  /* Changing it by chatting, C1 to C11, and copies, Y1 to Y3. */
  chatOnMine: (slug: string) => post<ChatStart>(`${slugged(slug)}/chats`),
  chatOnCopy: (copyId: string) => post<ChatStart>(`/api/copies/${copyId}/chats`),
  chat: (id: string) => get<ChatStart>(`/api/chats/${id}`),
  say: (id: string, message: string, confirmPrivate = false) =>
    post<ChatAnswer>(`/api/chats/${id}/messages`, confirmPrivate ? { message, confirmPrivate } : { message }),
  undo: (id: string) => post<{ version: ChatVersion | null }>(`/api/chats/${id}/undo`),
  restore: (id: string, n: number) => post<{ version: ChatVersion | null }>(`/api/chats/${id}/versions/${n}/restore`),
  release: (id: string, note: string) =>
    post<{ version: { id: string; number: number }; project: { slug: string } }>(`/api/chats/${id}/release`, { note }),
  keep: (id: string) => post<{ kept: true }>(`/api/chats/${id}/keep`),
  endChat: (id: string) => call<unknown>(`/api/chats/${id}`, { method: 'DELETE' }).catch(() => undefined),
  copyOf: (id: string) => get<CopyDetail>(`/api/copies/${id}`),
  suggestFrom: (copyId: string, note: string, changes: { title: string; before?: string; after?: string }[]) =>
    post<{ suggestion: { id: string } }>(`/api/copies/${copyId}/suggestions`, { note, changes }),
}

/** "mac" is what the API calls it. "Mac" is what a person calls it. */
export const SYSTEM_NAME: Record<Platform, string> = {
  mac: 'Mac',
  windows: 'Windows',
  linux: 'Linux',
}

export function readableSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
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

/** "10 minutes ago", "Yesterday", "3 days ago", then the date. */
export function readableAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return minutes === 1 ? 'A minute ago' : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'An hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return readableDate(iso)
}

export const SEEN_BY: Record<Visibility, string> = {
  private: 'only you can see it',
  link: 'anyone with the link',
  public: 'shared',
}

/** Small numbers as words, the way the boards write them. */
export function inWords(n: number): string {
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
  return words[n] ?? String(n)
}

/** What to call someone who has not said yet: the start of their email address. */
export function displayName(me: { name: string; email: string }): string {
  return me.name.trim() || me.email.split('@')[0] || 'You'
}

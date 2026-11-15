/** Row shapes, one per table, named the way the pages talk about them. */

export type Visibility = 'private' | 'link' | 'public'
export type Platform = 'mac' | 'windows' | 'linux'
export type BuildStatus = 'waiting' | 'building' | 'ready' | 'failed' | 'cannot'
export type CheckStatus = 'passed' | 'failed' | 'unavailable'
export type Confidence = 'high' | 'medium' | 'low'
export type SuggestionState = 'waiting' | 'taken' | 'left' | 'withdrawn'

export interface User {
  id: string
  email: string
  name: string
  created_at: string
}

export interface Project {
  id: string
  owner: string
  slug: string
  name: string
  description: string
  visibility: Visibility
  created_at: string
}

export interface Version {
  id: string
  project_id: string
  number: number
  note: string
  source_zip_url: string | null
  created_by: string
  suggested_by: string | null
  build_id: string | null
  /** A picture of the app's real window, once a build has taken one. */
  picture_url?: string | null
  created_at: string
}

export interface Build {
  id: string
  version_id: string
  platform: Platform
  status: BuildStatus
  message: string
  download_url: string | null
  size_bytes: number | null
  artifact_id: number | null
  created_at: string
}

export interface Check {
  id: string
  version_id: string
  status: CheckStatus
  summary: string
  manifest: unknown
  network_access: boolean
  operating_systems: string[]
  confidence: Confidence | null
  created_at: string
}

export interface Copy {
  id: string
  project_id: string
  owner: string
  from_version_id: string
  name: string
  working_zip_url: string | null
  created_at: string
}

export interface Suggestion {
  id: string
  copy_id: string
  project_id: string
  author: string
  note: string
  state: SuggestionState
  taken_version_id: string | null
  created_at: string
  decided_at: string | null
}

export interface SuggestionChange {
  id: string
  suggestion_id: string
  position: number
  title: string
  before_text: string
  after_text: string
  included: boolean
}

/** What a project page needs, in one object. */
export interface ProjectPage {
  project: Project
  owner: Pick<User, 'id' | 'name'>
  version: Version
  builds: Build[]
  check: Check | null
  stars: number
  copies: number
  waiting_suggestions: number
}

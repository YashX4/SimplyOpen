/**
 * Starts a build on GitHub Actions and reads back how it went.
 *
 * Their workflow is .github/workflows/build.yml. It takes build_id,
 * project_url, app_url and sample_url, names the run "Build <build_id>",
 * and runs a three way matrix named Mac, Windows and Linux with
 * fail-fast off, so each system reports its own result.
 */

import type { BuildStatus, Platform } from '../types.js'
import { unwrapSingleZip } from './unwrap.js'

export interface DispatchInput {
  buildId: string
  projectUrl: string
  appUrl: string
  sampleUrl?: string
}

export interface PlatformResult {
  platform: Platform
  status: BuildStatus
  message: string
}

export interface RunState {
  found: boolean
  finished: boolean
  platforms: PlatformResult[]
  runId?: number
  /** Where the built zips are, once the run finished. */
  artifacts: { platform: Platform; name: string; id: number; size: number }[]
}

export interface Factory {
  dispatch(input: DispatchInput): Promise<void>
  read(buildId: string): Promise<RunState>
  download(artifactId: number): Promise<Uint8Array>
}

const JOB_PLATFORM: Record<string, Platform> = {
  mac: 'mac',
  windows: 'windows',
  linux: 'linux',
}

/** "Build for Mac" and "app-Mac" both end in the system's name. */
export function platformFromName(name: string): Platform | null {
  const last = name.trim().split(/[\s-]+/).pop()?.toLowerCase() ?? ''
  return JOB_PLATFORM[last] ?? null
}

/** GitHub's job words, turned into ours. */
export function statusFromJob(status: string, conclusion: string | null): BuildStatus {
  if (status === 'queued' || status === 'waiting' || status === 'pending') return 'waiting'
  if (status === 'in_progress') return 'building'
  if (conclusion === 'success') return 'ready'
  return 'failed'
}

export class GithubFactory implements Factory {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
    private readonly workflow = 'build.yml',
    private readonly ref = 'main',
  ) {}

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`https://api.github.com/repos/${this.owner}/${this.repo}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        ...(init.headers ?? {}),
      },
    })
  }

  async dispatch(input: DispatchInput): Promise<void> {
    const response = await this.api(`/actions/workflows/${this.workflow}/dispatches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ref: this.ref,
        inputs: {
          build_id: input.buildId,
          project_url: input.projectUrl,
          app_url: input.appUrl,
          sample_url: input.sampleUrl ?? '',
        },
      }),
    })
    if (!response.ok) {
      throw new Error(`Could not start the build: ${response.status} ${await response.text()}`)
    }
  }

  async read(buildId: string): Promise<RunState> {
    const runs = await this.api(`/actions/workflows/${this.workflow}/runs?per_page=30`)
    if (!runs.ok) throw new Error(`Could not read the builds: ${runs.status}`)
    const body = (await runs.json()) as {
      workflow_runs?: { id: number; name?: string; status: string; conclusion: string | null }[]
    }
    const run = (body.workflow_runs ?? []).find((r) => r.name === `Build ${buildId}`)
    if (!run) return { found: false, finished: false, platforms: [], artifacts: [] }

    const jobsResponse = await this.api(`/actions/runs/${run.id}/jobs?per_page=30`)
    const jobs = jobsResponse.ok
      ? ((await jobsResponse.json()) as {
          jobs?: { name: string; status: string; conclusion: string | null }[]
        }).jobs ?? []
      : []

    const platforms: PlatformResult[] = []
    for (const job of jobs) {
      const platform = platformFromName(job.name)
      if (!platform) continue
      const status = statusFromJob(job.status, job.conclusion)
      platforms.push({
        platform,
        status,
        message: status === 'failed' ? 'The build did not finish on this system.' : '',
      })
    }

    const finished = run.status === 'completed'
    const artifacts: RunState['artifacts'] = []
    if (finished) {
      const list = await this.api(`/actions/runs/${run.id}/artifacts`)
      if (list.ok) {
        const data = (await list.json()) as {
          artifacts?: { id: number; name: string; size_in_bytes: number }[]
        }
        for (const a of data.artifacts ?? []) {
          const platform = platformFromName(a.name)
          if (platform) artifacts.push({ platform, name: a.name, id: a.id, size: a.size_in_bytes })
        }
      }
    }
    return { found: true, finished, platforms, runId: run.id, artifacts }
  }

  async download(artifactId: number): Promise<Uint8Array> {
    const response = await this.api(`/actions/artifacts/${artifactId}/zip`)
    if (!response.ok) throw new Error(`Could not fetch the built app: ${response.status}`)
    // GitHub wraps the app's zip in a zip of its own. Hand out the app's.
    return unwrapSingleZip(new Uint8Array(await response.arrayBuffer()))
  }
}

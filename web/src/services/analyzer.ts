/**
 * Talks to the Analyzer: POST /analyze, one zip in, a manifest out.
 *
 * The contract is theirs, in analyzer/src/server.ts and
 * analyzer/src/manifest/schema.ts. Only the fields the website actually
 * uses are pulled apart here; the rest of the manifest is stored whole.
 */

import type { Confidence } from '../types.js'

export interface Manifest {
  schema_version?: string
  project_kind?: string
  project?: { language?: string; language_version?: string | null }
  dependencies?: { operating_systems?: string[] }
  capabilities?: {
    network_access?: boolean
    filesystem_access?: string
    reads_env_vars?: string[]
    runs_other_programs?: boolean
  }
  confidence?: { overall?: Confidence; notes?: string[] }
  [key: string]: unknown
}

export interface AnalyzeResult {
  manifest: Manifest
  name: string
  description: string
}

export interface Analyzer {
  analyze(zip: Uint8Array, signal?: AbortSignal): Promise<AnalyzeResult>
}

export class AnalyzerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'AnalyzerError'
  }
}

export class HttpAnalyzer implements Analyzer {
  constructor(private readonly url: string) {}

  async analyze(zip: Uint8Array, signal?: AbortSignal): Promise<AnalyzeResult> {
    const form = new FormData()
    form.append('file', new Blob([zip as BlobPart], { type: 'application/zip' }), 'project.zip')
    const response = await fetch(this.url, { method: 'POST', body: form, signal })
    const body = (await response.json().catch(() => null)) as
      | AnalyzeResult
      | { error?: { code?: string; message?: string } }
      | null
    if (!response.ok) {
      const err = (body as { error?: { code?: string; message?: string } })?.error
      throw new AnalyzerError(
        err?.message ?? `The analyzer answered ${response.status}.`,
        response.status,
        err?.code ?? 'ANALYZER_FAILED',
      )
    }
    const ok = body as AnalyzeResult
    if (!ok || typeof ok !== 'object' || !ok.manifest) {
      throw new AnalyzerError('The analyzer answered with no manifest.', 502, 'BAD_ANALYZER_REPLY')
    }
    return ok
  }
}

/** The three things the website lifts out of the manifest into columns. */
export function readManifest(manifest: Manifest): {
  network_access: boolean
  operating_systems: string[]
  confidence: Confidence | null
} {
  return {
    network_access: manifest.capabilities?.network_access === true,
    operating_systems: manifest.dependencies?.operating_systems ?? [],
    confidence: manifest.confidence?.overall ?? null,
  }
}

/** What P3 shows, versus what P3c shows. */
export function needsSimpleWindow(manifest: Manifest): boolean {
  return (manifest.confidence?.overall ?? 'low') !== 'high'
}

/**
 * New versions of something that already exists. Publishing makes the
 * first version from an upload; this makes every one after it, from a
 * chat the maker kept or a suggestion they took. Each one goes through
 * the same analysis, check and builds the first did, because a version
 * nobody could download is not much of a version.
 */

import { randomUUID } from 'node:crypto'
import * as buildsRepo from '../repo/builds.js'
import * as versionsRepo from '../repo/versions.js'
import type { Version } from '../types.js'
import { AnalyzerError, readManifest } from './analyzer.js'
import { UploadRejected, type PipelineDeps } from './pipeline.js'

interface Prepared {
  buildId: string
  zipUrl: string
  appUrl: string
  manifest: unknown
  read: ReturnType<typeof readManifest>
}

/** Store the zip and read it. Nothing is written to the database yet. */
async function prepare(deps: PipelineDeps, zip: Uint8Array): Promise<Prepared> {
  if (zip.byteLength === 0) throw new UploadRejected('There were no files to make a version from.', 'EMPTY_UPLOAD', 400)
  const buildId = randomUUID()
  const stored = await deps.storage.put(`uploads/${buildId}/project.zip`, zip, 'application/zip')
  let analysis
  try {
    analysis = await deps.analyzer.analyze(zip)
  } catch (error) {
    if (error instanceof AnalyzerError && error.status === 422) {
      throw new UploadRejected(error.message, 'CANNOT_READ', 422)
    }
    throw error
  }
  const app = await deps.storage.put(
    `uploads/${buildId}/app.json`,
    new TextEncoder().encode(JSON.stringify(analysis, null, 2)),
    'application/json',
  )
  return { buildId, zipUrl: stored.url, appUrl: app.url, manifest: analysis.manifest, read: readManifest(analysis.manifest) }
}

/** The check, the three build rows, and the Factory told to start. */
async function build(deps: PipelineDeps, version: Version, p: Prepared): Promise<void> {
  await buildsRepo.recordCheck(deps.db, {
    version_id: version.id,
    status: 'passed',
    summary: p.read.network_access
      ? 'This one reaches the internet. What it sends is on the project page.'
      : 'No keys or passwords found. Does not reach the internet.',
    manifest: p.manifest,
    network_access: p.read.network_access,
    operating_systems: p.read.operating_systems,
    confidence: p.read.confidence,
  })
  await buildsRepo.open(deps.db, version.id, p.read.operating_systems)
  await deps.factory.dispatch({ buildId: p.buildId, projectUrl: p.zipUrl, appUrl: p.appUrl })
}

/** C4: the maker keeps what they made in a chat, and it becomes the next version. */
export async function release(
  deps: PipelineDeps,
  input: { projectId: string; zip: Uint8Array; note: string; by: string },
): Promise<Version> {
  const p = await prepare(deps, input.zip)
  const version = await versionsRepo.append(deps.db, {
    project_id: input.projectId,
    note: input.note,
    created_by: input.by,
    source_zip_url: p.zipUrl,
    build_id: p.buildId,
  })
  await build(deps, version, p)
  return version
}

/** Y5: a version that already exists, because a suggestion was taken, gets its files and its builds. */
export async function buildExisting(deps: PipelineDeps, version: Version, zip: Uint8Array): Promise<void> {
  const p = await prepare(deps, zip)
  await versionsRepo.setSource(deps.db, version.id, p.zipUrl, p.buildId)
  await build(deps, { ...version, source_zip_url: p.zipUrl, build_id: p.buildId }, p)
}

/**
 * The one path that matters: a zip somebody uploaded becomes an app three
 * systems can download.
 *
 *   store the zip  ->  analyze it  ->  store the manifest  ->  make the
 *   project and version  ->  open three build rows  ->  tell the Factory
 *
 * Then, separately and as often as you like, `refresh` reads GitHub and
 * moves those build rows along.
 *
 * Everything it touches is injected, so this runs in a test with no
 * network at all.
 */

import { randomUUID } from 'node:crypto'
import type { Db } from '../db.js'
import * as buildsRepo from '../repo/builds.js'
import * as projectsRepo from '../repo/projects.js'
import * as versionsRepo from '../repo/versions.js'
import type { Build, Project, Version } from '../types.js'
import { AnalyzerError, readManifest, type Analyzer, type Manifest } from './analyzer.js'
import type { Factory } from './factory.js'
import type { Storage } from './storage.js'

export interface PipelineDeps {
  db: Db
  analyzer: Analyzer
  storage: Storage
  factory: Factory
}

export interface PublishInput {
  owner: string
  zip: Uint8Array
  /** Overrides the name the Analyzer worked out. */
  name?: string
  description?: string
}

export interface PublishResult {
  project: Project
  version: Version
  builds: Build[]
  manifest: Manifest
  /** True when the Analyzer was not sure, which is P3c rather than P3. */
  simpleWindow: boolean
}

export class UploadRejected extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 422,
  ) {
    super(message)
    this.name = 'UploadRejected'
  }
}

/**
 * P1 through P6. Everything up to the moment the Factory starts working.
 * The project is private until the person says otherwise, which is what
 * P1 means by nothing goes live until you say so.
 */
export async function publish(deps: PipelineDeps, input: PublishInput): Promise<PublishResult> {
  const { db, analyzer, storage, factory } = deps
  if (input.zip.byteLength === 0) {
    throw new UploadRejected('That file is empty.', 'EMPTY_UPLOAD', 400)
  }

  const buildId = randomUUID()
  const zipPath = `uploads/${buildId}/project.zip`
  const stored = await storage.put(zipPath, input.zip, 'application/zip')

  let analysis
  try {
    analysis = await analyzer.analyze(input.zip)
  } catch (error) {
    if (error instanceof AnalyzerError && error.status === 422) {
      // P5: we could not open that file.
      throw new UploadRejected(error.message, 'CANNOT_READ', 422)
    }
    throw error
  }

  const manifestPath = `uploads/${buildId}/app.json`
  const manifestStored = await storage.put(
    manifestPath,
    new TextEncoder().encode(JSON.stringify(analysis, null, 2)),
    'application/json',
  )

  const read = readManifest(analysis.manifest)
  const name = input.name?.trim() || analysis.name || 'Untitled project'
  const slug = await projectsRepo.freeSlug(db, name)

  const project = await projectsRepo.create(db, {
    owner: input.owner,
    slug,
    name,
    description: input.description?.trim() || analysis.description || '',
    visibility: 'private',
  })

  const version = await versionsRepo.append(db, {
    project_id: project.id,
    note: 'First version.',
    created_by: input.owner,
    source_zip_url: stored.url,
    build_id: buildId,
  })

  await buildsRepo.recordCheck(db, {
    version_id: version.id,
    status: 'passed',
    summary: summarise(read.network_access),
    manifest: analysis.manifest,
    network_access: read.network_access,
    operating_systems: read.operating_systems,
    confidence: read.confidence,
  })

  const builds = await buildsRepo.open(db, version.id, read.operating_systems)

  await factory.dispatch({
    buildId,
    projectUrl: stored.url,
    appUrl: manifestStored.url,
  })

  return {
    project,
    version,
    builds,
    manifest: analysis.manifest,
    simpleWindow: read.confidence !== 'high',
  }
}

function summarise(network: boolean): string {
  return network
    ? 'This one reaches the internet. What it sends is on the project page.'
    : 'No keys or passwords found. Does not reach the internet.'
}

export interface RefreshResult {
  found: boolean
  finished: boolean
  builds: Build[]
  outcome: ReturnType<typeof buildsRepo.outcome>
}

/**
 * Read GitHub once and move the build rows along. Call it from a poll, a
 * webhook, or a page load. Safe to call as often as you like.
 */
export async function refresh(deps: PipelineDeps, versionId: string): Promise<RefreshResult> {
  const { db, factory, storage } = deps
  const version = await versionsRepo.byId(db, versionId)
  if (!version?.build_id) {
    const builds = await buildsRepo.list(db, versionId)
    return { found: false, finished: false, builds, outcome: buildsRepo.outcome(builds) }
  }

  const state = await factory.read(version.build_id)
  if (!state.found) {
    const builds = await buildsRepo.list(db, versionId)
    return { found: false, finished: false, builds, outcome: buildsRepo.outcome(builds) }
  }

  for (const p of state.platforms) {
    const current = await versionsRepo.buildFor(db, versionId, p.platform)
    // A system the project never claimed stays "cannot", whatever CI says.
    if (current?.status === 'cannot') continue
    await buildsRepo.update(db, versionId, p.platform, {
      status: p.status,
      message: p.message,
    })
  }

  // Only once the run is over are the zips there to collect. A built app
  // with a bundled Python goes past what a free object store will take, so
  // anything too big stays with the Factory and the download route streams
  // it. Either way the person downloading needs no account.
  for (const artifact of state.artifacts) {
    const current = await versionsRepo.buildFor(db, versionId, artifact.platform)
    if (!current || current.status !== 'ready') continue
    if (current.download_url || current.artifact_id) continue

    if (artifact.size > storage.maxBytes) {
      await buildsRepo.update(db, versionId, artifact.platform, {
        status: 'ready',
        artifact_id: artifact.id,
        size_bytes: artifact.size,
      })
      continue
    }
    const bytes = await factory.download(artifact.id)
    const path = `apps/${version.build_id}/${artifact.platform}.zip`
    const put = await storage.put(path, bytes, 'application/zip')
    await buildsRepo.update(db, versionId, artifact.platform, {
      status: 'ready',
      download_url: put.url,
      size_bytes: put.size,
    })
  }

  const builds = await buildsRepo.list(db, versionId)
  return {
    found: true,
    finished: state.finished,
    builds,
    outcome: buildsRepo.outcome(builds),
  }
}

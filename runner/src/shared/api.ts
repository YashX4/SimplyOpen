// The only things the page is allowed to ask the main process to do.
// Implemented in main/index.ts, exposed to the page by preload/index.ts.

import type { Manifest, Values } from './manifest'

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; error: string }

export type RunResult = { ok: true } | { ok: false; error: string }

export interface RunnerApi {
  loadManifest(): Promise<ManifestResult>
  /** Shows the system file picker. Resolves to null if the user cancels. */
  chooseFile(extensions?: string[]): Promise<string | null>
  /** Runs the project. Resolves when the script has finished. */
  run(values: Values): Promise<RunResult>
  /** Calls `listener` for every line the script prints. Returns an unsubscribe function. */
  onLog(listener: (line: string) => void): () => void
  /** Opens the folder holding the most recent run's output. */
  openResults(): Promise<void>
}

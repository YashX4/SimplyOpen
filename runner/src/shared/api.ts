// The only things the page is allowed to ask the main process to do.
// Implemented in main/index.ts, exposed to the page by preload/index.ts.

import type { AppDescription, Values } from './manifest'

export type LoadResult = { ok: true; app: AppDescription } | { ok: false; error: string }

export type RunResult = { ok: true } | { ok: false; error: string }

export interface ChooseFilesOptions {
  /** Allowed file endings as the manifest gives them, e.g. [".png", ".jpg"]. */
  accepts?: string[]
  /** Whether several files may be picked at once. */
  multiple?: boolean
}

export interface RunnerApi {
  /** Reads the project's simplyopen.json and checks the Runner can open it. */
  loadApp(): Promise<LoadResult>
  /** Shows the system file picker. Resolves to an empty list if the user cancels. */
  chooseFiles(options: ChooseFilesOptions): Promise<string[]>
  /** Shows the system folder picker. Resolves to null if the user cancels. */
  chooseFolder(): Promise<string | null>
  /** Runs the project. Resolves when the script has finished. */
  run(values: Values): Promise<RunResult>
  /** Calls `listener` for every line the script prints. Returns an unsubscribe function. */
  onLog(listener: (line: string) => void): () => void
  /** Opens the folder holding the most recent run's output. */
  openResults(): Promise<void>
}

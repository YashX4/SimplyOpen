// The main process: the invisible half of the app. It is the only part allowed
// to read files and launch programs. The page asks it to do things through the
// handlers registered at the bottom of this file.

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import Ajv from 'ajv'
import manifestSchema from '../../../analyzer/src/manifest/schema.json'
import type { ChooseFilesOptions, LoadResult, RunResult } from '../shared/api'
import {
  buildCommand,
  checkValues,
  primaryEntryPoint,
  resultsFolder,
  unsupportedReason,
  type AppDescription,
  type Manifest,
  type Value,
  type Values,
} from '../shared/manifest'

const isWindows = process.platform === 'win32'

// Where the project and Python live. In a finished app the Factory places both
// inside the app's resources folder. During development we point at the example
// project and borrow the Python already on this computer.
const projectDir =
  process.env.SIMPLYOPEN_PROJECT ??
  (app.isPackaged
    ? join(process.resourcesPath, 'project')
    : resolve(app.getAppPath(), '../examples/image_resizer'))

const pythonPath =
  process.env.SIMPLYOPEN_PYTHON ??
  (app.isPackaged
    ? join(process.resourcesPath, 'python', isWindows ? 'python.exe' : 'bin/python3')
    : isWindows
      ? 'python'
      : 'python3')

// The schema belongs to the Analyzer, so don't fail on keywords Ajv's strict
// mode doesn't know.
const validateManifest = new Ajv({ strict: false }).compile(manifestSchema)

// The folder the script expects to be started from.
const workingDirFor = (m: Manifest): string =>
  join(projectDir, primaryEntryPoint(m)?.working_directory ?? '')

let manifest: Manifest | null = null
let lastResultsDir: string | null = null
let running = false

/** Reads simplyopen.json: the Analyzer's result for this project (manifest, name, description). */
function loadApp(): LoadResult {
  let parsed: Partial<AppDescription>
  try {
    parsed = JSON.parse(readFileSync(join(projectDir, 'simplyopen.json'), 'utf8'))
  } catch (error) {
    return { ok: false, error: `Could not read this app's description file. (${String(error)})` }
  }
  if (typeof parsed?.name !== 'string' || typeof parsed.description !== 'string') {
    return { ok: false, error: "This app's description file is missing its name or description." }
  }
  if (!validateManifest(parsed.manifest)) {
    const problem = validateManifest.errors?.[0]
    return {
      ok: false,
      error: `This app's description file is not valid: ${problem?.instancePath ?? ''} ${problem?.message ?? ''}`,
    }
  }
  // Valid, but is it a kind of project the Runner can run yet?
  const loaded = parsed.manifest as Manifest
  const unsupported = unsupportedReason(loaded)
  if (unsupported) return { ok: false, error: unsupported }

  manifest = loaded
  return { ok: true, app: { manifest: loaded, name: parsed.name, description: parsed.description } }
}

function runProject(values: Values, sendLog: (line: string) => void): Promise<RunResult> {
  if (!manifest) return Promise.resolve({ ok: false, error: 'The app has not finished loading.' })
  if (running) return Promise.resolve({ ok: false, error: 'Already working. Please wait.' })

  // The page checks too, but the page is not trusted to have done it.
  const problem = checkValues(manifest, values)
  if (problem) return Promise.resolve({ ok: false, error: problem })

  const command = buildCommand(manifest, values)
  const workingDir = workingDirFor(manifest)
  const results = resultsFolder(manifest, values)

  running = true
  return new Promise((done) => {
    const finish = (result: RunResult): void => {
      running = false
      done(result)
    }

    // The manifest's command says "python"; we run our own Python in its place.
    const child = spawn(pythonPath, command.args, {
      cwd: workingDir,
      env: {
        ...process.env,
        ...command.env,
        // Without this, Python holds printed lines back until the script ends,
        // and the log would appear all at once instead of live.
        PYTHONUNBUFFERED: '1',
        // Stops Python saving cache files next to the code, which would mean
        // writing inside the app itself.
        PYTHONDONTWRITEBYTECODE: '1',
      },
    })

    let lastErrorLine = ''
    createInterface({ input: child.stdout }).on('line', sendLog)
    createInterface({ input: child.stderr }).on('line', (line) => {
      if (line.trim()) lastErrorLine = line.trim()
      sendLog(line)
    })

    // Fires when the program could not be started at all (e.g. Python is missing).
    child.on('error', () => {
      finish({ ok: false, error: 'This app could not start its engine (Python was not found).' })
    })
    // Fires when the script ends. Exit code 0 means success.
    child.on('close', (code) => {
      if (code === 0) {
        // A relative results folder is relative to where the script ran.
        const folder = results === null ? workingDir : resolve(workingDir, results)
        lastResultsDir = existsSync(folder) ? folder : workingDir
        finish({ ok: true })
      } else if (code !== null) {
        finish({ ok: false, error: lastErrorLine || 'Something went wrong.' })
      }
    })
  })
}

/**
 * The hidden test mode, used by the Factory to check a finished app. Started
 * with `--smoke-test`, the app opens no window. It runs the project once with
 * the known-good answers in simplyopen.sample.json, exactly as a real run
 * would, then reports whether that worked.
 */
async function smokeTest(): Promise<boolean> {
  const fail = (reason: string): false => {
    console.log(`SMOKE TEST FAILED: ${reason}`)
    return false
  }

  const loaded = loadApp()
  if (!loaded.ok) return fail(loaded.error)
  const tested = loaded.app.manifest

  let sample: Record<string, Value>
  try {
    sample = JSON.parse(readFileSync(join(projectDir, 'simplyopen.sample.json'), 'utf8')).values
  } catch {
    return fail('This project has no sample inputs (simplyopen.sample.json).')
  }

  // Sample files are named relative to the project folder. "{temp}" asks for a
  // fresh empty folder, for inputs that say where to save results.
  const toPath = (path: string): string =>
    path === '{temp}' ? mkdtempSync(join(tmpdir(), 'simplyopen-test-')) : resolve(projectDir, path)
  const values: Values = {}
  for (const input of tested.inputs) {
    const value = sample[input.id]
    if (value === undefined) continue
    if (input.kind === 'file' || input.kind === 'folder') {
      values[input.id] = Array.isArray(value) ? value.map(toPath) : toPath(String(value))
    } else {
      values[input.id] = value
    }
  }

  const result = await runProject(values, (line) => console.log(line))
  if (!result.ok) return fail(result.error)

  // If the project is meant to write files, make sure some actually appeared.
  const folder = resultsFolder(tested, values)
  if (folder !== null) {
    const full = resolve(workingDirFor(tested), folder)
    if (!existsSync(full) || readdirSync(full).length === 0) {
      return fail(`The run finished but nothing appeared in ${full}`)
    }
  }

  console.log('SMOKE TEST PASSED')
  return true
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 560,
    height: 720,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  })
  // electron-vite sets this URL while developing, so edits show up instantly.
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.argv.includes('--smoke-test')) {
    smokeTest().then((passed) => app.exit(passed ? 0 : 1))
    return
  }

  ipcMain.handle('app:load', () => loadApp())

  ipcMain.handle('files:choose', async (_event, options: ChooseFilesOptions = {}) => {
    // The manifest writes endings with a dot (".png"); the picker wants them without.
    const extensions = (options.accepts ?? []).map((ending) => ending.replace(/^\./, ''))
    const result = await dialog.showOpenDialog({
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: extensions.length ? [{ name: 'Supported files', extensions }] : [],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('run:start', (event, values: Values) =>
    runProject(values, (line) => event.sender.send('run:log', line)),
  )

  ipcMain.handle('results:open', async () => {
    if (lastResultsDir) await shell.openPath(lastResultsDir)
  })

  createWindow()
})

app.on('window-all-closed', () => app.quit())

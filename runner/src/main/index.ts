// The main process: the invisible half of the app. It is the only part allowed
// to read files and launch programs. The page asks it to do things through the
// handlers registered at the bottom of this file.

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import Ajv from 'ajv'
import manifestSchema from '../../../manifest/manifest.schema.json'
import type { ManifestResult, RunResult } from '../shared/api'
import { buildArgs, checkValues, type Manifest, type Values } from '../shared/manifest'

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

const validateManifest = new Ajv().compile(manifestSchema)

let manifest: Manifest | null = null
let lastResultsDir: string | null = null
let running = false

function loadManifest(): ManifestResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(projectDir, 'simplyopen.json'), 'utf8'))
  } catch (error) {
    return { ok: false, error: `Could not read this app's description file. (${String(error)})` }
  }
  if (!validateManifest(parsed)) {
    const problem = validateManifest.errors?.[0]
    return {
      ok: false,
      error: `This app's description file is not valid: ${problem?.instancePath ?? ''} ${problem?.message ?? ''}`,
    }
  }
  manifest = parsed as unknown as Manifest
  return { ok: true, manifest }
}

/** Makes a fresh folder for one run, e.g. Documents/SimplyOpen/Image Resizer/2026-11-14 10.32.05 */
function createResultsDir(appName: string): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`
  const safeName = appName.replace(/[\\/:*?"<>|]/g, '_')
  const dir = join(app.getPath('documents'), 'SimplyOpen', safeName, stamp)
  mkdirSync(dir, { recursive: true })
  return dir
}

function runProject(values: Values, sendLog: (line: string) => void): Promise<RunResult> {
  if (!manifest) return Promise.resolve({ ok: false, error: 'The app has not finished loading.' })
  if (running) return Promise.resolve({ ok: false, error: 'Already working. Please wait.' })

  // The page checks too, but the page is not trusted to have done it.
  const problem = checkValues(manifest, values)
  if (problem) return Promise.resolve({ ok: false, error: problem })

  const resultsDir = createResultsDir(manifest.name)
  const args = [manifest.entry, ...buildArgs(manifest, values, resultsDir)]

  running = true
  return new Promise((done) => {
    const finish = (result: RunResult): void => {
      running = false
      if (!result.ok) {
        // Don't leave an empty folder behind. (rmdir refuses to delete one with files in it.)
        try {
          rmdirSync(resultsDir)
        } catch {}
      }
      done(result)
    }

    const child = spawn(pythonPath, args, {
      cwd: projectDir,
      // Without this, Python holds printed lines back until the script ends,
      // and the log would appear all at once instead of live.
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
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
        lastResultsDir = resultsDir
        finish({ ok: true })
      } else if (code !== null) {
        finish({ ok: false, error: lastErrorLine || 'Something went wrong.' })
      }
    })
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 560,
    height: 680,
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
  ipcMain.handle('manifest:load', () => loadManifest())

  ipcMain.handle('file:choose', async (_event, extensions?: string[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: extensions?.length ? [{ name: 'Supported files', extensions }] : [],
    })
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

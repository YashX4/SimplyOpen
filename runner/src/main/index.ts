// The main process: the invisible half of the app. It is the only part allowed
// to read files and launch programs. The page asks it to do things through the
// handlers registered at the bottom of this file.

import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import Ajv from 'ajv'
import manifestSchema from '../../../analyzer/src/manifest/schema.json'
import type { ChooseFilesOptions, LoadResult, RunResult } from '../shared/api'
import {
  buildCommand,
  checkValues,
  pagePath,
  primaryEntryPoint,
  resultsFolder,
  unsupportedReason,
  type AppDescription,
  type Manifest,
  type Value,
  type Values,
} from '../shared/manifest'

const isWindows = process.platform === 'win32'

// Where the project and Python come from. In a finished app the Factory places
// both inside the app's resources folder. During development we point at the
// example project and borrow the Python already on this computer.
const bundledProjectDir =
  process.env.SIMPLYOPEN_PROJECT ??
  (app.isPackaged
    ? join(process.resourcesPath, 'project')
    : resolve(app.getAppPath(), '../examples/image_resizer'))

// Where the project actually runs. Many scripts save files next to their own
// code, and the system can refuse writes inside an installed app. So a finished
// app works from a copy in this user's own data folder for the app
// (see prepareProject). During development the project runs where it is.
const runsFromCopy = app.isPackaged && !process.env.SIMPLYOPEN_PROJECT
const projectDir = runsFromCopy ? join(app.getPath('userData'), 'project') : bundledProjectDir

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

// A project that is a web page is shown from this made-up address instead of
// straight from its file. That makes it behave like a normal website (scripts
// and saved settings work as their authors expect) while only ever being able
// to read files inside the project's own folder.
const PAGE_SCHEME = 'app'
protocol.registerSchemesAsPrivileged([
  { scheme: PAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

let manifest: Manifest | null = null
let lastResultsDir: string | null = null
let running = false

/**
 * Refreshes the working copy of the project from the one inside the app. Runs
 * at every start, so an updated app brings its updated code. Files the script
 * created in the copy on earlier runs (its results) are left alone.
 */
function prepareProject(): void {
  if (!runsFromCopy) return
  try {
    cpSync(bundledProjectDir, projectDir, { recursive: true, force: true })
  } catch (error) {
    // loadApp will then fail to read the project and show a message.
    console.error(`Could not prepare the project: ${String(error)}`)
  }
}

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

  // A page has to be there to be shown. For a React component, the Factory
  // builds it; if that step was skipped there is nothing to open.
  const page = pagePath(loaded)
  if (page !== null && !existsSync(join(projectDir, page))) {
    return { ok: false, error: "This app's page is missing, so there is nothing to show." }
  }

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
 * would, then reports whether that worked. A project with no sample answers
 * gets a lighter check: the app loads and its Python starts.
 */
async function smokeTest(): Promise<boolean> {
  const fail = (reason: string): false => {
    console.log(`SMOKE TEST FAILED: ${reason}`)
    return false
  }

  const loaded = loadApp()
  if (!loaded.ok) return fail(loaded.error)
  const tested = loaded.app.manifest

  // A page has nothing to run: the test is that it opens and shows something.
  const page = pagePath(tested)
  if (page !== null) {
    const problem = await pageProblem(createPageWindow(loaded.app.name, page, false))
    if (problem) return fail(problem)
    console.log('SMOKE TEST PASSED (the page opened and showed its content)')
    return true
  }

  if (spawnSync(pythonPath, ['--version']).status !== 0) {
    return fail(`The app's Python could not be started (${pythonPath}).`)
  }

  const samplePath = join(projectDir, 'simplyopen.sample.json')
  if (!existsSync(samplePath)) {
    console.log('SMOKE TEST PASSED (load only: no sample inputs, so the project was not run)')
    return true
  }
  let sample: Record<string, Value>
  try {
    sample = JSON.parse(readFileSync(samplePath, 'utf8')).values
  } catch {
    return fail('The sample inputs file (simplyopen.sample.json) could not be read.')
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

/** Lets the project's page, and nothing else, be read through the made-up address. */
function servePages(): void {
  protocol.handle(PAGE_SCHEME, (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
    const file = resolve(projectDir, path)
    // Refuse anything that points outside the project's folder.
    if (!file.startsWith(projectDir + sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

/**
 * The window for a project that is a web page. The page is somebody else's
 * code, so it gets none of the Runner's abilities: it cannot read files,
 * start programs, or use the camera or microphone. Links to other websites
 * open in the user's own browser instead of inside the app.
 */
function createPageWindow(name: string, page: string, show = true): BrowserWindow {
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    title: name,
    show,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const stayInside = (url: string): boolean => url.startsWith(`${PAGE_SCHEME}://`)
  const openOutside = (url: string): void => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (stayInside(url)) return
    event.preventDefault()
    openOutside(url)
  })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, decide) =>
    decide(false),
  )
  // Keep the app's name in the title bar, whatever the page calls itself.
  window.on('page-title-updated', (event) => event.preventDefault())

  const address = page.split('/').map(encodeURIComponent).join('/')
  void window.loadURL(`${PAGE_SCHEME}://project/${address}`)
  return window
}

/**
 * Opens a page window and watches it for a few seconds. Returns what went
 * wrong in plain words, or null if the page loaded, did not crash, and put
 * something on the screen.
 */
function pageProblem(window: BrowserWindow): Promise<string | null> {
  return new Promise((done) => {
    const contents = window.webContents
    let crash: string | null = null
    // An error nothing caught is how a broken page announces itself.
    contents.on('console-message', (event: unknown, _level?: unknown, text?: unknown) => {
      const message = typeof text === 'string' ? text : String((event as { message?: string }).message ?? '')
      console.log(`[page] ${message}`)
      if (/^Uncaught/.test(message) && crash === null) crash = message
    })
    contents.on('did-fail-load', (_event, _code, description, _url, isMainFrame) => {
      if (isMainFrame) done(`The page could not be opened (${description}).`)
    })
    contents.on('render-process-gone', () => done('The page crashed while opening.'))
    contents.once('did-finish-load', () => {
      // Give the page a moment to draw itself and to fail if it is going to.
      setTimeout(async () => {
        if (crash !== null) return done(`The page hit an error while opening: ${crash}`)
        const hasContent: boolean = await contents.executeJavaScript(
          `Boolean(document.body && (document.body.innerText.trim().length > 0 ||
             document.body.querySelector('canvas, svg, img, input, button, video')))`,
        )
        done(hasContent ? null : 'The page opened but showed nothing.')
      }, 3000)
    })
  })
}

/**
 * The picture mode, used by the Factory to show what this project's window
 * looks like. Started with `--screenshot=<file>`, the app opens its normal
 * window, waits for the form to be drawn, saves a picture of it as a PNG, and
 * quits. Nothing is run.
 */
async function takeScreenshot(window: BrowserWindow, file: string, isPage = false): Promise<boolean> {
  try {
    if (window.webContents.isLoading()) {
      await new Promise<void>((loaded) => window.webContents.once('did-finish-load', () => loaded()))
    }
    // Wait until the page shows the app's name or an error (up to 10 seconds),
    // then report how tall the whole page is.
    const pageHeight: number = await window.webContents.executeJavaScript(`
      new Promise((done) => {
        const started = Date.now()
        const check = () => {
          // The Runner's own form shows a heading when it is ready. A project's
          // page has no such signal, so it is simply given a moment to draw.
          const ready = ${isPage} ? Date.now() - started > 2000 : document.querySelector('h1')
          if (ready || Date.now() - started > 10000) {
            requestAnimationFrame(() => done(document.documentElement.scrollHeight))
          } else {
            setTimeout(check, 100)
          }
        }
        check()
      })
    `)
    // Make the window tall enough to show the whole form, within reason.
    const [width] = window.getContentSize()
    window.setContentSize(width, Math.min(Math.max(pageHeight, 300), 1400))
    await new Promise((settled) => setTimeout(settled, 500))

    const picture = await window.webContents.capturePage()
    if (picture.isEmpty()) throw new Error('the picture came out empty')
    writeFileSync(file, picture.toPNG())
    console.log(`SCREENSHOT SAVED: ${file}`)
    return true
  } catch (error) {
    console.log(`SCREENSHOT FAILED: ${String(error)}`)
    return false
  }
}

function createWindow(): BrowserWindow {
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
  return window
}

app.whenReady().then(() => {
  prepareProject()
  servePages()

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

  // A project that is a page gets a window showing that page. Everything else
  // (including a project that failed to load, so its message can be shown)
  // gets the Runner's own form.
  const loaded = loadApp()
  const page = loaded.ok ? pagePath(loaded.app.manifest) : null
  const window = loaded.ok && page !== null ? createPageWindow(loaded.app.name, page) : createWindow()

  const screenshotFile = process.argv
    .find((arg) => arg.startsWith('--screenshot='))
    ?.slice('--screenshot='.length)
  if (screenshotFile) {
    takeScreenshot(window, resolve(screenshotFile), page !== null).then((saved) => app.exit(saved ? 0 : 1))
  }
})

app.on('window-all-closed', () => app.quit())

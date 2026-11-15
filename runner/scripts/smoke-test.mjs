// Runs the packaged app's hidden test mode and reports whether it passed.
//
// Usage, from the runner folder, after `npm run stage` and `npm run package`:
//   node scripts/smoke-test.mjs
// Exits with 0 if the app ran its sample inputs successfully, 1 otherwise.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const runnerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(runnerDir, 'dist')

// The app is named after the staged project (same rule as electron-builder.config.cjs).
const { name } = JSON.parse(
  readFileSync(join(runnerDir, 'resources/project/simplyopen.json'), 'utf8'),
)
const appName = name.replace(/[\\/:*?"<>|]/g, '_')

/** Where the packaging step leaves the app's program file on this system. */
function findApp() {
  const folders = existsSync(distDir) ? readdirSync(distDir) : []
  const candidates =
    process.platform === 'darwin'
      ? folders
          .filter((folder) => folder.startsWith('mac'))
          .map((folder) => join(distDir, folder, `${appName}.app`, 'Contents', 'MacOS', appName))
      : process.platform === 'win32'
        ? [join(distDir, 'win-unpacked', `${appName}.exe`)]
        : [join(distDir, 'linux-unpacked', 'simplyopen-app')]
  return candidates.find((candidate) => existsSync(candidate))
}

const appPath = findApp()
if (!appPath) {
  console.error(`No packaged app found in ${distDir}. Run "npm run package" first.`)
  process.exit(1)
}

// VS Code sets ELECTRON_RUN_AS_NODE in its terminals, which stops Electron
// apps behaving like apps. Make sure the app doesn't inherit it.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

console.log(`Testing ${appPath}\n`)
const result = spawnSync(appPath, ['--smoke-test'], {
  stdio: 'inherit',
  env,
  timeout: 5 * 60 * 1000,
})

if (result.status === 0) {
  console.log('\nThe app passed its test.')

  // Also save a picture of the app's window, for the website to show. A
  // missing picture is not a reason to fail the build.
  const picture = spawnSync(appPath, [`--screenshot=${join(distDir, 'screenshot.png')}`], {
    stdio: 'inherit',
    env,
    timeout: 60 * 1000,
  })
  if (picture.status !== 0) console.error('Could not take a picture of the app window.')
} else {
  console.error(`\nThe app failed its test (exit code ${result.status ?? 'none, timed out or crashed'}).`)
}
process.exit(result.status === 0 ? 0 : 1)

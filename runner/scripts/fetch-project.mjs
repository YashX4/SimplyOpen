// Fetches an uploaded project so it can be staged and built.
//
// Takes the project as a zip, plus the Analyzer's result for it, and leaves an
// ordinary project folder in runner/resources/upload/ with simplyopen.json at
// its top, the same shape as examples/image_resizer.
//
// Usage, from the runner folder:
//   node scripts/fetch-project.mjs <project zip> [analyzer result] [sample inputs]
// Each argument is a web address (https://...) or a file on this computer.
//   project zip      The project exactly as it was uploaded.
//   analyzer result  The Analyzer's JSON answer: { manifest, name, description }.
//                    Leave out if the zip already contains simplyopen.json.
//   sample inputs    Optional known-good answers for the test run
//                    (saved as simplyopen.sample.json).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const runnerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const uploadDir = join(runnerDir, 'resources', 'upload')
const [zipSource, appSource, sampleSource] = process.argv.slice(2)

function stop(message) {
  console.error(message)
  process.exit(1)
}

/** Reads a web address or a local file into memory. */
async function read(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source)
    if (!response.ok) stop(`Could not download (${response.status}): ${source}`)
    return Buffer.from(await response.arrayBuffer())
  }
  if (!existsSync(source)) stop(`No such file: ${source}`)
  return readFileSync(source)
}

if (!zipSource) stop('Usage: node scripts/fetch-project.mjs <project zip> [analyzer result] [sample inputs]')

// Start from an empty folder every time.
rmSync(uploadDir, { recursive: true, force: true })
mkdirSync(uploadDir, { recursive: true })

// 1. Get the zip and unpack it.
console.log('Fetching the project...')
const zipPath = join(runnerDir, 'resources', 'upload.zip')
writeFileSync(zipPath, await read(zipSource))

// Windows has no unzip command, but its tar can open zips.
const unpack =
  process.platform === 'win32'
    ? [join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-xf', zipPath, '-C', uploadDir]]
    : ['unzip', ['-q', zipPath, '-d', uploadDir]]
if (spawnSync(unpack[0], unpack[1], { stdio: 'inherit' }).status !== 0) {
  stop('The project zip could not be unpacked.')
}
rmSync(zipPath)

// 2. Put the Analyzer's result at the top of the project, where the manifest's
// paths are measured from.
const appPath = join(uploadDir, 'simplyopen.json')
if (appSource) {
  const app = JSON.parse((await read(appSource)).toString('utf8'))
  if (!app.manifest || typeof app.name !== 'string' || typeof app.description !== 'string') {
    stop('The analyzer result must contain "manifest", "name" and "description".')
  }
  writeFileSync(appPath, JSON.stringify(app, null, 2))
} else if (!existsSync(appPath)) {
  stop('No analyzer result was given, and the zip has no simplyopen.json at its top.')
}

// 3. Sample inputs, if there are any.
if (sampleSource) {
  const sample = JSON.parse((await read(sampleSource)).toString('utf8'))
  writeFileSync(join(uploadDir, 'simplyopen.sample.json'), JSON.stringify(sample, null, 2))
}

const { name } = JSON.parse(readFileSync(appPath, 'utf8'))
console.log(`"${name}" is ready in ${uploadDir}`)

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

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzip } from './unzip.mjs'

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

// Unpacked by Node itself, the same way on every system. The systems' own
// tools disagree about unusual file names; see unzip.mjs.
try {
  const { written, skipped } = unzip(zipPath, uploadDir)
  console.log(`Unpacked ${written} files.`)
  for (const s of skipped) console.log(`Left out: ${s}`)
  if (written === 0) stop('The project zip has no files in it.')
} catch (error) {
  stop(`The project zip could not be unpacked: ${error.message}`)
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

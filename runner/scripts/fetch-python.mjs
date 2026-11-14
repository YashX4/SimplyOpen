// Prepares the private Python that ships inside the app.
//
// 1. Downloads a standalone Python for this computer's system.
// 2. Unpacks it into runner/resources/python/.
// 3. Installs the project's libraries into that Python (and nowhere else).
//
// Usage, from the runner folder:
//   node scripts/fetch-python.mjs [project folder]
// The project folder defaults to the image resizer example.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Which Python to ship. These come from the python-build-standalone project,
// which publishes Pythons that run from any folder without being installed.
const PYTHON_VERSION = '3.12.16'
const RELEASE = '20261110'

// The download's name for each system we can build on.
const TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
}

const runnerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const resourcesDir = join(runnerDir, 'resources')
const pythonDir = join(resourcesDir, 'python')
const projectDir = resolve(process.argv[2] ?? join(runnerDir, '../examples/image_resizer'))

/** Runs a program, showing its output, and stops this script if it fails. */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`Failed: ${command} ${args.join(' ')}`)
    process.exit(1)
  }
}

const system = `${process.platform}-${process.arch}`
const target = TARGETS[system]
if (!target) {
  console.error(`No Python download is set up for this system (${system}).`)
  process.exit(1)
}

// 1. Download, unless a previous run already did.
const archiveName = `cpython-${PYTHON_VERSION}+${RELEASE}-${target}-install_only_stripped.tar.gz`
const archivePath = join(resourcesDir, archiveName)
mkdirSync(resourcesDir, { recursive: true })
if (existsSync(archivePath)) {
  console.log(`Using the Python already downloaded (${archiveName}).`)
} else {
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${archiveName}`
  console.log(`Downloading Python ${PYTHON_VERSION} for ${system}...`)
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`Download failed (${response.status}): ${url}`)
    process.exit(1)
  }
  writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))
}

// 2. Unpack. Always start from a clean copy, so libraries from a previously
// prepared project don't leak into this one. The archive contains one folder
// named "python", which lands at resources/python.
console.log('Unpacking...')
rmSync(pythonDir, { recursive: true, force: true })
run('tar', ['-xzf', archivePath, '-C', resourcesDir])

const python = join(pythonDir, process.platform === 'win32' ? 'python.exe' : 'bin/python3')

// 3. Install the libraries the project's manifest lists.
const { manifest, name } = JSON.parse(readFileSync(join(projectDir, 'simplyopen.json'), 'utf8'))
const packages = manifest.dependencies.packages
if (packages.length) {
  console.log(`Installing libraries for "${name}": ${packages.join(', ')}`)
  run(python, [
    '-m', 'pip', 'install',
    '--disable-pip-version-check',
    '--no-warn-script-location',
    ...packages,
  ])
} else {
  console.log(`"${name}" needs no extra libraries.`)
}

console.log(`\nPrivate Python is ready: ${python}`)

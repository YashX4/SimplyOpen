// Gathers everything that goes inside one project's app, ready for packaging.
//
// For a Python project:
// 1. Downloads a standalone Python for this computer's system.
// 2. Unpacks it into runner/resources/python/.
// 3. Installs the project's libraries into that Python (and nowhere else).
// 4. Copies the project itself into runner/resources/project/.
//
// For a project that is a web page or a React component (a Claude artifact),
// there is no Python at all: only step 4, and for a component, building it
// into a page (see build-react-page.mjs).
//
// Usage, from the runner folder:
//   node scripts/stage.mjs [project folder]
// The project folder defaults to the image resizer example.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReactPage } from './build-react-page.mjs'

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

const { manifest, name } = JSON.parse(readFileSync(join(projectDir, 'simplyopen.json'), 'utf8'))

// What kind of project this is, decided the same way the Runner decides it
// (pagePath in src/shared/manifest.ts): by the file it starts from.
const entry = manifest.project.entry_points.find((e) => e.id === manifest.project.primary_entry_point)
const entryPath = entry?.path ?? ''
const kind = /\.html?$/i.test(entryPath) ? 'page' : /\.(jsx|tsx)$/i.test(entryPath) ? 'component' : 'python'

mkdirSync(resourcesDir, { recursive: true })
if (kind === 'python') {
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
  // On Windows, use the system's own tar: other tars that may come first on the
  // PATH (such as Git's) misread paths that start with a drive letter like C:.
  const tar =
    process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar'
  run(tar, ['-xzf', archivePath, '-C', resourcesDir])

  const python = join(pythonDir, process.platform === 'win32' ? 'python.exe' : 'bin/python3')

  // 3. Install the libraries the project's manifest lists.
  const packages = manifest.dependencies.packages
  // A library name is passed straight to the installer, so refuse anything that
  // would be read as an installer option instead of a name.
  const suspicious = packages.find((spec) => spec.trim().startsWith('-'))
  if (suspicious) {
    console.error(`Refusing to install "${suspicious}": that is not a library name.`)
    process.exit(1)
  }
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
} else {
  // A page runs in the app's own window and needs no Python. Remove one left
  // behind by an earlier project so it is not packed into this app.
  console.log(`"${name}" is a ${kind === 'page' ? 'web page' : 'React component'}, so it needs no Python.`)
  rmSync(pythonDir, { recursive: true, force: true })
}

// 4. Copy the project in, leaving out clutter that isn't part of it.
const stagedProjectDir = join(resourcesDir, 'project')
const clutter = ['__pycache__', '.git', '.DS_Store', 'node_modules']
rmSync(stagedProjectDir, { recursive: true, force: true })
cpSync(projectDir, stagedProjectDir, {
  recursive: true,
  filter: (source) => !clutter.includes(basename(source)),
})

// 5. A component is built into a page the Runner can show.
if (kind === 'component') {
  buildReactPage(stagedProjectDir, entryPath, name, join(resourcesDir, 'page-build'))
}

console.log(`\n"${name}" is staged in ${resourcesDir}`)

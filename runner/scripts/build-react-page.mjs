// Turns one React component (which is what most Claude artifacts are) into a
// plain web page the Runner can show.
//
// A component cannot be opened by itself. It needs React, usually Tailwind for
// its styling, and whatever other libraries it imports, all assembled by a
// build tool. This script makes a small throwaway project around the
// component, installs those libraries, builds it, and leaves the finished page
// in <project>/simplyopen-page/, where the Runner looks for it.
//
// Used by stage.mjs. The finished page is fully self-contained, so the app
// works without an internet connection.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/** Must match BUILT_PAGE in src/shared/manifest.ts. */
const BUILT_PAGE_DIR = 'simplyopen-page'

// What every component gets, whether or not it asks. Artifacts are written
// assuming these are simply there.
const ALWAYS = ['react', 'react-dom', 'vite', '@vitejs/plugin-react', 'tailwindcss', '@tailwindcss/vite']

/** A name npm would accept, with an optional scope. Nothing that could be read as an option. */
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

/** Stops the build with a message meant for the person who uploaded the component. */
function refuse(message) {
  console.error(`\nThis component cannot be made into an app: ${message}`)
  process.exit(1)
}

/**
 * The libraries a component imports, read from its `import ... from "name"`
 * lines. "lodash/debounce" and "@scope/name/part" count as their library.
 */
export function importedPackages(source) {
  const found = new Set()
  // Only real import lines count, so the word "from" inside the component's
  // own text is never mistaken for one.
  const names = [
    ...source.matchAll(/^\s*(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1])
  for (const name of names) {
    if (name.startsWith('.')) {
      refuse(`it loads another file ("${name}") that was not included. Paste a component that is all in one file.`)
    }
    // Claude's own interface kit lives inside claude.ai, not in any library.
    if (name.startsWith('@/')) {
      refuse(`it uses Claude's built-in interface pieces ("${name}"), which only exist inside Claude. Ask Claude to rewrite it using plain HTML elements and Tailwind instead.`)
    }
    const parts = name.split('/')
    const library = name.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
    if (!PACKAGE_NAME.test(library)) refuse(`"${name}" is not a library name.`)
    found.add(library)
  }
  return [...found]
}

function run(command, args, cwd) {
  // On Windows, npm is a script, not a program, and has to go through the shell.
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    console.error(`Failed: ${command} ${args.join(' ')}`)
    process.exit(1)
  }
}

/**
 * @param stagedProjectDir The project's folder inside runner/resources.
 * @param componentPath The component's file, relative to that folder.
 * @param title Shown in the page's title.
 * @param workDir An empty-able folder to build in.
 */
export function buildReactPage(stagedProjectDir, componentPath, title, workDir) {
  const componentFile = join(stagedProjectDir, componentPath)
  if (!existsSync(componentFile)) refuse(`its file (${componentPath}) is missing.`)
  const source = readFileSync(componentFile, 'utf8')
  if (!/\bexport\s+default\b/.test(source)) {
    refuse('it has no "export default", so there is no way to tell which part to show.')
  }

  const libraries = [...new Set([...ALWAYS, ...importedPackages(source)])]
  console.log(`Building the page. Libraries: ${libraries.join(', ')}`)

  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(join(workDir, 'src'), { recursive: true })
  // Keep the component's own file name, so .tsx is still read as TypeScript.
  const componentName = basename(componentPath)
  cpSync(componentFile, join(workDir, 'src', componentName))

  writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'page', private: true, type: 'module' }))
  writeFileSync(
    join(workDir, 'vite.config.js'),
    `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relative addresses, so the page works from wherever the app puts it.
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 5000 },
})
`,
  )
  writeFileSync(
    join(workDir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replace(/[<>&]/g, '')}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
  )
  writeFileSync(join(workDir, 'src', 'styles.css'), '@import "tailwindcss";\n')
  writeFileSync(
    join(workDir, 'src', 'main.jsx'),
    `import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './${componentName}'

createRoot(document.getElementById('root')).render(<App />)
`,
  )

  // --ignore-scripts: a library must not get to run its own programs on the
  // build machine just by being named in somebody's upload.
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error', ...libraries], workDir)
  run('npx', ['vite', 'build'], workDir)

  const pageDir = join(stagedProjectDir, BUILT_PAGE_DIR)
  rmSync(pageDir, { recursive: true, force: true })
  cpSync(join(workDir, 'dist'), pageDir, { recursive: true })
  rmSync(workDir, { recursive: true, force: true })
  console.log(`The page is built (${BUILT_PAGE_DIR}/index.html).`)
}

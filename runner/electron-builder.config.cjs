// Settings for packaging the Runner and one staged project into an app.
// Run `npm run stage` first: it fills resources/python and resources/project.

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

// The app is named after the project it contains.
const { name } = JSON.parse(
  readFileSync(join(__dirname, 'resources/project/simplyopen.json'), 'utf8'),
)
const safeName = name.replace(/[\\/:*?"<>|]/g, '_')
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

module.exports = {
  productName: safeName,
  // A unique id per project, so the system treats each as a separate app.
  appId: `dev.simplyopen.${slug}`,
  directories: { output: 'dist' },

  // The Runner's own code: only the built output, not the source.
  files: ['out/**', 'package.json'],

  // Copied next to the Runner's code, where main/index.ts looks for them.
  extraResources: [
    { from: 'resources/python', to: 'python' },
    { from: 'resources/project', to: 'project' },
  ],

  mac: {
    target: 'zip',
    // "-" means sign the app without a paid Apple certificate. Apple Silicon
    // Macs refuse to start an app with no signature at all.
    identity: '-',
    hardenedRuntime: false,
  },
  win: {
    target: 'zip',
  },
  linux: {
    target: 'zip',
    // A fixed name for the program file, so the test script can find it.
    executableName: 'simplyopen-app',
  },
}

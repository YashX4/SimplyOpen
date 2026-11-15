import Ajv from 'ajv'
import { expect, test } from 'vitest'
import schema from '../../../analyzer/src/manifest/schema.json'
import example from '../../../examples/image_resizer/simplyopen.json'
import {
  buildCommand,
  checkValues,
  initialValues,
  pagePath,
  resultsFolder,
  unsupportedReason,
  type Input,
  type Manifest,
} from './manifest'

const manifest = example.manifest as unknown as Manifest

/** A copy of the example manifest with some changes applied. */
function changed(change: (copy: Manifest) => void): Manifest {
  const copy = structuredClone(manifest)
  change(copy)
  return copy
}

/** An input with every field the format requires, plus the given ones. */
function input(fields: Partial<Input> & Pick<Input, 'id' | 'kind'>): Input {
  return {
    label: fields.id,
    help: null,
    required: false,
    multiple: false,
    min: null,
    max: null,
    secret: false,
    cli_binding: null,
    env_binding: null,
    ...fields,
  }
}

// The same inputs the Analyzer's transcript converter fixture has.
const transcripts = changed((copy) => {
  copy.project.entry_points[0].run_command = 'python zoom_to_nvivo.py {args}'
  copy.inputs = [
    input({ id: 'transcripts', kind: 'file', multiple: true, required: true, cli_binding: '{value}' }),
    input({ id: 'output_dir', kind: 'folder', cli_binding: '--output-dir {value}' }),
    input({ id: 'keep_timestamps', kind: 'boolean', cli_binding: '--keep-timestamps' }),
  ]
})

test("the example manifest follows the Analyzer's schema and is supported", () => {
  const validate = new Ajv({ strict: false }).compile(schema)
  expect(validate(example.manifest), JSON.stringify(validate.errors)).toBe(true)
  expect(unsupportedReason(manifest)).toBeNull()
})

test('projects outside what the Runner can run are turned away with a reason', () => {
  expect(unsupportedReason(changed((m) => (m.project.language = 'node')))).toMatch(/Python/)
  expect(
    unsupportedReason(changed((m) => (m.project.entry_points[0].interface.kind = 'own_window'))),
  ).toMatch(/not supported yet/)
  expect(unsupportedReason(changed((m) => (m.project.entry_points[0].run_command = null)))).toMatch(
    /how to start/,
  )
  expect(
    unsupportedReason(changed((m) => (m.project.entry_points[0].run_command = './run.sh {args}'))),
  ).toMatch(/not supported yet/)
})

test('web pages and React components are shown as pages instead of being run', () => {
  // What the Analyzer writes for a pasted web page: no language we run, no command.
  const webPage = changed((m) => {
    m.project.language = 'html'
    m.project.entry_points[0].path = 'index.html'
    m.project.entry_points[0].run_command = null
    m.project.entry_points[0].interface.kind = 'own_window'
  })
  expect(pagePath(webPage)).toBe('index.html')
  expect(unsupportedReason(webPage)).toBeNull()

  // A React component is built into a page by the Factory, at a fixed place.
  const component = changed((m) => {
    m.project.language = 'javascript'
    m.project.entry_points[0].path = 'App.jsx'
    m.project.entry_points[0].run_command = null
  })
  expect(pagePath(component)).toBe('simplyopen-page/index.html')
  expect(unsupportedReason(component)).toBeNull()

  // A Python project is not a page.
  expect(pagePath(manifest)).toBeNull()
})

test('the form starts with the manifest defaults', () => {
  expect(initialValues(manifest)).toEqual({ image: '', width: '800', format: 'png', output_dir: '' })
  expect(initialValues(transcripts)).toEqual({
    transcripts: [],
    output_dir: '',
    keep_timestamps: false,
  })
})

test('answers become arguments in manifest order', () => {
  const values = { image: '/tmp/my cat.png', width: '400', format: 'jpeg', output_dir: '/tmp/out' }
  expect(buildCommand(manifest, values)).toEqual({
    program: 'python',
    args: ['resize.py', '/tmp/my cat.png', '--width', '400', '--format', 'jpeg', '--output-dir', '/tmp/out'],
    env: {},
  })
})

test('empty optional answers are left out so the script uses its own default', () => {
  const values = { image: '/tmp/cat.png', width: '', format: '', output_dir: '/tmp/out' }
  expect(buildCommand(manifest, values).args).toEqual([
    'resize.py',
    '/tmp/cat.png',
    '--output-dir',
    '/tmp/out',
  ])
})

test('several files are passed one by one, and a switch only when it is on', () => {
  const on = { transcripts: ['/a.vtt', '/b.vtt'], output_dir: '', keep_timestamps: true }
  expect(buildCommand(transcripts, on).args).toEqual([
    'zoom_to_nvivo.py',
    '/a.vtt',
    '/b.vtt',
    '--keep-timestamps',
  ])
  const off = { ...on, keep_timestamps: false }
  expect(buildCommand(transcripts, off).args).toEqual(['zoom_to_nvivo.py', '/a.vtt', '/b.vtt'])
})

test('an input bound to an environment variable is passed that way', () => {
  const withKey = changed((m) => {
    m.inputs.push(input({ id: 'key', kind: 'text', secret: true, env_binding: 'API_KEY' }))
  })
  const values = { image: '/tmp/cat.png', width: '', format: '', output_dir: '/o', key: 'abc' }
  const command = buildCommand(withKey, values)
  expect(command.env).toEqual({ API_KEY: 'abc' })
  expect(command.args).not.toContain('abc')
})

test('missing and invalid answers produce a message for the user', () => {
  const good = { image: 'a.png', width: '800', format: 'png', output_dir: '/o' }
  expect(checkValues(manifest, good)).toBeNull()
  expect(checkValues(manifest, { ...good, image: '' })).toBe('Please fill in "Picture to resize".')
  expect(checkValues(manifest, { ...good, width: 'abc' })).toBe(
    '"New width (pixels)" must be a number.',
  )
  expect(checkValues(manifest, { ...good, width: '0' })).toBe(
    '"New width (pixels)" must be at least 1.',
  )
  expect(checkValues(manifest, { ...good, format: 'gif' })).toMatch(/choice/)
  expect(checkValues(transcripts, { transcripts: [], output_dir: '', keep_timestamps: false })).toBe(
    'Please fill in "transcripts".',
  )
})

test('the results folder is worked out from the output pattern', () => {
  const values = { image: 'a.png', width: '', format: '', output_dir: '/Users/a/My Pics' }
  expect(resultsFolder(manifest, values)).toBe('/Users/a/My Pics')
  // The pattern needs an input the user left empty.
  expect(resultsFolder(manifest, { ...values, output_dir: '' })).toBeNull()
  // A fixed folder inside the project, and a single named file.
  expect(resultsFolder(changed((m) => (m.outputs[0].path_pattern = 'nvivo_ready/*.txt')), values)).toBe(
    'nvivo_ready',
  )
  expect(resultsFolder(changed((m) => (m.outputs[0].path_pattern = 'out/report.csv')), values)).toBe(
    'out',
  )
  // Only printed text: nothing to open.
  expect(
    resultsFolder(
      changed((m) => (m.outputs = [{ id: 'log', kind: 'console', label: 'Log', path_pattern: null }])),
      values,
    ),
  ).toBeNull()
})

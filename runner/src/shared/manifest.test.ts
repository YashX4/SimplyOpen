import Ajv from 'ajv'
import { expect, test } from 'vitest'
import example from '../../../examples/image_resizer/simplyopen.json'
import schema from '../../../manifest/manifest.schema.json'
import { buildArgs, checkValues, initialValues, type Manifest } from './manifest'

const manifest = example as Manifest

test('the example manifest follows the schema', () => {
  const validate = new Ajv().compile(schema)
  expect(validate(example), JSON.stringify(validate.errors)).toBe(true)
})

test('the schema rejects a choice input without options', () => {
  const broken = structuredClone(example) as any
  delete broken.inputs[2].options
  expect(new Ajv().compile(schema)(broken)).toBe(false)
})

test('the form starts with the manifest defaults', () => {
  expect(initialValues(manifest)).toEqual({ image: '', width: '800', format: 'png' })
})

test('values become arguments in manifest order, ending with the results folder', () => {
  const values = { image: '/tmp/cat.png', width: '400', format: 'jpeg' }
  expect(buildArgs(manifest, values, '/tmp/out')).toEqual([
    '/tmp/cat.png',
    '--width',
    '400',
    '--format',
    'jpeg',
    '--output-dir',
    '/tmp/out',
  ])
})

test('empty optional values are left out so the script uses its own default', () => {
  const values = { image: '/tmp/cat.png', width: '', format: 'png' }
  expect(buildArgs(manifest, values, '/tmp/out')).not.toContain('--width')
})

test('missing and invalid values produce a message for the user', () => {
  expect(checkValues(manifest, { image: '', width: '800', format: 'png' })).toBe(
    'Please fill in "Picture to resize".',
  )
  expect(checkValues(manifest, { image: 'a.png', width: 'abc', format: 'png' })).toBe(
    '"New width (pixels)" must be a number.',
  )
  expect(checkValues(manifest, { image: 'a.png', width: '800', format: 'gif' })).toMatch(/choice/)
  expect(checkValues(manifest, { image: 'a.png', width: '800', format: 'png' })).toBeNull()
})

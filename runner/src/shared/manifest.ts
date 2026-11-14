// The manifest's shape, plus the pure logic that turns form values into
// command-line arguments. Used by both the main process and the page, so it
// must not import anything from Electron, Node or the browser.
// The authoritative definition is manifest/manifest.schema.json.

export type InputType = 'file' | 'text' | 'number' | 'choice'

export interface ManifestInput {
  id: string
  label: string
  type: InputType
  /** "--width" passes `--width <value>`; null passes the bare value. */
  flag: string | null
  required?: boolean
  default?: string
  extensions?: string[]
  options?: { value: string; label: string }[]
}

export interface Manifest {
  manifest_version: 0
  name: string 
  description: string
  entry: string
  requirements?: string
  action_label?: string
  inputs: ManifestInput[]
  results: { flag: string }
  sample?: Record<string, string>
}

/** What the user entered, keyed by input id. */
export type Values = Record<string, string>

/** The values the form starts with. */
export function initialValues(manifest: Manifest): Values {
  const values: Values = {}
  for (const input of manifest.inputs) {
    // A dropdown always has something selected, so fall back to its first option.
    values[input.id] = input.default ?? input.options?.[0]?.value ?? ''
  }
  return values
}

/** Returns a message for the user if something is missing or invalid, else null. */
export function checkValues(manifest: Manifest, values: Values): string | null {
  for (const input of manifest.inputs) {
    const value = (values[input.id] ?? '').trim()
    if (!value) {
      if (input.required) return `Please fill in "${input.label}".`
      continue
    }
    if (input.type === 'number' && !Number.isFinite(Number(value))) {
      return `"${input.label}" must be a number.`
    }
    if (input.type === 'choice' && !input.options?.some((o) => o.value === value)) {
      return `"${input.label}" has a choice that isn't available.`
    }
  }
  return null
}

/** The arguments that follow the script's name on the command line. */
export function buildArgs(manifest: Manifest, values: Values, resultsDir: string): string[] {
  const args: string[] = []
  for (const input of manifest.inputs) {
    const value = (values[input.id] ?? '').trim()
    if (!value) continue
    if (input.flag) args.push(input.flag, value)
    else args.push(value)
  }
  args.push(manifest.results.flag, resultsDir)
  return args
}

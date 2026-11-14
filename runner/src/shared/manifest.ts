// Pure logic for working with a manifest: deciding whether the Runner can open
// a project, checking the user's answers, and turning those answers into the
// command to run. Used by both the main process and the page, so it must not
// import anything from Electron, Node or the browser.
//
// The manifest format itself is owned by the Analyzer and defined in
// analyzer/src/manifest/schema.ts. The types are imported from there so there
// is only one definition.

import type { EntryPoint, Input, Manifest } from '../../../analyzer/src/manifest/schema'

export type { EntryPoint, Input, Manifest }

/**
 * What the Runner reads from the project's simplyopen.json: exactly what the
 * Analyzer returns for a project.
 */
export interface AppDescription {
  manifest: Manifest
  name: string
  description: string
}

/**
 * One answer from the user. Most inputs hold text; an on/off switch holds
 * true/false; a file input that allows several files holds a list of paths.
 */
export type Value = string | boolean | string[]

/** The user's answers, keyed by input id. */
export type Values = Record<string, Value>

/** The entry point the Run button starts. */
export function primaryEntryPoint(manifest: Manifest): EntryPoint | undefined {
  return manifest.project.entry_points.find((e) => e.id === manifest.project.primary_entry_point)
}

/** Splits a command template like "python main.py {args}" into its pieces. */
function pieces(template: string): string[] {
  return template.trim().split(/\s+/).filter(Boolean)
}

/**
 * The manifest format can describe far more than the Runner can run so far.
 * Returns a plain-English reason if this project is outside what's supported,
 * or null if the Runner can open it.
 */
export function unsupportedReason(manifest: Manifest): string | null {
  if (manifest.schema_version !== '1.0') {
    return 'This app was made for a different version of SimplyOpen.'
  }
  if (manifest.project.language !== 'python') {
    return 'Only Python projects can be opened so far.'
  }
  if (manifest.project.build_command) {
    return 'This project needs a build step, which is not supported yet.'
  }
  const entry = primaryEntryPoint(manifest)
  if (!entry?.run_command) {
    return 'SimplyOpen could not work out how to start this project.'
  }
  if (entry.interface.kind !== 'command_line') {
    return 'Games, apps with their own window, and apps that ask questions while running are not supported yet.'
  }
  if (!['python', 'python3'].includes(pieces(entry.run_command)[0])) {
    return 'This project is started in a way that is not supported yet.'
  }
  return null
}

function hasValue(value: Value | undefined): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return value === true
}

/** The values the form starts with. */
export function initialValues(manifest: Manifest): Values {
  const values: Values = {}
  for (const input of manifest.inputs) {
    if (input.kind === 'boolean') values[input.id] = input.default === true
    else if (input.multiple) values[input.id] = []
    else values[input.id] = input.default == null ? '' : String(input.default)
  }
  return values
}

/** Returns a message for the user if something is missing or invalid, else null. */
export function checkValues(manifest: Manifest, values: Values): string | null {
  for (const input of manifest.inputs) {
    const value = values[input.id]
    if (!hasValue(value)) {
      if (input.required) return `Please fill in "${input.label}".`
      continue
    }
    if (input.kind === 'number') {
      const number = Number(value)
      if (!Number.isFinite(number)) return `"${input.label}" must be a number.`
      if (input.min != null && number < input.min) {
        return `"${input.label}" must be at least ${input.min}.`
      }
      if (input.max != null && number > input.max) {
        return `"${input.label}" must be at most ${input.max}.`
      }
    }
    if (input.kind === 'choice' && !input.choices?.includes(String(value))) {
      return `"${input.label}" has a choice that isn't available.`
    }
  }
  return null
}

/**
 * Renders one input's cli_binding. "--width {value}" with 400 gives
 * ["--width", "400"]. The value always stays one piece, even if it has spaces.
 */
function renderBinding(binding: string, value: string): string[] {
  return pieces(binding).map((piece) => piece.replace('{value}', value))
}

export interface Command {
  /** The program named in the manifest, e.g. "python". The main process swaps in the real Python. */
  program: string
  /** Everything after the program name. */
  args: string[]
  /** Extra environment variables to set, for inputs passed that way (e.g. an API key). */
  env: Record<string, string>
}

/** Turns the user's answers into the command described by the primary entry point. */
export function buildCommand(manifest: Manifest, values: Values): Command {
  const inputArgs: string[] = []
  const env: Record<string, string> = {}

  for (const input of manifest.inputs) {
    const value = values[input.id]
    if (!hasValue(value)) continue

    if (input.cli_binding) {
      if (typeof value === 'boolean') {
        // A switch has no value: its binding is added as-is when it's on.
        inputArgs.push(...pieces(input.cli_binding))
      } else if (Array.isArray(value)) {
        // Several files: the binding is rendered once per file.
        for (const item of value) inputArgs.push(...renderBinding(input.cli_binding, item))
      } else {
        inputArgs.push(...renderBinding(input.cli_binding, value.trim()))
      }
    }
    if (input.env_binding && !Array.isArray(value)) {
      env[input.env_binding] = String(value).trim()
    }
  }

  // "python resize.py {args}" -> program "python", args ["resize.py", ...inputArgs]
  const [program, ...rest] = pieces(primaryEntryPoint(manifest)?.run_command ?? '')
  const args = rest.flatMap((piece) => (piece === '{args}' ? inputArgs : [piece]))
  return { program, args, env }
}

/** Whether the project writes files the user can open afterwards. */
export function hasFileResults(manifest: Manifest): boolean {
  return manifest.outputs.some((o) => o.kind !== 'console' && o.path_pattern)
}

/**
 * The folder holding the results, worked out from the first file or folder
 * output's path_pattern. "{output_dir}/*.png" with output_dir "/Users/a/Pics"
 * gives "/Users/a/Pics". The result may be relative to the project's working
 * directory; "" means the working directory itself. Null if there are no file
 * results or the pattern refers to an input the user left empty.
 */
export function resultsFolder(manifest: Manifest, values: Values): string | null {
  const output = manifest.outputs.find((o) => o.kind !== 'console' && o.path_pattern)
  if (!output?.path_pattern) return null

  // Keep the leading part of the pattern that is a plain folder path: stop at
  // the first piece with a wildcard, and drop the file name of a file output.
  const segments = output.path_pattern.split('/')
  const wildcard = segments.findIndex((segment) => /[*?[]/.test(segment))
  let folder = wildcard === -1 ? segments : segments.slice(0, wildcard)
  if (wildcard === -1 && output.kind === 'file') folder = folder.slice(0, -1)

  // Replace {input id} placeholders with what the user entered.
  let missing = false
  const path = folder.join('/').replace(/\{([^}]+)\}/g, (_match, id: string) => {
    const value = values[id]
    if (typeof value !== 'string' || !value.trim()) missing = true
    return typeof value === 'string' ? value.trim() : ''
  })
  return missing ? null : path
}

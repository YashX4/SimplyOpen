/**
 * @file SimplyOpen manifest v0 — SHARED CONTRACT (TypeScript types).
 *
 * The authoritative definition is `manifest/manifest.schema.json` at the
 * repository root (owned with the Runner). `src/manifest/schema.json` is an
 * exact copy, used by the Analyzer to validate Claude's answers; the tests
 * fail if the two ever differ. These types mirror the Runner's
 * `runner/src/shared/manifest.ts`. DO NOT CHANGE field names, types or
 * meanings here without changing the shared schema and the Runner too.
 *
 * The manifest is saved as `simplyopen.json` in the project's top folder
 * (the "project folder"). Every path in it is relative to that folder.
 *
 * How the Runner uses it (from `runner/src/main/index.ts`):
 *   - It runs `python <entry> <args…>` with the project folder as the
 *     working directory.
 *   - `<args…>` are built from `inputs`, in order: an input with a value adds
 *     `flag value`, or just `value` when `flag` is null; an input left empty
 *     adds nothing, so the script uses its own default. Last comes
 *     `results.flag <new folder>`, a fresh folder the Runner creates for every
 *     run, where the script must save what it makes.
 *   - Values are always strings; a file input's value is the full path the
 *     person picked.
 *
 * Rules JSON Schema can't express, which the Analyzer checks in code
 * (`analyzer.ts`) before returning a manifest:
 *   - `entry` is a `.py` file that exists in the project folder; `requirements`
 *     (when set) exists too. Paths use forward slashes, with no leading `./`
 *     or `/` and no `..`.
 *   - Input ids are unique.
 *   - Every `flag` and `results.flag` looks like `-x` or `--name`, and no flag
 *     is used twice (the results flag included).
 *   - An input with `flag: null` is `required`: values passed by position
 *     only line up if none of them is left out.
 *   - `extensions` only on file inputs and in lower case; `options` only on
 *     choice inputs, with no repeated values; no `default` on file inputs.
 *   - A choice's `default` is one of its option values; a number's `default`
 *     is a number.
 *   - `action_label` is short (at most 30 characters).
 *   - `sample` (when present) has a value for every required input and only
 *     for real input ids; file values are files in the project folder with an
 *     allowed extension; choice values are option values; number values are
 *     numbers.
 *   - `name` is a few words; `description` is short and free of technical
 *     words.
 *
 * This file has no imports, so it can be read on its own.
 */

/** The kinds of control the Runner can show. */
export type InputType = "file" | "text" | "number" | "choice";

/** One control in the Runner's window; each becomes one command-line argument. */
export interface ManifestInput {
  /** Unique snake_case name for this input, used as the key in `sample`. */
  id: string;
  /** Plain-English text shown next to the control. */
  label: string;
  /** file: pick a file. text: type anything. number: type a number. choice: pick one of `options`. */
  type: InputType;
  /** `"--width"` passes `--width <value>`; null passes the bare value by position, in the order inputs are listed. */
  flag: string | null;
  /** If true, the person must fill this in before running. */
  required?: boolean;
  /** Value the control starts with. */
  default?: string;
  /** For file inputs: allowed file endings, without the dot. */
  extensions?: string[];
  /** For choice inputs (required there): `value` goes to the script, `label` is shown. */
  options?: { value: string; label: string }[];
}

/** A SimplyOpen manifest, version 0. */
export interface Manifest {
  manifest_version: 0;
  /** Short app name shown in the window title. */
  name: string;
  /** One or two plain-English sentences saying what the app does. */
  description: string;
  /** The Python file to run, relative to the project folder. */
  entry: string;
  /** File listing the libraries to install, relative to the project folder. Left out if none are needed. */
  requirements?: string;
  /** Text on the main button. Defaults to "Run". */
  action_label?: string;
  /** The controls to show, in order. */
  inputs: ManifestInput[];
  /** The flag the script uses for the folder where it saves its results. */
  results: { flag: string };
  /** Known-good values for an automatic test run, keyed by input id. File values are relative to the project folder. */
  sample?: Record<string, string>;
}

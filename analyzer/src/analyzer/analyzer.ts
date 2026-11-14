/**
 * @file `analyzeZip`: an uploaded zip in, a validated SimplyOpen v0
 * manifest out (or a plain-English reason why the project doesn't fit v0).
 *
 * Pipeline: extract to a request-scoped temp dir → build the bounded
 * project summary → ask Claude (with an explicit note listing omitted files
 * when the summary is truncated) → validate the answer → if invalid, retry
 * exactly once with the problems appended → return, or throw. The temp dir
 * is always deleted.
 *
 * Side effects are limited to the Claude API call and the temp directory.
 * Never returns a manifest that failed validation.
 */

import { AnthropicClaudeClient, type ClaudeClient, type RawAnalysis } from "./claudeClient.js";
import { AnalysisFailedError, SchemaValidationError, UnsupportedProjectError } from "./errors.js";
import { buildProjectSummary, extractZip } from "./projectSummary.js";
import type { Manifest } from "../manifest/schema.js";
import manifestJsonSchema from "../manifest/schema.json" with { type: "json" };

/** The summary type, taken from the builder so this file needs no extra import. */
type ProjectSummary = Awaited<ReturnType<typeof buildProjectSummary>>;

/** The Analyzer's output. */
export interface AnalysisResult {
  /** Manifest that passed validation against `src/manifest/schema.json` and the contract's code-level rules. */
  manifest: Manifest;
  /** The app's name (the same as `manifest.name`). */
  name: string;
  /** The app's plain-English description (the same as `manifest.description`). */
  description: string;
  /**
   * The folder in the zip that is the project folder: where `simplyopen.json`
   * belongs, and what every path in the manifest is relative to. `""` means
   * the zip's root; e.g. `"image_resizer"` when the project was zipped as a folder.
   */
  projectFolder: string;
  /** One short plain-English sentence per guess or doubt the model had; empty when there were none. */
  notes: string[];
  /**
   * The model's raw reply, one entry per attempt (one, or two after a retry).
   * For logging and debugging ONLY: never pass it downstream.
   */
  rawModelOutput: string[];
}

/** Optional settings for {@link analyzeZip}. */
export interface AnalyzeOptions {
  /** Cancels the analysis (e.g. when the HTTP client disconnects). */
  signal?: AbortSignal;
  /** Parent directory for the request's temp dir. Default `os.tmpdir()`. */
  tmpRoot?: string;
}

/** Total model calls allowed: the first attempt plus one retry. */
const MAX_ATTEMPTS = 2;

/**
 * Analyze a zipped project.
 *
 * Safe to call concurrently: each call has its own temp directory and no
 * state is shared between calls.
 *
 * @param zipPath Path to the uploaded `.zip`.
 * @param client Model client. Defaults to a new {@link AnthropicClaudeClient}
 *   using credentials from the environment. Pass a fake in tests.
 * @param options See {@link AnalyzeOptions}.
 * @returns The validated manifest and project folder, plus raw model output for logs.
 * @throws {UnzipError} The archive is missing, not a zip, unsafe, over a limit, or empty.
 * @throws {UnsupportedProjectError} The project can't be described by the v0
 *   manifest (e.g. it isn't Python, or it's a game). Its message says why, in plain English.
 * @throws {ClaudeApiError} The model call failed, timed out, was cancelled, or was refused. Not retried.
 * @throws {AnalysisFailedError} Both attempts produced an invalid answer. Its `cause` is a
 *   {@link SchemaValidationError} listing the last attempt's problems.
 */
export async function analyzeZip(
  zipPath: string,
  client: ClaudeClient = new AnthropicClaudeClient(),
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const signal = options.signal ?? new AbortController().signal;
  const { dir, cleanup } = await extractZip(zipPath, {}, options.tmpRoot);
  try {
    const summary = await buildProjectSummary(dir);
    // When contents were cut, tell the model exactly which files it can't see.
    const omittedFiles = summary.truncated ? summary.skippedFiles : [];

    const rawModelOutput: string[] = [];
    let issues: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const retry = attempt > 1 ? { issues, previousAnswer: rawModelOutput[rawModelOutput.length - 1] ?? "" } : undefined;
      const raw = await client.analyzeProject(summary, signal, { omittedFiles, retry });
      rawModelOutput.push(raw.rawModelOutput);

      const checked = checkAnswer(raw, summary);
      if (checked.ok === "unsupported") throw new UnsupportedProjectError(checked.reason);
      if (checked.ok) {
        const { manifest, projectFolder, notes } = checked;
        return { manifest, name: manifest.name, description: manifest.description, projectFolder, notes, rawModelOutput };
      }
      issues = checked.issues;
    }

    throw new AnalysisFailedError(`The model's answer was still invalid after ${MAX_ATTEMPTS} attempts`, {
      cause: new SchemaValidationError(`Manifest failed validation: ${issues.join("; ")}`),
    });
  } finally {
    await cleanup();
  }
}

/* ------------------------------------------------------------------------ */
/* Checking one answer                                                      */
/* ------------------------------------------------------------------------ */

type Checked =
  | { ok: true; manifest: Manifest; projectFolder: string; notes: string[] }
  | { ok: "unsupported"; reason: string }
  | { ok: false; issues: string[] };

/** Validate everything the model returned. Never throws; returns every problem found. */
function checkAnswer(raw: RawAnalysis, summary: ProjectSummary): Checked {
  if (raw.project_folder === undefined && raw.manifest === undefined && raw.unsupported_reason === undefined && raw.notes === undefined) {
    return { ok: false, issues: ["No answer was submitted: call the submit_analysis tool with the complete answer."] };
  }
  const projectFiles = [...summary.fileTree.map((f) => f.path), ...summary.skippedFiles, ...summary.assetFiles];
  const issues: string[] = [...checkNotes(raw.notes)];

  // Exactly one of manifest and unsupported_reason.
  const hasManifest = raw.manifest !== null && raw.manifest !== undefined;
  const hasReason = raw.unsupported_reason !== null && raw.unsupported_reason !== undefined;
  if (hasManifest === hasReason) {
    issues.push("Exactly one of manifest and unsupported_reason must be set; the other must be null.");
    return { ok: false, issues };
  }
  if (hasReason) {
    const reason = raw.unsupported_reason;
    if (typeof reason !== "string" || reason.trim() === "") issues.push("/unsupported_reason: must be a non-empty string");
    else if (reason.trim().length > 500) issues.push("/unsupported_reason: must be one to three short sentences (at most 500 characters)");
    return issues.length > 0 ? { ok: false, issues } : { ok: "unsupported", reason: (reason as string).trim() };
  }

  const folderIssues = checkProjectFolder(raw.project_folder, projectFiles);
  issues.push(...folderIssues);
  // The file checks need a valid folder; without one, check the manifest's shape only.
  const manifestProblems = folderIssues.length === 0
    ? manifestIssues(raw.manifest, projectFiles, raw.project_folder as string)
    : validateAgainstSchema(raw.manifest);
  issues.push(...manifestProblems.map((i) => `manifest${i}`));

  if (issues.length > 0) return { ok: false, issues };
  const manifest = raw.manifest as Manifest;
  return {
    ok: true,
    manifest: { ...manifest, name: manifest.name.trim(), description: manifest.description.trim() },
    projectFolder: raw.project_folder as string,
    notes: (raw.notes as string[]).map((n) => n.trim()),
  };
}

function checkNotes(notes: unknown): string[] {
  if (!Array.isArray(notes) || !notes.every((n) => typeof n === "string")) return ["/notes: must be a list of strings (empty if none)"];
  return notes.length > 10 ? ["/notes: at most 10 notes"] : [];
}

function checkProjectFolder(folder: unknown, projectFiles: readonly string[]): string[] {
  if (typeof folder !== "string") return ["/project_folder: must be a string (\"\" for the zip's root)"];
  const problem = archivePathProblem(folder, { allowEmpty: true });
  if (problem) return [`/project_folder: "${folder}" ${problem}`];
  if (folder !== "" && !projectFiles.some((f) => f.startsWith(`${folder}/`))) {
    return [`/project_folder: "${folder}" is not a folder in the project tree`];
  }
  return [];
}

function checkName(name: string): string[] {
  if (name.trim() === "") return ["/name: must not be empty"];
  const words = name.trim().split(/\s+/).length;
  return name.trim().length > 60 || words > 8 ? ["/name: must be a few words (at most 8 words and 60 characters)"] : [];
}

/** Technical words that must not appear in a description written for people who have never coded. */
const JARGON = [/\bCLI\b/i, /\bcommand[- ]line\b/i, /\bterminal\b/i, /\bstdin\b/i, /\bstdout\b/i, /\bargv\b/i, /\brepo(sitory)?\b/i];

function checkDescription(description: string): string[] {
  if (description.trim() === "") return ["/description: must not be empty"];
  const issues: string[] = [];
  if (description.trim().length > 300) issues.push("/description: must be one or two short sentences (at most 300 characters)");
  const found = JARGON.map((re) => description.match(re)?.[0]).filter((w): w is string => w !== undefined);
  if (found.length > 0) issues.push(`/description: must avoid technical words for non-coders (found: ${found.join(", ")})`);
  return issues;
}

/**
 * Every problem with a candidate manifest: first `schema.json`, then (only if
 * the shape is right) the code-level rules in {@link manifestRuleIssues}.
 *
 * @param value The candidate manifest (untrusted).
 * @param projectFiles Every file path in the zip (relative to the zip root).
 * @param projectFolder The project folder, relative to the zip root (`""` for the root).
 * @returns One line per problem, each starting with a JSON pointer into the manifest; empty when valid.
 */
export function manifestIssues(value: unknown, projectFiles: readonly string[], projectFolder: string): string[] {
  const schemaIssues = validateAgainstSchema(value);
  return schemaIssues.length > 0 ? schemaIssues : manifestRuleIssues(value as Manifest, projectFiles, projectFolder);
}

/** What a flag must look like: `-x` or `--some-name`. */
const FLAG = /^--?[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Rules from `schema.ts` that JSON Schema cannot express, plus grounding
 * checks that the files the manifest names exist in the project folder.
 *
 * @param m A manifest that already passed `schema.json`.
 * @param projectFiles Every file path in the zip (relative to the zip root).
 * @param projectFolder The project folder, relative to the zip root (`""` for the root).
 * @returns One line per problem, each starting with a JSON pointer into the manifest; empty when valid.
 */
function manifestRuleIssues(m: Manifest, projectFiles: readonly string[], projectFolder: string): string[] {
  const issues: string[] = [...checkName(m.name), ...checkDescription(m.description)];
  const files = new Set(projectFiles);
  const inFolder = (p: string): string => (projectFolder === "" ? p : `${projectFolder}/${p}`);
  const where = projectFolder === "" ? "the project" : `the project folder "${projectFolder}"`;

  // Files the Runner opens.
  const entryProblem = archivePathProblem(m.entry, { allowEmpty: false });
  if (entryProblem) issues.push(`/entry: "${m.entry}" ${entryProblem}`);
  else if (!m.entry.endsWith(".py")) issues.push(`/entry: "${m.entry}" must be a Python (.py) file`);
  else if (!files.has(inFolder(m.entry))) {
    const elsewhere = projectFiles.find((f) => f === m.entry || f.endsWith(`/${m.entry}`));
    issues.push(`/entry: there is no "${m.entry}" in ${where}${elsewhere ? ` (it exists at "${elsewhere}" in the zip; paths are relative to project_folder)` : ""}`);
  }
  if (m.requirements !== undefined) {
    const problem = archivePathProblem(m.requirements, { allowEmpty: false });
    if (problem) issues.push(`/requirements: "${m.requirements}" ${problem}`);
    else if (!files.has(inFolder(m.requirements))) issues.push(`/requirements: there is no "${m.requirements}" in ${where}`);
  }
  if (m.action_label !== undefined && (m.action_label.trim() === "" || m.action_label.trim().length > 30)) {
    issues.push("/action_label: must be a short button label (1 to 30 characters)");
  }

  // Flags: well-formed and never used twice (the results flag included).
  const seenIds = new Set<string>();
  const seenFlags = new Map<string, string>();
  const useFlag = (flag: string, at: string): void => {
    if (!FLAG.test(flag)) issues.push(`${at}: "${flag}" must look like "-x" or "--name" (the value is added by the Runner)`);
    const previous = seenFlags.get(flag);
    if (previous) issues.push(`${at}: "${flag}" is already used at ${previous}`);
    else seenFlags.set(flag, at);
  };

  m.inputs.forEach((input, i) => {
    const at = `/inputs/${i}`;
    if (seenIds.has(input.id)) issues.push(`${at}/id: "${input.id}" is used more than once`);
    seenIds.add(input.id);
    if (input.flag !== null) useFlag(input.flag, `${at}/flag`);
    else if (input.required !== true) {
      issues.push(`${at}: an input with flag null is passed by position, so it must be required (leaving it empty would shift the others)`);
    }
    if (input.extensions !== undefined) {
      if (input.type !== "file") issues.push(`${at}/extensions: only file inputs have extensions`);
      for (const ext of input.extensions) if (ext !== ext.toLowerCase()) issues.push(`${at}/extensions: "${ext}" must be lower case`);
    }
    if (input.options !== undefined) {
      if (input.type !== "choice") issues.push(`${at}/options: only choice inputs have options`);
      const values = input.options.map((o) => o.value);
      for (const v of new Set(values.filter((v, j) => values.indexOf(v) !== j))) issues.push(`${at}/options: value "${v}" is used more than once`);
    }
    if (input.default !== undefined) {
      const problem = valueProblem(input, input.default);
      if (input.type === "file") issues.push(`${at}/default: file inputs have no default`);
      else if (problem) issues.push(`${at}/default: ${problem}`);
    }
  });
  useFlag(m.results.flag, "/results/flag");

  // sample: a known-good value for every required input, and only for real inputs.
  if (m.sample !== undefined) {
    for (const key of Object.keys(m.sample)) {
      if (!seenIds.has(key)) issues.push(`/sample/${key}: "${key}" is not the id of any input`);
    }
    m.inputs.forEach((input) => {
      const value = m.sample?.[input.id];
      const at = `/sample/${input.id}`;
      if (value === undefined) {
        if (input.required === true) issues.push(`${at}: every required input needs a sample value`);
        return;
      }
      if (input.type === "file") {
        const problem = archivePathProblem(value, { allowEmpty: false });
        if (problem) issues.push(`${at}: "${value}" ${problem}`);
        else if (!files.has(inFolder(value))) issues.push(`${at}: there is no "${value}" in ${where}`);
        else if (input.extensions?.length && !input.extensions.includes(value.split(".").pop()?.toLowerCase() ?? "")) {
          issues.push(`${at}: "${value}" doesn't end in one of the allowed extensions (${input.extensions.join(", ")})`);
        }
      } else {
        const problem = valueProblem(input, value);
        if (problem) issues.push(`${at}: ${problem}`);
      }
    });
  }
  return issues;
}

/** Why `value` isn't a valid value for a number or choice input, or null. */
function valueProblem(input: Manifest["inputs"][number], value: string): string | null {
  if (input.type === "number" && (value.trim() === "" || !Number.isFinite(Number(value)))) return `"${value}" is not a number`;
  if (input.type === "choice" && !(input.options ?? []).some((o) => o.value === value)) return `"${value}" is not one of the option values`;
  return null;
}

/**
 * Why `p` isn't a clean relative path (forward slashes, no leading `/` or
 * `./`, no `..`, no trailing `/`, no drive letter), or `null` if it is.
 */
function archivePathProblem(p: string, { allowEmpty }: { allowEmpty: boolean }): string | null {
  if (p === "") return allowEmpty ? null : "must not be empty";
  if (p.includes("\\")) return "must use forward slashes";
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return "must be a relative path, not absolute";
  if (p.startsWith("./")) return 'must not start with "./"';
  if (p.split("/").includes("..")) return 'must not contain ".."';
  if (p.endsWith("/")) return 'must not end with "/"';
  return null;
}

/* ------------------------------------------------------------------------ */
/* Built-in JSON Schema validator                                           */
/* ------------------------------------------------------------------------ */

/*
 * A small validator for exactly the JSON Schema (draft-07) keywords that
 * `src/manifest/schema.json` uses. It lives here because this directory may
 * only depend on Node built-ins and the Claude SDK. If `schema.json` ever
 * gains a keyword this validator does not implement, loading this module
 * throws, so a rule can never be silently skipped.
 */

type SchemaNode = boolean | { [keyword: string]: unknown };

/** Keywords implemented below. Annotations ($schema, $id, title, description) have no effect on validation. */
const SUPPORTED_KEYWORDS = new Set([
  "$schema", "$id", "title", "description", "definitions",
  "type", "const", "enum", "required", "properties", "additionalProperties", "items", "minItems",
  "minLength", "pattern",
  "$ref", "if", "then", "else", "not", "anyOf",
]);

const ROOT_SCHEMA = manifestJsonSchema as unknown as SchemaNode;
assertSupported(ROOT_SCHEMA, "#");

/** Throw if any schema position uses a keyword this validator does not implement. */
function assertSupported(node: SchemaNode, where: string): void {
  if (typeof node === "boolean") return;
  for (const [keyword, value] of Object.entries(node)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(`schema.json uses JSON Schema keyword "${keyword}" at ${where}, which analyzer.ts does not implement`);
    }
    if (keyword === "properties" || keyword === "definitions") {
      for (const [name, sub] of Object.entries(value as Record<string, SchemaNode>)) assertSupported(sub, `${where}/${keyword}/${name}`);
    } else if (["items", "additionalProperties", "if", "then", "else", "not"].includes(keyword)) {
      assertSupported(value as SchemaNode, `${where}/${keyword}`);
    } else if (keyword === "anyOf") {
      (value as SchemaNode[]).forEach((sub, i) => assertSupported(sub, `${where}/anyOf/${i}`));
    }
  }
}

/**
 * Validate a value against `schema.json`.
 *
 * @returns One line per problem, each starting with a JSON pointer (e.g.
 *   `"/inputs/0/kind: must be one of ..."`); empty when valid.
 */
function validateAgainstSchema(value: unknown): string[] {
  return validateNode(ROOT_SCHEMA, value, "");
}

function validateNode(schema: SchemaNode, value: unknown, at: string): string[] {
  const here = at === "" ? "(root)" : at;
  if (schema === true) return [];
  if (schema === false) return [`${here}: is not allowed`];

  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace(/^#\/definitions\//, "");
    const target = (ROOT_SCHEMA as { definitions?: Record<string, SchemaNode> }).definitions?.[name];
    if (target === undefined) throw new Error(`schema.json has an unresolvable $ref "${schema.$ref}"`);
    return validateNode(target, value, at); // draft-07: keywords next to $ref are ignored
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => hasType(value, t))) return [`${here}: must be ${types.join(" or ")}`];
  }

  const issues: string[] = [];
  if (Array.isArray(schema.anyOf)) {
    // Valid if any branch is; otherwise report the closest branch's problems (fewest issues).
    const results = (schema.anyOf as SchemaNode[]).map((sub) => validateNode(sub, value, at));
    if (!results.some((r) => r.length === 0)) {
      issues.push(...results.reduce((best, r) => (r.length < best.length ? r : best)));
    }
  }
  if ("const" in schema && !deepEqual(value, schema.const)) {
    issues.push(`${here}: must be ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(value, option))) {
    issues.push(`${here}: must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (typeof value === "string") {
    // JSON Schema counts characters (code points), not UTF-16 units; patterns are unanchored ECMA regexes.
    if (typeof schema.minLength === "number" && [...value].length < schema.minLength) {
      issues.push(`${here}: must be at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"} long`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      issues.push(`${here}: must match the pattern ${schema.pattern}`);
    }
  }

  if (isPlainObject(value)) {
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in value)) issues.push(`${here}: is missing required property "${key}"`);
    }
    const properties = (schema.properties as Record<string, SchemaNode> | undefined) ?? {};
    for (const [key, sub] of Object.entries(properties)) {
      if (key in value) issues.push(...validateNode(sub, value[key], `${at}/${key}`));
    }
    if (schema.additionalProperties !== undefined) {
      for (const key of Object.keys(value)) {
        if (key in properties) continue;
        if (schema.additionalProperties === false) issues.push(`${here}: has unexpected property "${key}"`);
        else issues.push(...validateNode(schema.additionalProperties as SchemaNode, value[key], `${at}/${key}`));
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      issues.push(`${here}: must have at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => issues.push(...validateNode(schema.items as SchemaNode, item, `${at}/${i}`)));
    }
  }

  if (schema.if !== undefined) {
    const branch = validateNode(schema.if as SchemaNode, value, at).length === 0 ? schema.then : schema.else;
    if (branch !== undefined) issues.push(...validateNode(branch as SchemaNode, value, at));
  }

  if (schema.not !== undefined && validateNode(schema.not as SchemaNode, value, at).length === 0) {
    const forbidden = isPlainObject(schema.not) && Array.isArray(schema.not.required) ? (schema.not.required as string[]) : [];
    issues.push(
      forbidden.length > 0
        ? `${here}: must not have property ${forbidden.map((k) => `"${k}"`).join(", ")} here`
        : `${here}: matches a form that is not allowed here`,
    );
  }
  return issues;
}

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return isPlainObject(value);
    default: throw new Error(`schema.json uses unknown type "${type}"`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

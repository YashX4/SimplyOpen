/**
 * @file `analyzeZip`: an uploaded zip in, a validated manifest plus a
 * plain-English name and description out, with a status saying how much of
 * the project was read and whether keys were left in it.
 *
 * Pipeline: extract to a request-scoped temp dir → scan every file for
 * leaked keys and build the bounded project summary (with any keys blanked
 * out, so they never reach Claude) → ask Claude (with an explicit note listing omitted files
 * when the summary is truncated) → validate the answer → if invalid, retry
 * exactly once with the problems appended → return, or throw. The temp dir
 * is always deleted.
 *
 * Side effects are limited to the Claude API call and the temp directory.
 * Never returns a manifest that failed validation.
 */

import { AnthropicClaudeClient, type ClaudeClient, type RawAnalysis } from "./claudeClient.js";
import { AnalysisFailedError, SchemaValidationError } from "./errors.js";
import { buildProjectSummary, extractZip } from "./projectSummary.js";
import { redactSecrets, scanForSecrets, type LeakedKey } from "./secretScan.js";
import type { Manifest } from "../manifest/schema.js";
import manifestJsonSchema from "../manifest/schema.json" with { type: "json" };

/** The summary type, taken from the builder so this file needs no extra import. */
type ProjectSummary = Awaited<ReturnType<typeof buildProjectSummary>>;

/** The Analyzer's output. */
export interface AnalysisResult {
  /** Manifest that passed validation against `src/manifest/schema.json` and the contract's code-level rules. */
  manifest: Manifest;
  /** A few human-readable words naming the project. */
  name: string;
  /** What it does: one or two plain-English sentences for people who have never coded, at most {@link MAX_DESCRIPTION_LENGTH} characters. */
  description: string;
  /** Facts about the analysis itself, for "Read the files" and "Checked for leaked keys". See {@link AnalysisStatus}. */
  status: AnalysisStatus;
  /**
   * The model's raw reply, one entry per attempt (one, or two after a retry).
   * For logging and debugging ONLY: never pass it downstream.
   */
  rawModelOutput: string[];
}

/**
 * Facts about how the analysis went, worked out by code (not by Claude), for
 * the project page's "Read the files" and "Checked for leaked keys" lines.
 * Facts only: the page's own templates write the sentences.
 */
export interface AnalysisStatus {
  /** "Read the files": how much of the project's code and text Claude read in full. */
  readTheFiles: {
    /** True when Claude read every file in full (nothing was left out for size). */
    complete: boolean;
    /** Files Claude read in full. */
    filesRead: number;
    /** Files whose contents were left out for size (Claude saw only their names, or not even that). */
    filesNotRead: number;
    /** Files skipped on purpose because they aren't code or text (images, sounds, archives, dependency and cache folders). */
    filesSkippedByDesign: number;
  };
  /** "Checked for leaked keys": API keys, tokens, private keys and passwords left in the project. */
  leakedKeys: {
    /** True when every text file was checked (none was too big to scan). */
    complete: boolean;
    /** Text files checked. */
    filesChecked: number;
    /** Text files too big to check. */
    filesNotChecked: number;
    /** How many likely leaked keys were found. 0 means none. */
    totalFound: number;
    /** Where they are and what kind they look like (the first 50). Never the keys themselves. */
    found: LeakedKey[];
  };
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
 * @returns The validated manifest, name and description, the status, plus raw model output for logs.
 * @throws {UnzipError} The archive is missing, not a zip, unsafe, over a limit, or empty.
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
    const [built, scan] = await Promise.all([buildProjectSummary(dir), scanForSecrets(dir)]);
    // Keys left in the project are blanked out before anything is sent to Claude.
    const summary: ProjectSummary = {
      ...built,
      includedFiles: new Map([...built.includedFiles].map(([p, text]) => [p, redactSecrets(text, p)])),
      keyLines: built.keyLines.map((k) => ({ ...k, text: redactSecrets(k.text, k.path) })),
    };
    const status: AnalysisStatus = {
      readTheFiles: {
        complete: !summary.truncated,
        filesRead: summary.includedFiles.size,
        filesNotRead: summary.skippedFiles.length,
        filesSkippedByDesign: summary.excludedFileCount,
      },
      leakedKeys: scan,
    };
    // When contents were cut, tell the model exactly which files it can't see.
    const omittedFiles = summary.truncated ? summary.skippedFiles : [];

    const rawModelOutput: string[] = [];
    let issues: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const retry = attempt > 1 ? { issues, previousAnswer: rawModelOutput[rawModelOutput.length - 1] ?? "" } : undefined;
      const raw = await client.analyzeProject(summary, signal, { omittedFiles, retry });
      rawModelOutput.push(raw.rawModelOutput);

      const checked = checkAnswer(raw, summary);
      if (checked.ok) {
        return { manifest: checked.manifest, name: checked.name, description: checked.description, status, rawModelOutput };
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

type Checked = { ok: true; manifest: Manifest; name: string; description: string } | { ok: false; issues: string[] };

/** Validate everything the model returned. Never throws; returns every problem found. */
function checkAnswer(raw: RawAnalysis, summary: ProjectSummary): Checked {
  if (raw.manifest === undefined && raw.name === undefined && raw.description === undefined) {
    return { ok: false, issues: ["No answer was submitted: call the submit_analysis tool with the complete answer."] };
  }
  const issues = [...checkName(raw.name), ...checkDescription(raw.description)];
  const schemaIssues = validateAgainstSchema(raw.manifest);
  issues.push(...schemaIssues.map((i) => `manifest${i}`));
  // Code-level contract rules assume the shape is right, so only run them on a schema-valid manifest.
  if (schemaIssues.length === 0) issues.push(...contractRuleIssues(raw.manifest as Manifest, summary).map((i) => `manifest${i}`));

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest: raw.manifest as Manifest, name: (raw.name as string).trim(), description: (raw.description as string).trim() };
}

function checkName(name: unknown): string[] {
  if (typeof name !== "string" || name.trim() === "") return ["/name: must be a non-empty string"];
  const words = name.trim().split(/\s+/).length;
  return name.trim().length > MAX_NAME_LENGTH || words > 8 ? [`/name: must be a few words (at most 8 words and ${MAX_NAME_LENGTH} characters)`] : [];
}

/** Longest allowed name, in characters (the project page's limit). */
export const MAX_NAME_LENGTH = 60;

/** Longest allowed description ("What it does" on the project page), in characters. */
export const MAX_DESCRIPTION_LENGTH = 200;

/** Technical words that must not appear in a description written for people who have never coded. */
const JARGON = [/\bCLI\b/i, /\bcommand[- ]line\b/i, /\bterminal\b/i, /\bstdin\b/i, /\bstdout\b/i, /\bargv\b/i, /\brepo(sitory)?\b/i];

function checkDescription(description: unknown): string[] {
  if (typeof description !== "string" || description.trim() === "") return ["/description: must be a non-empty string"];
  const issues: string[] = [];
  const length = description.trim().length;
  if (length > MAX_DESCRIPTION_LENGTH) {
    issues.push(`/description: must be at most ${MAX_DESCRIPTION_LENGTH} characters (it is ${length}); say what it does in one or two short sentences`);
  }
  const found = JARGON.map((re) => description.match(re)?.[0]).filter((w): w is string => w !== undefined);
  if (found.length > 0) issues.push(`/description: must avoid technical words for non-coders (found: ${found.join(", ")})`);
  return issues;
}

/**
 * Rules from `schema.ts` that JSON Schema cannot express, plus a grounding
 * check that entry points name real files.
 */
function contractRuleIssues(m: Manifest, summary: ProjectSummary): string[] {
  const issues: string[] = [];
  const duplicates = (ids: string[]): string[] => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

  const entryIds = m.project.entry_points.map((e) => e.id);
  for (const id of duplicates(entryIds)) issues.push(`/project/entry_points: id "${id}" is used more than once`);
  if (!entryIds.includes(m.project.primary_entry_point)) {
    issues.push(`/project/primary_entry_point: "${m.project.primary_entry_point}" is not the id of any entry point (ids: ${entryIds.join(", ")})`);
  }
  for (const id of duplicates(m.inputs.map((i) => i.id))) issues.push(`/inputs: id "${id}" is used more than once`);
  for (const id of duplicates(m.outputs.map((o) => o.id))) issues.push(`/outputs: id "${id}" is used more than once`);

  const projectFiles = new Set([...summary.fileTree.map((f) => f.path), ...summary.skippedFiles, ...summary.assetFiles]);
  m.project.entry_points.forEach((e, i) => {
    const at = `/project/entry_points/${i}`;
    if (!projectFiles.has(e.path)) {
      issues.push(`${at}/path: "${e.path}" is not a file in the project tree (paths are relative to the archive root)`);
    }

    // working_directory: a clean relative folder that exists in the project.
    const wd = e.working_directory;
    const wdProblem = archivePathProblem(wd, { allowEmpty: true });
    if (wdProblem) {
      issues.push(`${at}/working_directory: "${wd}" ${wdProblem}`);
    } else if (wd !== "" && ![...projectFiles].some((f) => f.startsWith(`${wd}/`))) {
      issues.push(`${at}/working_directory: "${wd}" is not a folder in the project tree`);
    } else if (m.project.build_command === null) {
      // Files named in run_command are relative to working_directory and must exist
      // (unless a build step creates them).
      for (const file of scriptFilesIn(e.run_command ?? "")) {
        const resolved = wd === "" ? file : `${wd}/${file}`;
        if (projectFiles.has(resolved)) continue;
        const elsewhere = [...projectFiles].find((f) => f === file || f.endsWith(`/${file}`));
        const hint = elsewhere
          ? ` (it exists at "${elsewhere}"; set working_directory to "${elsewhere.slice(0, -file.length - 1)}" or name the file relative to it)`
          : "";
        issues.push(`${at}/run_command: refers to "${file}", but there is no "${resolved}" in the project; commands run from working_directory ("${wd}")${hint}`);
      }
    }

    const { kind, server, prompts } = e.interface;
    if (server?.port_binding != null && !(e.run_command ?? "").includes("{port}")) {
      issues.push(`${at}/run_command: server.port_binding is set, so run_command must contain "{port}" where the port option goes`);
    }
    for (const p of placeholdersIn(e.run_command ?? "")) {
      if (p === "port") {
        if (kind !== "local_server" || server?.port_binding == null) {
          issues.push(`${at}/run_command: "{port}" is only allowed for a local_server whose server.port_binding is set`);
        }
      } else if (p !== "args") {
        issues.push(`${at}/run_command: "{${p}}" is not allowed; only {args} (and {port} for a local server) may be used`);
      }
    }
    if ((kind === "local_server") !== (server !== null)) {
      issues.push(`${at}/interface/server: must be set when kind is "local_server" and null otherwise`);
    }
    if (server?.port_binding != null && countValue(server.port_binding) !== 1) {
      issues.push(`${at}/interface/server/port_binding: must contain "{value}" exactly once`);
    }
    if (kind !== "interactive_terminal" && prompts.length > 0) {
      issues.push(`${at}/interface/prompts: must be empty unless kind is "interactive_terminal"`);
    }
  });

  const inputIds = new Set(m.inputs.map((input) => input.id));
  m.inputs.forEach((input, i) => {
    const at = `/inputs/${i}`;
    if (input.cli_binding !== null) {
      const count = countValue(input.cli_binding);
      if (input.kind === "boolean" && count !== 0) issues.push(`${at}/cli_binding: a boolean's binding is a plain flag with no "{value}"`);
      if (input.kind !== "boolean" && count !== 1) issues.push(`${at}/cli_binding: must contain "{value}" exactly once`);
    }
    if (input.env_binding !== null && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.env_binding)) {
      issues.push(`${at}/env_binding: "${input.env_binding}" is not a valid environment variable name`);
    }
    if (input.multiple && input.kind !== "file") issues.push(`${at}/multiple: can only be true for a "file" input`);
    if (input.kind !== "number" && (input.min !== null || input.max !== null)) {
      issues.push(`${at}: min and max must be null unless kind is "number"`);
    }
    if (input.min !== null && input.max !== null && input.min > input.max) issues.push(`${at}: min is greater than max`);
    if (input.kind === "choice" && input.choices && input.default !== undefined && input.default !== null && !input.choices.includes(String(input.default))) {
      issues.push(`${at}/default: "${String(input.default)}" is not one of the choices`);
    }
    for (const ext of input.accepts ?? []) {
      if (!/^\.[a-z0-9][a-z0-9.+_-]*$/.test(ext)) issues.push(`${at}/accepts: "${ext}" must be a lower-case extension starting with a dot, e.g. ".vtt"`);
    }
    if (input.env_binding !== null && !m.capabilities.reads_env_vars.includes(input.env_binding)) {
      issues.push(`${at}/env_binding: "${input.env_binding}" must also be listed in capabilities.reads_env_vars`);
    }
    if (input.required && input.cli_binding === null && input.env_binding === null && m.confidence.overall === "high") {
      issues.push(`${at}: a required input with no cli_binding or env_binding can't be filled in automatically, so confidence.overall can't be "high"`);
    }
  });

  // Inputs with a cli_binding are rendered into {args} of the primary entry point, which must therefore have one.
  const primary = m.project.entry_points.find((e) => e.id === m.project.primary_entry_point);
  if (primary && m.inputs.some((input) => input.cli_binding !== null) && !(primary.run_command ?? "").includes("{args}")) {
    issues.push(`/project/entry_points/${m.project.entry_points.indexOf(primary)}/run_command: inputs have cli_binding values, so the primary entry point's run_command must contain "{args}"`);
  }

  m.project.assets.forEach((asset, i) => {
    const problem = archivePathProblem(asset, { allowEmpty: false });
    if (problem) issues.push(`/project/assets/${i}: "${asset}" ${problem}`);
  });

  m.outputs.forEach((output, i) => {
    const at = `/outputs/${i}/path_pattern`;
    if ((output.kind === "console") !== (output.path_pattern === null)) {
      issues.push(`${at}: must be null for a "console" output and a path otherwise`);
    }
    const pattern = output.path_pattern ?? "";
    if (/^[\\/]|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$)/.test(pattern)) {
      issues.push(`${at}: "${pattern}" must stay inside the project (no absolute paths or "..")`);
    }
    for (const p of placeholdersIn(pattern)) {
      if (!inputIds.has(p)) issues.push(`${at}: "{${p}}" does not match any input id`);
    }
  });
  return issues;
}

/** Names inside `{…}` placeholders in a template. */
function placeholdersIn(template: string): string[] {
  return [...template.matchAll(/\{([^{}]*)\}/g)].map((x) => x[1] ?? "");
}

/**
 * Why `p` isn't a clean archive-relative path (forward slashes, no leading
 * `/` or `./`, no `..`, no trailing `/`, no drive letter), or `null` if it is.
 */
function archivePathProblem(p: string, { allowEmpty }: { allowEmpty: boolean }): string | null {
  if (p === "") return allowEmpty ? null : "must not be empty";
  if (p.includes("\\")) return "must use forward slashes";
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return "must be relative to the archive root, not absolute";
  if (p.startsWith("./")) return 'must not start with "./"';
  if (p.split("/").includes("..")) return 'must not contain ".."';
  if (p.endsWith("/")) return 'must not end with "/"';
  return null;
}

/** Extensions of files a run_command can name directly (scripts and programs run by an interpreter). */
const SCRIPT_EXTENSIONS = /\.(py|pyw|js|mjs|cjs|ts|mts|cts|sh|bash|zsh|rb|pl|php|lua|r|jl|ps1|bat|cmd|go|rs|swift|kts)$/i;

/** Script files named in a run_command, e.g. `python main.py {args}` → `["main.py"]` (quotes and a leading `./` removed). */
function scriptFilesIn(command: string): string[] {
  return command
    .split(/\s+/)
    .map((token) => token.replace(/^["']|["']$/g, ""))
    .filter((token) => token !== "" && !token.startsWith("-") && !token.includes("{") && !token.includes("=") && !token.includes("://"))
    .map((token) => token.replace(/^\.\//, ""))
    .filter((token) => SCRIPT_EXTENSIONS.test(token));
}

/** How many times `{value}` appears in a binding. */
function countValue(binding: string): number {
  return binding.split("{value}").length - 1;
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

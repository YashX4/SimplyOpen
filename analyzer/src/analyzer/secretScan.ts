/**
 * @file The "Checked for leaked keys" check: scans every text file in an
 * extracted project for API keys, tokens, private keys and passwords that
 * were left in by mistake. Plain code, no AI.
 *
 * It reports WHERE a key is (file, line) and WHAT kind it looks like, never
 * the key itself, so a finding can be shown or logged safely. The same
 * patterns are used by {@link redactSecrets} to blank keys out of anything
 * sent to Claude.
 *
 * It looks for well-known key formats that are rarely mistaken for anything
 * else, rather than every string that might be a password, so a project
 * page doesn't cry wolf. It can miss keys in formats it doesn't know, and it
 * can't read compressed files such as git history.
 *
 * Imports only Node built-ins.
 */

import { lstat, open, readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** One likely leaked key. Never contains the key itself. */
export interface LeakedKey {
  /** Path of the file, relative to the archive root, forward slashes. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** What it looks like, in plain English, e.g. "OpenAI API key". */
  kind: string;
}

/** The outcome of scanning one project. */
export interface SecretScanResult {
  /** True when every text file was checked (none was too big to scan). */
  complete: boolean;
  /** How many text files were checked. */
  filesChecked: number;
  /** How many text files were too big to check. Binary files (images, compiled files) are not counted. */
  filesNotChecked: number;
  /** How many likely leaked keys were found in all. */
  totalFound: number;
  /** The first {@link MAX_REPORTED_KEYS} of them, in file order. */
  found: LeakedKey[];
}

/** Largest file scanned, in bytes. Bigger text files are counted as not checked. */
export const MAX_SCAN_FILE_BYTES = 2 * 1024 * 1024;

/** Most findings listed in {@link SecretScanResult.found}. */
export const MAX_REPORTED_KEYS = 50;

/** A key format: what it is called, and a pattern that matches the key itself. */
interface KeyPattern {
  kind: string;
  pattern: RegExp;
  /** What to blank out when redacting, if more than `pattern` (e.g. a whole private-key block). */
  redact?: RegExp;
}

/**
 * Well-known key formats. Each pattern matches only the secret part, so
 * {@link redactSecrets} can blank out exactly that.
 */
const KEY_PATTERNS: readonly KeyPattern[] = [
  { kind: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "OpenAI API key", pattern: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: "Stripe secret key", pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}/g },
  { kind: "Hugging Face token", pattern: /\bhf_[A-Za-z0-9]{34,}/g },
  {
    kind: "Private key",
    pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/g,
    redact: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*-----|$)/g,
  },
  // user:password@ inside a web address, e.g. a git remote with a token in it.
  { kind: "Password in a web address", pattern: /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:)[^\s/@'"]{6,}(?=@)/gi },
];

/** Environment files people keep secrets in. Examples and templates are meant to be shared. */
const ENV_FILE = /^\.env(\..+)?$/i;
const ENV_EXAMPLE = /\.(example|sample|template|dist|defaults?)$/i;
/** In an environment file: NAME=value where the name sounds secret. Group 1 is the value. */
const ENV_SECRET_LINE = /^\s*(?:export\s+)?[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?)[A-Za-z0-9_]*\s*=\s*['"]?([^'"\s#]+)/i;
/** Values that are obviously placeholders, not real secrets. */
const PLACEHOLDER = /^(?:x+|\*+|\.+|changeme|change_me|your[-_a-z]*|<.*>|\$\{.*\}|none|null|false|true|todo|example|test|dummy|placeholder)$/i;

/**
 * Scan every text file under `dir` for likely leaked keys.
 *
 * @param dir The extracted project folder.
 * @returns What was checked and what was found; never the keys themselves.
 */
export async function scanForSecrets(dir: string): Promise<SecretScanResult> {
  const found: LeakedKey[] = [];
  let totalFound = 0;
  let filesChecked = 0;
  let filesNotChecked = 0;

  for (const rel of await listFiles(dir)) {
    const full = path.join(dir, ...rel.split("/"));
    if ((await lstat(full)).size > MAX_SCAN_FILE_BYTES) {
      // Only count it if it's text: a big image can't hold a readable key.
      if (!(await looksBinary(full))) filesNotChecked++;
      continue;
    }
    const bytes = await readFile(full);
    if (bytes.subarray(0, 8000).includes(0)) continue; // binary
    filesChecked++;

    const isEnvFile = isSecretEnvFile(rel);
    const lines = bytes.toString("utf8").split(/\r?\n/);
    lines.forEach((text, i) => {
      const kinds = new Set(KEY_PATTERNS.filter(({ pattern }) => new RegExp(pattern.source, pattern.flags).test(text)).map((p) => p.kind));
      if (isEnvFile && kinds.size === 0) {
        const value = ENV_SECRET_LINE.exec(text)?.[1];
        if (value && value.length >= 8 && !PLACEHOLDER.test(value)) kinds.add("Secret in an environment file");
      }
      for (const kind of kinds) {
        totalFound++;
        if (found.length < MAX_REPORTED_KEYS) found.push({ path: rel, line: i + 1, kind });
      }
    });
  }
  return { complete: filesNotChecked === 0, filesChecked, filesNotChecked, totalFound, found };
}

/**
 * Replace every likely key in `text` with `[REDACTED <kind>]`, so keys left
 * in a project are never sent to Claude. In an environment file (see
 * `filePath`), the values of secret-sounding settings are blanked too.
 *
 * @param text The file's contents (or one line of it).
 * @param filePath The file's path, used only to tell whether it is an environment file.
 */
export function redactSecrets(text: string, filePath: string): string {
  let out = text;
  for (const { kind, pattern, redact } of KEY_PATTERNS) {
    const re = redact ?? pattern;
    out = out.replace(new RegExp(re.source, re.flags), `[REDACTED ${kind}]`);
  }
  if (isSecretEnvFile(filePath)) {
    out = out
      .split("\n")
      .map((line) => {
        const value = ENV_SECRET_LINE.exec(line)?.[1];
        return value && !PLACEHOLDER.test(value) ? line.replace(value, "[REDACTED secret]") : line;
      })
      .join("\n");
  }
  return out;
}

/** Whether `filePath` is an environment file that may hold real secrets (not an example or template). */
function isSecretEnvFile(filePath: string): boolean {
  return ENV_FILE.test(path.posix.basename(filePath)) && !ENV_EXAMPLE.test(filePath);
}

/** Every regular file under `dir`, as forward-slash paths relative to it, sorted. Symlinks are skipped. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(relDir: string): Promise<void> {
    const entries = await readdir(path.join(dir, ...relDir.split("/").filter(Boolean)), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(rel);
      else if (entry.isFile()) out.push(rel);
    }
  }
  await walk("");
  return out;
}

/** Whether a file starts with a NUL byte in its first 8,000 bytes (the usual binary test). */
async function looksBinary(full: string): Promise<boolean> {
  const handle = await open(full, "r");
  try {
    const buffer = Buffer.alloc(8000);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

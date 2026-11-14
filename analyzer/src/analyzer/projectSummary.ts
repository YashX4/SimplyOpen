/**
 * @file Turns an uploaded zip into a bounded {@link ProjectSummary} for the model.
 *
 * - {@link extractZip}: unpacks the archive into a fresh, request-scoped temp
 *   directory and returns a `cleanup` function that deletes it.
 * - {@link buildProjectSummary}: walks that directory and chooses which files
 *   the model sees in full, which it sees by name only, and which are left
 *   out entirely.
 *
 * ## The selection heuristic
 *
 * 1. Manifest/config files (package.json, requirements.txt, pyproject.toml,
 *    go.mod, Cargo.toml, Makefile, Dockerfile, …, and *.yaml/*.yml at the
 *    project root) are always included in full, first. They are small and are
 *    the strongest signal for language and entry-point detection.
 * 2. Binary and asset files (images, archives, compiled code, media, …) and
 *    cache/dependency folders (node_modules, .git, __pycache__, virtual
 *    environments, …) are excluded entirely. Everything else is ranked:
 *    nearer the project root beats deeper; names like main, index, app, run,
 *    cli (and README) beat others; source code slightly beats data files;
 *    then smaller beats larger.
 * 3. Ranked files are included in full while they fit in the content budget
 *    ({@link DEFAULT_SUMMARY_OPTIONS}). A file that does not fit is listed by
 *    path and size only, and the next (smaller) file is tried, so one large
 *    data file cannot crowd out a small main script ranked after it.
 * 4. Whenever anything was left out for size, `truncated` is `true` and
 *    `skippedFiles` lists it, so confidence scoring can account for it.
 * 5. For code files that were left out, "key lines" are still collected:
 *    entry-point guards, argument parsing, `input(`, game/GUI/server start-up,
 *    environment variables, subprocesses, network calls. A big project's
 *    shape stays visible even when most of its code doesn't fit.
 * 6. Asset files (images, sounds, fonts, video) are listed by name only, so
 *    the model knows a game's sprites or sounds exist without reading them.
 *
 * "Project root" means the archive root, or the single top-level folder if
 * everything in the zip sits inside one (people often zip a folder). Paths in
 * the summary are always relative to the archive root.
 *
 * THIS IS A STARTING POINT, NOT A GUARANTEE. It picks well for small scripts
 * and conventionally laid-out projects, but it can miss the important file in
 * an unusual layout or an unfamiliar language or framework. That is why the
 * summary reports exactly what was left out.
 *
 * TODO: add framework-specific heuristics (e.g. recognising a Next.js app vs.
 * a plain Node project, Django vs. a plain Python script, Cargo workspaces)
 * to rank files better. These only change which files are chosen, so they
 * can be added later without changing the ProjectSummary shape.
 */

import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";
import { UnzipError } from "./errors.js";
import type { FileTreeEntry, KeyLine, ProjectSummary } from "./types.js";

/* ------------------------------------------------------------------------ */
/* extractZip                                                               */
/* ------------------------------------------------------------------------ */

/** Limits applied while extracting. Sizes are in bytes. */
export interface UnzipLimits {
  /** Largest archive accepted. */
  maxArchiveBytes: number;
  /** Most entries (files and folders) accepted. */
  maxEntries: number;
  /** Largest single extracted file. */
  maxFileBytes: number;
  /** Largest total extracted size (guards against zip bombs). */
  maxTotalBytes: number;
}

/** Default limits, sized for "a program plus some sample data", not datasets. */
export const DEFAULT_UNZIP_LIMITS: Readonly<UnzipLimits> = Object.freeze({
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 10_000,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
});

/** Result of {@link extractZip}. */
export interface ExtractedProject {
  /** Directory holding the extracted files. Unique to this call. */
  dir: string;
  /**
   * Deletes `dir` and everything in it. Always call it (e.g. in `finally`)
   * once you are done. Safe to call more than once; never rejects.
   */
  cleanup: () => Promise<void>;
}

/** Prefix of every temp directory this module creates. */
export const TEMP_DIR_PREFIX = "simplyopen-analyzer-";

/**
 * Extract a zip archive into a new temp directory.
 *
 * Supports the two compression methods real-world zips use (stored and
 * deflate). Safety checks: paths that would escape the folder (zip-slip),
 * absolute or drive-letter paths, symlinks (skipped), encrypted or ZIP64
 * archives (rejected), entry-count and size limits enforced on both the
 * declared sizes and during decompression, and a CRC-32 check on every file.
 * OS junk (__MACOSX/, .DS_Store, Thumbs.db) is skipped.
 *
 * If extraction fails, the temp directory is deleted before the error is
 * thrown, so the caller only has to clean up after a successful call.
 *
 * @param zipPath Path of the uploaded archive.
 * @param limits Optional overrides for {@link DEFAULT_UNZIP_LIMITS}.
 * @param parentDir Where to create the temp directory. Default `os.tmpdir()`.
 * @returns The extraction directory and its cleanup function.
 * @throws {UnzipError} If the file is missing, not a zip, corrupt, unsafe,
 *   unsupported, over a limit, or contains no files.
 */
export async function extractZip(
  zipPath: string,
  limits: Partial<UnzipLimits> = {},
  parentDir: string = os.tmpdir(),
): Promise<ExtractedProject> {
  const dir = await mkdtemp(path.join(parentDir, TEMP_DIR_PREFIX));
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  };
  try {
    await unzipInto(zipPath, dir, { ...DEFAULT_UNZIP_LIMITS, ...limits });
    return { dir, cleanup };
  } catch (error) {
    await cleanup();
    if (error instanceof UnzipError) throw error;
    throw new UnzipError("Could not extract the archive", { cause: error });
  }
}

const inflateRawAsync = promisify(inflateRaw);
const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const ZIP_JUNK = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];

/** Parse the archive's central directory and write each regular file under `root`. */
async function unzipInto(zipPath: string, root: string, lim: UnzipLimits): Promise<void> {
  let archiveSize: number;
  try {
    archiveSize = (await stat(zipPath)).size;
  } catch (cause) {
    throw new UnzipError(`Cannot read the archive at ${zipPath}`, { cause });
  }
  if (archiveSize > lim.maxArchiveBytes) {
    throw new UnzipError(`The archive is ${archiveSize} bytes; the limit is ${lim.maxArchiveBytes}`);
  }
  const buf = await readFile(zipPath);
  const base = path.resolve(root);

  const eocd = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0) {
    throw new UnzipError("Multi-part (spanned) archives are not supported");
  }
  if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new UnzipError("ZIP64 archives are not supported");
  }
  if (entryCount > lim.maxEntries) {
    throw new UnzipError(`The archive has ${entryCount} entries; the limit is ${lim.maxEntries}`);
  }
  if (cdOffset + cdSize > buf.length) throw new UnzipError("The archive is corrupt (central directory out of range)");

  const seen = new Set<string>();
  let fileCount = 0;
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new UnzipError(`The archive is corrupt (bad entry #${i})`);
    }
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttrs = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) throw new UnzipError(`The archive is corrupt (entry #${i} name)`);
    const name = buf
      .subarray(p + 46, p + 46 + nameLen)
      .toString(flags & 0x800 ? "utf8" : "latin1")
      .replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // folder entry; folders are created as needed
    if (ZIP_JUNK.some((re) => re.test(name))) continue;
    if (madeBy >> 8 === 3 && ((externalAttrs >>> 16) & 0o170000) === 0o120000) continue; // symlink

    const rel = safeRelativePath(name);
    const target = path.resolve(base, ...rel.split("/"));
    if (!target.startsWith(base + path.sep)) {
      throw new UnzipError(`Entry "${name}" would be written outside the extraction folder`);
    }
    if (seen.has(rel)) throw new UnzipError(`The archive contains "${rel}" twice`);
    seen.add(rel);
    if (flags & 0x1) throw new UnzipError(`Entry "${rel}" is encrypted; encrypted archives are not supported`);
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new UnzipError("ZIP64 archives are not supported");
    }
    if (size > lim.maxFileBytes) throw new UnzipError(`Entry "${rel}" is ${size} bytes; the limit is ${lim.maxFileBytes}`);
    total += size;
    if (total > lim.maxTotalBytes) throw new UnzipError(`The archive expands beyond ${lim.maxTotalBytes} bytes`);

    const data = await readEntry(buf, localOffset, method, compSize, size, rel);
    if (crc32(data) !== crc) throw new UnzipError(`Checksum mismatch for "${rel}"; the archive is corrupt`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: "wx" });
    fileCount++;
  }
  if (fileCount === 0) throw new UnzipError("The archive contains no files");
}

/** Find the End Of Central Directory record (within the last 64 KiB + 22 bytes). */
function findEndOfCentralDirectory(buf: Buffer): number {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new UnzipError("This file is not a zip archive");
}

/** Read and decompress one entry, enforcing its declared size. */
async function readEntry(buf: Buffer, offset: number, method: number, compSize: number, size: number, name: string): Promise<Buffer> {
  if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== SIG_LOCAL) {
    throw new UnzipError(`The archive is corrupt (bad header for "${name}")`);
  }
  const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
  if (start + compSize > buf.length) throw new UnzipError(`The archive is corrupt ("${name}" is cut off)`);
  const compressed = buf.subarray(start, start + compSize);
  let data: Buffer;
  if (method === 0) {
    data = Buffer.from(compressed);
  } else if (method === 8) {
    try {
      // maxOutputLength stops a lying header from inflating without bound.
      data = await inflateRawAsync(compressed, { maxOutputLength: Math.max(size, 1) });
    } catch (cause) {
      throw new UnzipError(`Could not decompress "${name}"`, { cause });
    }
  } else {
    throw new UnzipError(`Entry "${name}" uses an unsupported compression method (${method})`);
  }
  if (data.length !== size) throw new UnzipError(`Size mismatch for "${name}"; the archive is corrupt`);
  return data;
}

/** Validate an entry name and return a clean relative path, or throw for unsafe names. */
function safeRelativePath(name: string): string {
  if (name.includes("\0") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new UnzipError(`Entry "${name}" has an absolute or invalid path`);
  }
  const segments = name.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) throw new UnzipError(`Entry "${name}" contains ".." and could escape the extraction folder`);
  if (segments.length === 0) throw new UnzipError(`Entry "${name}" has an empty path`);
  return segments.join("/");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE), as used by zip. */
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------------ */
/* buildProjectSummary                                                      */
/* ------------------------------------------------------------------------ */

/** Tuning for {@link buildProjectSummary}. */
export interface SummaryOptions {
  /** Estimated tokens of file contents to include. */
  tokenBudget: number;
  /** Characters per token used for the estimate. */
  charsPerToken: number;
  /**
   * Cap on tree entries. Included files are always listed (the prompt has to
   * name every file it shows), so this limits how many listed-only files are
   * added after them; skipped files beyond it are only counted
   * (`unlistedFileCount`). The tree can exceed the cap only if the included
   * files alone do.
   */
  maxTreeEntries: number;
  /** Size above which even a manifest/config file is not force-included. */
  maxAlwaysIncludeBytes: number;
  /** Total characters of key lines taken from code files that were left out. */
  keyLinesMaxChars: number;
  /** Most key lines taken from any one file. */
  maxKeyLinesPerFile: number;
  /** Most asset file names listed. */
  maxAssetNames: number;
}

/**
 * Defaults.
 *
 * `tokenBudget` = 12,000 tokens of file contents. Reasoning, per request:
 * the system prompt is ~2.3k tokens and the tool schema ~1.4k; the file tree
 * adds at most ~5k (400 lines); the reply plus thinking is capped at 16k
 * output tokens. So a full request stays around 20k input tokens, which keeps
 * it fast (an upload flow is waiting) and cheap, far below the model's
 * context window. The canonical case, one script plus a README and a
 * requirements file, is typically 2–6k tokens and fits with room to spare;
 * 12k also fits an entry script plus several modules.
 *
 * `charsPerToken` = 3.5: code tokenizes denser than prose (~4 chars/token),
 * so 3.5 errs on the side of including less rather than overrunning.
 *
 * `maxAlwaysIncludeBytes` = 64 KiB: real manifests are a few KiB; this only
 * stops a pathological "config" file (e.g. a generated 2 MB YAML) from
 * blowing the request. A file over it is treated as skipped.
 *
 * `keyLinesMaxChars` = 12,000 characters (≈3.4k tokens), at most 25 lines per
 * file: for big projects, telling lines from the code that didn't fit (entry
 * guards, argument parsing, game/GUI/server start-up, …) are far denser
 * evidence per token than more whole files would be. Only spent when
 * something was cut, so small projects cost nothing extra.
 *
 * `maxAssetNames` = 100: enough to show a game's sprite and sound folders
 * without letting a folder of thousands of images flood the prompt.
 */
export const DEFAULT_SUMMARY_OPTIONS: Readonly<SummaryOptions> = Object.freeze({
  tokenBudget: 12_000,
  charsPerToken: 3.5,
  maxTreeEntries: 400,
  maxAlwaysIncludeBytes: 64 * 1024,
  keyLinesMaxChars: 12_000,
  maxKeyLinesPerFile: 25,
  maxAssetNames: 100,
});

/** Excluded extensions that are runtime assets a program may load: their names are listed (never their contents). */
const ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tif", ".tiff", ".svg",
  ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".mp4", ".mov", ".avi", ".mkv", ".webm",
  ".ttf", ".otf", ".woff", ".woff2",
]);

/**
 * Patterns for "telling" lines: how a program starts, takes input, presents
 * itself, and what it reaches. Language-agnostic list; a line is kept if any
 * pattern matches.
 */
const KEY_LINE_PATTERNS: readonly RegExp[] = [
  /^#!/, // shebang
  /__name__\s*==\s*["']__main__["']/, /\bdef main\s*\(/, /\bfunc main\s*\(/, /\bfn main\s*\(/,
  /\badd_argument\s*\(/, /\bArgumentParser\s*\(/, /@click\.|\bclick\.(command|option|argument)\b/, /\btyper\b/, /\bsys\.argv\b/,
  /\bprocess\.argv\b/, /\b(commander|yargs)\b/, /\bflag\.(String|Int|Bool|Parse)\b/, /\bos\.Args\b/, /\bclap::/,
  /\binput\s*\(/, /\breadline\b/, /\bprompt\s*\(/,
  /\bpygame\.(init|display\.set_mode|display\.set_caption|key|event)\b/, /\bK_[A-Za-z0-9]+\b/, /\bKEYDOWN\b|\bMOUSEBUTTONDOWN\b/,
  /\btkinter\b|\bTk\s*\(\)/, /\bQApplication\b|\bPyQt\d?\b|\bPySide\d?\b/, /\barcade\.|\bpyglet\./, /\belectron\b|\bBrowserWindow\b/,
  /\bFlask\s*\(|\bapp\.run\s*\(|\bFastAPI\s*\(|\buvicorn\.run\b|\bstreamlit\b|\bgradio\b/, /\.listen\s*\(\s*\d*|\bexpress\s*\(\)|\bhttp\.ListenAndServe\b/,
  /\bos\.environ\b|\bgetenv\s*\(|\bprocess\.env\.|\bos\.Getenv\b|\bdotenv\b/,
  /\bsubprocess\.|\bos\.system\s*\(|\bchild_process\b|\bexec\.Command\b/,
  /\brequests\.(get|post|put|delete)\b|\burllib\.request\b|\bhttpx\.|\bfetch\s*\(|\baxios\b/,
];

/** Longest key line kept, in characters. */
const MAX_KEY_LINE_LENGTH = 160;

/** Folders never descended into for content: caches, dependencies, VCS and editor metadata. */
const EXCLUDED_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "bower_components", "__pycache__", ".venv", "venv", "env",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", ".idea", ".vscode", ".next", ".nuxt",
  ".gradle", ".cache", "target", "__MACOSX",
]);

/** Binary and asset extensions: excluded entirely, never read. */
const EXCLUDED_EXTENSIONS = new Set([
  // images
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".icns", ".webp", ".tif", ".tiff", ".psd", ".heic", ".svg",
  // audio / video
  ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".mp4", ".mov", ".avi", ".mkv", ".webm",
  // archives / disk images
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".dmg", ".iso",
  // compiled code / native libraries
  ".pyc", ".pyo", ".pyd", ".so", ".dylib", ".dll", ".exe", ".bin", ".o", ".a", ".lib", ".class", ".jar", ".war", ".whl", ".wasm", ".node",
  // documents / office files
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".key", ".pages", ".numbers",
  // fonts
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  // data blobs / models / databases
  ".db", ".sqlite", ".sqlite3", ".pkl", ".pickle", ".npy", ".npz", ".parquet", ".feather", ".h5", ".hdf5", ".onnx", ".pt", ".pth", ".ckpt", ".safetensors",
]);

/** Manifest/config file names always included in full (at any depth outside excluded folders). */
const ALWAYS_INCLUDE_NAMES = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "setup.py", "setup.cfg", "pipfile", "go.mod",
  "cargo.toml", "gemfile", "composer.json", "deno.json", "makefile", "gnumakefile", "dockerfile",
]);

/** Base names (without extension) that suggest an entry point. */
const ENTRY_STEMS = new Set(["main", "index", "app", "run", "cli", "__main__"]);

/** Source-code extensions, slightly preferred over data and docs when ranking. */
const CODE_EXTENSIONS = new Set([
  ".py", ".pyw", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".go", ".rs", ".rb", ".sh", ".bash", ".zsh",
  ".ps1", ".bat", ".cmd", ".r", ".jl", ".lua", ".pl", ".php", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".cs",
]);

/**
 * Build the bounded view of an extracted project using the heuristic
 * described in the file comment.
 *
 * @param dir Directory the project was extracted into (e.g. from {@link extractZip}).
 * @param options Optional overrides for {@link DEFAULT_SUMMARY_OPTIONS}.
 * @returns The summary. Never fails because a project is too large: large
 *   projects produce a partial summary with `truncated: true`.
 * @throws Only on unexpected filesystem errors while reading `dir`.
 */
export async function buildProjectSummary(dir: string, options: Partial<SummaryOptions> = {}): Promise<ProjectSummary> {
  const opts: SummaryOptions = { ...DEFAULT_SUMMARY_OPTIONS, ...options };
  const { candidates, excludedCount, assetPaths } = await collectFiles(dir);
  let excludedFileCount = excludedCount;
  const rootPrefix = commonTopFolder(candidates.map((c) => c.path));

  const included = new Map<string, string>();
  const skipped = new Set<string>();
  let remainingChars = Math.floor(opts.tokenBudget * opts.charsPerToken);
  const excludedAfterRead = new Set<string>();

  // Step 1: manifest/config files, always in full (they still use up budget).
  const always = candidates.filter((c) => isAlwaysInclude(c.path, rootPrefix));
  for (const file of always) {
    if (file.sizeBytes > opts.maxAlwaysIncludeBytes) {
      skipped.add(file.path);
      continue;
    }
    const text = await readText(dir, file.path);
    if (text === null) {
      excludedAfterRead.add(file.path);
      continue;
    }
    included.set(file.path, text);
    remainingChars -= text.length;
  }

  // Steps 2–3: rank the rest and include in full while they fit.
  const rest = candidates
    .filter((c) => !included.has(c.path) && !skipped.has(c.path) && !excludedAfterRead.has(c.path))
    .map((c) => ({ ...c, score: rankScore(c.path, rootPrefix) }))
    .sort((a, b) => a.score - b.score || a.sizeBytes - b.sizeBytes || a.path.localeCompare(b.path));

  for (const file of rest) {
    // UTF-8 uses at most 4 bytes per character, so a file of N bytes has at least N/4 characters.
    if (remainingChars <= 0 || file.sizeBytes / 4 > remainingChars) {
      skipped.add(file.path);
      continue;
    }
    const text = await readText(dir, file.path);
    if (text === null) {
      excludedAfterRead.add(file.path); // binary content behind a text-looking name
      continue;
    }
    if (text.length > remainingChars) {
      skipped.add(file.path);
      continue;
    }
    included.set(file.path, text);
    remainingChars -= text.length;
  }
  excludedFileCount += excludedAfterRead.size;

  // Tree: every included file, then skipped files in rank order, up to the cap.
  const listable = candidates.filter((c) => !excludedAfterRead.has(c.path));
  const rankOf = new Map(rest.map((r, i) => [r.path, i]));
  const skippedRanked = listable
    .filter((c) => skipped.has(c.path))
    .sort((a, b) => (rankOf.get(a.path) ?? -1) - (rankOf.get(b.path) ?? -1));
  const treeSlots = Math.max(0, opts.maxTreeEntries - included.size);
  const listedSkipped = skippedRanked.slice(0, treeSlots);
  const fileTree: FileTreeEntry[] = [
    ...listable.filter((c) => included.has(c.path)),
    ...listedSkipped,
  ]
    .map(({ path: p, sizeBytes }) => ({ path: p, sizeBytes }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const skippedFiles = skippedRanked.map((c) => c.path);
  const skippedCode = skippedRanked.filter((c) => CODE_EXTENSIONS.has(path.posix.extname(c.path).toLowerCase()));
  return {
    fileTree,
    includedFiles: new Map(fileTree.filter((f) => included.has(f.path)).map((f) => [f.path, included.get(f.path)!])),
    truncated: skippedFiles.length > 0,
    skippedFiles,
    unlistedFileCount: skippedRanked.length - listedSkipped.length,
    excludedFileCount,
    keyLines: await collectKeyLines(dir, skippedCode, opts),
    assetFiles: assetPaths.slice(0, opts.maxAssetNames),
  };
}

/** Largest file read when looking for key lines; beyond this only the beginning is scanned. */
const MAX_KEY_LINE_SCAN_BYTES = 1024 * 1024;

/**
 * Pull telling lines (see {@link KEY_LINE_PATTERNS}) from code files that
 * were left out, in rank order, until the character budget is used.
 */
async function collectKeyLines(dir: string, files: readonly Candidate[], opts: SummaryOptions): Promise<KeyLine[]> {
  const result: KeyLine[] = [];
  let remaining = opts.keyLinesMaxChars;
  for (const file of files) {
    if (remaining <= 0) break;
    const bytes = await readFile(path.join(dir, ...file.path.split("/")));
    const text = decodeText(bytes.subarray(0, MAX_KEY_LINE_SCAN_BYTES));
    if (text === null) continue;
    let fromThisFile = 0;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && fromThisFile < opts.maxKeyLinesPerFile; i++) {
      const raw = lines[i]!.trim();
      if (raw === "" || !KEY_LINE_PATTERNS.some((re) => (re.source === "^#!" ? i === 0 && re.test(raw) : re.test(raw)))) continue;
      const lineText = raw.length > MAX_KEY_LINE_LENGTH ? `${raw.slice(0, MAX_KEY_LINE_LENGTH)}…` : raw;
      const cost = file.path.length + lineText.length + 10;
      if (cost > remaining) return result;
      result.push({ path: file.path, line: i + 1, text: lineText });
      remaining -= cost;
      fromThisFile++;
    }
  }
  return result;
}

interface Candidate {
  path: string;
  sizeBytes: number;
}

/** Walk `dir`, returning text-candidate files and how many were excluded by folder or extension. Symlinks are ignored. */
async function collectFiles(dir: string): Promise<{ candidates: Candidate[]; excludedCount: number; assetPaths: string[] }> {
  const candidates: Candidate[] = [];
  const assetPaths: string[] = [];
  let excludedCount = 0;

  async function walk(relDir: string, excluded: boolean): Promise<void> {
    const entries = await readdir(path.join(dir, ...relDir.split("/").filter(Boolean)), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(rel, excluded || EXCLUDED_DIRS.has(entry.name) || entry.name.endsWith(".egg-info"));
      } else if (entry.isFile()) {
        const ext = path.posix.extname(entry.name).toLowerCase();
        if (excluded || EXCLUDED_EXTENSIONS.has(ext) || entry.name === ".DS_Store") {
          excludedCount++;
          // Assets in the project itself (not inside caches or dependencies) are named, never read.
          if (!excluded && ASSET_EXTENSIONS.has(ext)) assetPaths.push(rel);
        } else {
          const info = await lstat(path.join(dir, ...rel.split("/")));
          candidates.push({ path: rel, sizeBytes: info.size });
        }
      }
      // Symlinks and other special files are skipped on purpose.
    }
  }

  await walk("", false);
  return { candidates, excludedCount, assetPaths };
}

/** If every path sits inside one top-level folder, return `"<folder>/"`; otherwise `""`. */
function commonTopFolder(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const first = paths[0]!.split("/")[0]!;
  return paths.every((p) => p.includes("/") && p.split("/")[0] === first) ? `${first}/` : "";
}

/** Depth below the project root: 0 for a file directly in it. */
function depthBelowRoot(filePath: string, rootPrefix: string): number {
  const rel = filePath.startsWith(rootPrefix) ? filePath.slice(rootPrefix.length) : filePath;
  return rel.split("/").length - 1;
}

/** Step 1 rule: named manifests anywhere; *.yaml / *.yml only directly in the project root. */
function isAlwaysInclude(filePath: string, rootPrefix: string): boolean {
  const base = path.posix.basename(filePath).toLowerCase();
  if (ALWAYS_INCLUDE_NAMES.has(base)) return true;
  if (/^requirements[\w.-]*\.txt$/.test(base)) return true;
  return /\.ya?ml$/.test(base) && depthBelowRoot(filePath, rootPrefix) === 0;
}

/** Step 2 ranking score; lower ranks first. */
function rankScore(filePath: string, rootPrefix: string): number {
  const base = path.posix.basename(filePath).toLowerCase();
  const ext = path.posix.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let score = depthBelowRoot(filePath, rootPrefix) * 10;
  if (ENTRY_STEMS.has(stem)) score -= 25;
  if (stem === "readme") score -= 20;
  if (CODE_EXTENSIONS.has(ext)) score -= 5;
  return score;
}

/** Read a file as UTF-8 text, or return `null` if it looks binary. */
async function readText(dir: string, relPath: string): Promise<string | null> {
  return decodeText(await readFile(path.join(dir, ...relPath.split("/"))), { lenient: false });
}

/**
 * Decode bytes as UTF-8 text, or return `null` if they look binary (a NUL
 * byte near the start). Strict mode also rejects invalid UTF-8; lenient mode
 * (for scanning a slice cut at an arbitrary byte) replaces bad bytes instead.
 */
function decodeText(bytes: Uint8Array, { lenient }: { lenient: boolean } = { lenient: true }): string | null {
  if (bytes.subarray(0, 8000).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: !lenient }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

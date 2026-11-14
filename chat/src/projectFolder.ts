/**
 * @file {@link ProjectFolder}: the only way the chat touches a project's
 * files. Every path is checked to stay inside the project, protected paths
 * can't be changed, and every turn that changes something becomes a numbered
 * version that can be restored or downloaded.
 *
 * Knows nothing about what the project is (no manifest, no Runner, no
 * Analyzer): it is just a folder of files.
 *
 * Imports only Node built-ins.
 */

import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** One file the chat created, edited or deleted during a turn. */
export interface FileChange {
  /** Path relative to the project folder, forward slashes. */
  path: string;
  change: "created" | "edited" | "deleted";
}

/** Thrown when a path is unsafe, protected, missing, or not a text file. The message is safe to show to the model. */
export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFileError";
  }
}

/** Options for {@link ProjectFolder.open}. */
export interface ProjectFolderOptions {
  /**
   * Paths the chat may read but never change, relative to the project
   * folder. A path ending in "/" protects a whole folder; a single folder
   * name like ".git/" protects every folder with that name. Default
   * {@link DEFAULT_PROTECTED_PATHS}.
   */
  protectedPaths?: readonly string[];
  /** Largest file the chat may read or write, in bytes. Default 1 MiB. */
  maxFileBytes?: number;
}

/** Version-control and dependency folders are never edited by the chat. */
export const DEFAULT_PROTECTED_PATHS: readonly string[] = [".git/", ".hg/", ".svn/", "node_modules/", "__pycache__/"];

/** Folders left out of listings because they are noise for the model. */
const UNLISTED_DIRS = new Set([".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", "__MACOSX"]);

/**
 * A project folder the chat may read and change.
 *
 * Paths given to it are relative to the project folder. A leading "/" means
 * the project folder itself (so "/main.py" and "main.py" are the same file),
 * because models often write paths that way; nothing outside the folder can
 * ever be reached.
 */
export class ProjectFolder {
  /** Snapshots of the current turn: path → content before the turn's first change to it (null if it didn't exist). */
  private turn: Map<string, Buffer | null> | null = null;
  /** What each version's turn changed (contents before the turn), oldest first: entry i made version i + 1. */
  private readonly history: Map<string, Buffer | null>[] = [];
  private readonly protectedPaths: readonly string[];
  private readonly maxFileBytes: number;

  private constructor(
    /** Absolute, symlink-free path of the project folder. */
    readonly root: string,
    options: ProjectFolderOptions,
  ) {
    // Keep the trailing "/" that marks a protected folder.
    this.protectedPaths = (options.protectedPaths ?? DEFAULT_PROTECTED_PATHS).map((p) => `${normalizeRelative(p)}${p.endsWith("/") ? "/" : ""}`);
    this.maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
  }

  /**
   * Open an existing folder.
   *
   * @throws {ProjectFileError} If `root` is not a folder.
   */
  static async open(root: string, options: ProjectFolderOptions = {}): Promise<ProjectFolder> {
    const real = await realpath(root).catch(() => null);
    if (real === null || !(await lstat(real)).isDirectory()) throw new ProjectFileError(`"${root}" is not a folder`);
    return new ProjectFolder(real, options);
  }

  /* ---------------------------------------------------------------------- */
  /* Paths                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Turn a path from the model into a clean relative path ("" for the
   * project folder itself).
   *
   * @throws {ProjectFileError} If it would leave the project folder.
   */
  relative(input: string): string {
    if (typeof input !== "string") throw new ProjectFileError("path must be a string");
    if (input.includes("\0")) throw new ProjectFileError("path must not contain a NUL character");
    const rel = normalizeRelative(input);
    if (rel === ".." || rel.startsWith("../")) throw new ProjectFileError(`"${input}" is outside the project`);
    return rel;
  }

  /**
   * The absolute path for a relative one, after checking that no symbolic
   * link on the way leads out of the project.
   */
  private async absolute(rel: string): Promise<string> {
    const target = rel === "" ? this.root : path.join(this.root, ...rel.split("/"));
    // Walk up to the nearest part that exists and make sure its real location is inside the project.
    let existing = target;
    for (;;) {
      const real = await realpath(existing).catch(() => null);
      if (real !== null) {
        if (real !== this.root && !real.startsWith(this.root + path.sep)) throw new ProjectFileError(`"${rel}" is outside the project`);
        break;
      }
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    return target;
  }

  /**
   * Whether `rel` is protected (read-only for the chat). A protected folder
   * given as just a name, like ".git/", is protected wherever it is (projects
   * are often zipped as one folder, so their .git sits one level down); one
   * given with a path, like "src/generated/", only at that path.
   */
  isProtected(rel: string): boolean {
    const parts = rel.split("/");
    return this.protectedPaths.some((p) => {
      if (!p.endsWith("/")) return rel === p;
      const folder = p.slice(0, -1);
      if (!folder.includes("/")) return parts.includes(folder);
      return rel === folder || rel.startsWith(p);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Reading                                                                */
  /* ---------------------------------------------------------------------- */

  /** Whether `rel` is an existing folder. */
  async isFolder(rel: string): Promise<boolean> {
    const info = await lstat(await this.absolute(this.relative(rel))).catch(() => null);
    return info?.isDirectory() ?? false;
  }

  /**
   * Read a text file.
   *
   * @throws {ProjectFileError} If it doesn't exist, is a folder, is too big, or isn't text.
   */
  async readText(input: string): Promise<string> {
    const rel = this.relative(input);
    const abs = await this.absolute(rel);
    const info = await lstat(abs).catch(() => null);
    if (!info) throw new ProjectFileError(`"${rel}" does not exist`);
    if (info.isDirectory()) throw new ProjectFileError(`"${rel}" is a folder, not a file`);
    if (!info.isFile()) throw new ProjectFileError(`"${rel}" is not a regular file`);
    if (info.size > this.maxFileBytes) throw new ProjectFileError(`"${rel}" is too big to open (${info.size} bytes; the limit is ${this.maxFileBytes})`);
    const bytes = await readFile(abs);
    if (bytes.subarray(0, 8000).includes(0)) throw new ProjectFileError(`"${rel}" is not a text file`);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ProjectFileError(`"${rel}" is not a UTF-8 text file`);
    }
  }

  /**
   * Every file in the project, as relative paths, sorted. Version-control,
   * dependency and cache folders are left out.
   */
  async listFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (relDir: string): Promise<void> => {
      const entries = await readdir(relDir === "" ? this.root : path.join(this.root, ...relDir.split("/")), { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!UNLISTED_DIRS.has(entry.name)) await walk(rel);
        } else if (entry.isFile() && entry.name !== ".DS_Store") {
          out.push(rel);
        }
      }
    };
    await walk("");
    return out;
  }

  /* ---------------------------------------------------------------------- */
  /* Changing                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Create or overwrite a text file (creating folders as needed).
   *
   * @throws {ProjectFileError} If the path is unsafe, protected, a folder, or the text is too big.
   */
  async writeText(input: string, text: string): Promise<void> {
    const rel = this.relative(input);
    this.assertChangeable(rel);
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length > this.maxFileBytes) throw new ProjectFileError(`the new "${rel}" would be too big (${bytes.length} bytes; the limit is ${this.maxFileBytes})`);
    const abs = await this.absolute(rel);
    const info = await lstat(abs).catch(() => null);
    if (info?.isDirectory()) throw new ProjectFileError(`"${rel}" is a folder, not a file`);
    await this.snapshot(rel, abs);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }

  /**
   * Delete a file.
   *
   * @throws {ProjectFileError} If the path is unsafe, protected, missing, or a folder.
   */
  async deleteFile(input: string): Promise<void> {
    const rel = this.relative(input);
    this.assertChangeable(rel);
    const abs = await this.absolute(rel);
    const info = await lstat(abs).catch(() => null);
    if (!info) throw new ProjectFileError(`"${rel}" does not exist`);
    if (!info.isFile()) throw new ProjectFileError(`"${rel}" is not a file (only files can be deleted)`);
    await this.snapshot(rel, abs);
    await rm(abs);
  }

  private assertChangeable(rel: string): void {
    if (rel === "") throw new ProjectFileError("the project folder itself can't be changed");
    if (this.isProtected(rel)) throw new ProjectFileError(`"${rel}" is protected and can't be changed`);
  }

  /* ---------------------------------------------------------------------- */
  /* Turns and versions                                                     */
  /* ---------------------------------------------------------------------- */

  /*
   * Version 0 is the project as it was opened. Every turn that changes
   * something becomes the next version. For each version we keep what its
   * turn changed, as the files' contents BEFORE the turn; that is enough to
   * rebuild any earlier version from the current files, and restoring is
   * itself recorded as a new turn, so nothing is ever lost.
   */

  /** Start recording changes for one turn. */
  beginTurn(): void {
    this.turn = new Map();
  }

  /**
   * Stop recording, and return what the turn changed (files that ended up
   * exactly as they started are not listed). A turn that changed something
   * becomes the next version.
   */
  async endTurn(): Promise<FileChange[]> {
    const snapshots = this.turn ?? new Map<string, Buffer | null>();
    this.turn = null;
    const changes = await this.compare(snapshots);
    if (changes.length > 0) this.history.push(snapshots);
    return changes;
  }

  /** What the open turn has changed so far (empty when no turn is open). */
  async pendingChanges(): Promise<FileChange[]> {
    return this.turn ? this.compare(this.turn) : [];
  }

  /** The latest version's number (0 until something changes). */
  get latestVersion(): number {
    return this.history.length;
  }

  /**
   * Make the files look exactly as they did at `version`, as part of the
   * current turn (call {@link beginTurn} first). Protected files are never
   * touched, because no turn can change them.
   *
   * @throws {ProjectFileError} If there is no such version, or no turn is open.
   */
  async restoreTo(version: number): Promise<void> {
    if (!this.turn) throw new ProjectFileError("restoreTo needs an open turn");
    for (const [rel, content] of this.stateAt(version)) {
      const abs = path.join(this.root, ...rel.split("/"));
      await this.snapshot(rel, abs);
      if (content === null) await rm(abs, { force: true });
      else {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content);
      }
    }
  }

  /**
   * Every file of the project as it was at `version` (all files, including
   * version-control folders, so a download loses nothing).
   *
   * @throws {ProjectFileError} If there is no such version.
   */
  async filesAt(version: number): Promise<Map<string, Buffer>> {
    const differences = this.stateAt(version);
    const files = new Map<string, Buffer>();
    const walk = async (relDir: string): Promise<void> => {
      const entries = await readdir(relDir === "" ? this.root : path.join(this.root, ...relDir.split("/")), { withFileTypes: true });
      for (const entry of entries) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(rel);
        else if (entry.isFile() && entry.name !== ".DS_Store" && !differences.has(rel)) files.set(rel, await readFile(path.join(this.root, ...rel.split("/"))));
      }
    };
    await walk("");
    for (const [rel, content] of differences) if (content !== null) files.set(rel, content);
    return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
  }

  /**
   * Each file whose content at `version` differs from now, with that content
   * (null: it didn't exist then). For each file, it's the content before the
   * first later turn that changed it.
   */
  private stateAt(version: number): Map<string, Buffer | null> {
    if (!Number.isInteger(version) || version < 0 || version > this.history.length) {
      throw new ProjectFileError(`there is no version ${version} (versions go from 0 to ${this.history.length})`);
    }
    const state = new Map<string, Buffer | null>();
    for (const turn of this.history.slice(version)) {
      for (const [rel, before] of turn) if (!state.has(rel)) state.set(rel, before);
    }
    return state;
  }

  /** Remember a file's content before the current turn first changes it. */
  private async snapshot(rel: string, abs: string): Promise<void> {
    if (!this.turn || this.turn.has(rel)) return;
    const info = await lstat(abs).catch(() => null);
    this.turn.set(rel, info?.isFile() ? await readFile(abs) : null);
  }

  /** How each snapshotted file differs now from its snapshot. */
  private async compare(snapshots: Map<string, Buffer | null>): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    for (const [rel, before] of [...snapshots].sort(([a], [b]) => a.localeCompare(b))) {
      const abs = path.join(this.root, ...rel.split("/"));
      const now = (await lstat(abs).catch(() => null))?.isFile() ? await readFile(abs) : null;
      if (before === null && now !== null) changes.push({ path: rel, change: "created" });
      else if (before !== null && now === null) changes.push({ path: rel, change: "deleted" });
      else if (before !== null && now !== null && !before.equals(now)) changes.push({ path: rel, change: "edited" });
    }
    return changes;
  }
}

/** Clean up a relative path: forward slashes, no leading "/" or "./", no "." parts, ".." resolved where possible. */
function normalizeRelative(input: string): string {
  const posix = input.replace(/\\/g, "/");
  const normalized = path.posix.normalize(`/${posix}`); // the leading "/" anchors ".." at the project folder...
  // ...but a path that tried to climb above it must still be caught, so normalize without the anchor too.
  const unanchored = path.posix.normalize(posix.replace(/^\/+/, ""));
  if (unanchored === ".." || unanchored.startsWith("../")) return unanchored;
  return normalized.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * @file Version history for projects, kept simple. For every version we
 * store three things:
 *
 * 1. the code at that point in time (the project zip, as uploaded);
 * 2. a plain-English description of what changed (written by Claude);
 * 3. when it was made, as mm/dd/yy plus the time, e.g. "11/14/26 3:42 PM".
 *
 * On disk, each project is one folder:
 *
 *   <data folder>/<project id>/versions.json   [{ number, description, date }, …]
 *   <data folder>/<project id>/v1.zip, v2.zip, …
 *
 * The newest version is the current one. Older versions stay available to
 * download, and getting one never replaces the current version. Diffs are
 * worked out when asked for, by comparing two versions' files.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { diffLines } from "diff";
import { unzipSync } from "fflate";

/** One version, as stored. */
export interface Version {
  /** 1, 2, 3, … */
  number: number;
  /** e.g. "Keeps the speaker names when you ask it to." */
  description: string;
  /** When it was made: mm/dd/yy and the time (server's local time), e.g. "11/14/26 3:42 PM". */
  date: string;
}

/** How one file differs between two versions. */
export interface FileDiff {
  path: string;
  change: "added" | "removed" | "changed";
  /** Every line, marked; empty for images and other non-text files. */
  lines: { type: "added" | "removed" | "same"; text: string }[];
}

/** Writes a version's description from what changed (and the person's request, if any). */
export type Describe = (changes: FileDiff[], request?: string) => Promise<string>;

/** A mistake in a request (no such project or version, not a zip). The message is safe to show. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}

/** Biggest total of unpacked files we'll read from one zip, to compare versions: 200 MB. */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;

export class VersionStore {
  /** One queue per project, so two saves never get the same number. */
  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * @param dataDir Where projects are kept.
   * @param describe Writes descriptions. Without it (or if it fails), a plain one is used, e.g. "Changed main.py."
   */
  constructor(
    private readonly dataDir: string,
    private readonly describe?: Describe,
  ) {}

  /** Start a project from its first upload. Version 1 is described as "First version." */
  async createProject(zip: Uint8Array): Promise<{ id: string; version: Version }> {
    readZip(zip); // refuse anything that isn't a readable zip
    const id = randomUUID();
    await mkdir(this.folder(id), { recursive: true });
    const version: Version = { number: 1, description: "First version.", date: timestamp() };
    await writeFile(this.zipPath(id, 1), zip);
    await this.save(id, [version]);
    return { id, version };
  }

  /**
   * Save the project's code as the next version (e.g. after each chat
   * request that changed something).
   *
   * @param request What the person asked for, if this came from the chat; helps the description.
   */
  async addVersion(id: string, zip: Uint8Array, request?: string): Promise<Version> {
    readZip(zip);
    return this.queued(id, async () => {
      const versions = await this.load(id);
      const number = versions.length + 1;
      const changes = compare(await this.getZip(id, number - 1), zip);
      await writeFile(this.zipPath(id, number), zip);
      const version: Version = { number, description: await this.writeDescription(changes, request), date: timestamp() };
      await this.save(id, [...versions, version]);
      return version;
    });
  }

  /** Every version, newest first; the first one listed is the current one. */
  async listVersions(id: string): Promise<(Version & { isCurrent: boolean })[]> {
    const versions = await this.load(id);
    return versions.map((v) => ({ ...v, isCurrent: v.number === versions.length })).reverse();
  }

  /** The code at a version, as a zip ("Get this one"). */
  async getZip(id: string, number: number): Promise<Uint8Array> {
    await this.checkVersion(id, number);
    return readFile(this.zipPath(id, number));
  }

  /**
   * What changed from one version to another; by default, what a version
   * changed from the one before it. For version 1, every file is "added".
   */
  async diff(id: string, number: number, from = number - 1): Promise<FileDiff[]> {
    const after = await this.getZip(id, number);
    return compare(from === 0 ? null : await this.getZip(id, from), after);
  }

  /* ------------------------------- internals ------------------------------ */

  /** The project's folder. Ids are only ever ones we made (UUIDs), so this can't point elsewhere. */
  private folder(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new StoreError("There is no project with that id.", 404);
    return path.join(this.dataDir, id);
  }

  private zipPath(id: string, number: number): string {
    return path.join(this.folder(id), `v${number}.zip`);
  }

  private async load(id: string): Promise<Version[]> {
    try {
      return JSON.parse(await readFile(path.join(this.folder(id), "versions.json"), "utf8")) as Version[];
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError("There is no project with that id.", 404);
    }
  }

  private save(id: string, versions: Version[]): Promise<void> {
    return writeFile(path.join(this.folder(id), "versions.json"), JSON.stringify(versions, null, 2));
  }

  private async checkVersion(id: string, number: number): Promise<void> {
    const count = (await this.load(id)).length;
    if (!Number.isInteger(number) || number < 1 || number > count) throw new StoreError(`There is no version ${number}.`, 404);
  }

  /** Claude's description, or a plain one if Claude isn't set up or fails. Saving never fails because of it. */
  private async writeDescription(changes: FileDiff[], request?: string): Promise<string> {
    try {
      if (this.describe) return await this.describe(changes, request);
    } catch {
      // fall through to the plain description
    }
    if (changes.length === 0) return "No changes to the files.";
    const names = changes.slice(0, 3).map((c) => path.posix.basename(c.path));
    return `Changed ${names.join(", ")}${changes.length > 3 ? ` and ${changes.length - 3} more` : ""}.`;
  }

  /** Run `work` after earlier work on the same project has finished. */
  private queued<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.queues.set(id, next);
    return next;
  }
}

/** A moment as "mm/dd/yy h:mm AM/PM", e.g. "11/14/26 3:42 PM" (server's local time). */
export function timestamp(date = new Date()): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  const hour = date.getHours() % 12 || 12;
  return `${two(date.getMonth() + 1)}/${two(date.getDate())}/${two(date.getFullYear() % 100)} ${hour}:${two(date.getMinutes())} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

/** A zip's files (path → bytes), leaving out folders, zip clutter and .git. Throws a 400 if it isn't a readable zip. */
function readZip(zip: Uint8Array): Map<string, Uint8Array> {
  let total = 0;
  try {
    const entries = unzipSync(zip, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNPACKED_BYTES) throw new StoreError("The zip is too large.", 400);
        return !f.name.endsWith("/") && !/(^|\/)(__MACOSX|\.git)\/|(^|\/)\.DS_Store$/.test(f.name);
      },
    });
    return new Map(Object.entries(entries));
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError("That isn't a readable zip file.", 400);
  }
}

/** What changed from one zip to another (`null` before: every file is new). */
function compare(beforeZip: Uint8Array | null, afterZip: Uint8Array): FileDiff[] {
  const before = beforeZip ? readZip(beforeZip) : new Map<string, Uint8Array>();
  const after = readZip(afterZip);
  const result: FileDiff[] = [];
  for (const p of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(p);
    const b = after.get(p);
    if (a && b && Buffer.from(a).equals(Buffer.from(b))) continue;
    const change = !a ? "added" : !b ? "removed" : "changed";
    result.push({ path: p, change, lines: isText(a) && isText(b) ? lineDiff(decode(a), decode(b)) : [] });
  }
  return result;
}

/** Every line of two texts, marked added, removed or the same. */
function lineDiff(before: string, after: string): FileDiff["lines"] {
  return diffLines(before, after).flatMap((part) =>
    part.value
      .replace(/\n$/, "")
      .split("\n")
      .map((text) => ({ type: part.added ? "added" : part.removed ? "removed" : "same", text }) as const),
  );
}

/** Whether a file (or a missing one) can be shown as text: no NUL bytes. */
function isText(data: Uint8Array | undefined): boolean {
  return data === undefined || !data.subarray(0, 8000).includes(0);
}

function decode(data: Uint8Array | undefined): string {
  return data ? new TextDecoder().decode(data) : "";
}

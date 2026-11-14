/**
 * @file Unpacking an uploaded project zip into a folder the chat can work
 * on, and packing a version of it back into a zip.
 *
 * Uses fflate (a small, dependency-free zip library) for the format itself;
 * the safety checks are here: no paths that escape the folder, and limits on
 * size so a "zip bomb" can't fill the disk or memory.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync, zipSync, type Zippable } from "fflate";

/** Thrown when an upload can't be unpacked safely. The message is safe to show. */
export class ZipError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ZipError";
  }
}

/** Limits for {@link unpackZip}. */
export interface UnpackLimits {
  /** Most files in the zip. Default 5,000. */
  maxFiles: number;
  /** Most bytes after unpacking, all files together. Default 200 MiB. */
  maxTotalBytes: number;
}

export const DEFAULT_UNPACK_LIMITS: Readonly<UnpackLimits> = Object.freeze({ maxFiles: 5_000, maxTotalBytes: 200 * 1024 * 1024 });

/** Files zip programs add that aren't part of the project. */
const JUNK = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i];

/** Prefix of every temp folder made here, so leftovers are easy to spot. */
export const TEMP_PREFIX = "simplyopen-chat-";

/** An unpacked project and how to delete it. */
export interface UnpackedProject {
  /** The folder holding the project's files. */
  dir: string;
  /** Delete the folder. Safe to call more than once. */
  cleanup: () => Promise<void>;
}

/**
 * Unpack a zip into a new temp folder.
 *
 * @param zip The zip file's bytes.
 * @param limits See {@link UnpackLimits}.
 * @param parentDir Where to make the temp folder. Default the system temp folder.
 * @throws {ZipError} If it isn't a zip, is over a limit, has an unsafe path, or holds no files.
 */
export async function unpackZip(zip: Uint8Array, limits: Partial<UnpackLimits> = {}, parentDir = os.tmpdir()): Promise<UnpackedProject> {
  const lim = { ...DEFAULT_UNPACK_LIMITS, ...limits };
  let fileCount = 0;
  let declaredBytes = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      // Checked before anything is inflated, using the sizes the zip declares.
      filter: (file) => {
        if (file.name.endsWith("/") || JUNK.some((re) => re.test(file.name))) return false;
        fileCount++;
        declaredBytes += file.originalSize;
        if (fileCount > lim.maxFiles) throw new ZipError(`The zip has more than ${lim.maxFiles} files.`);
        if (declaredBytes > lim.maxTotalBytes) throw new ZipError(`The zip unpacks to more than ${lim.maxTotalBytes} bytes.`);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ZipError) throw error;
    throw new ZipError("The upload is not a readable zip file.", { cause: error });
  }

  // Declared sizes can lie; check what was actually unpacked too.
  const actualBytes = Object.values(entries).reduce((n, data) => n + data.length, 0);
  if (actualBytes > lim.maxTotalBytes) throw new ZipError(`The zip unpacks to more than ${lim.maxTotalBytes} bytes.`);
  const names = Object.keys(entries);
  if (names.length === 0) throw new ZipError("The zip has no files in it.");

  const dir = await mkdtemp(path.join(parentDir, TEMP_PREFIX));
  const cleanup = (): Promise<void> => rm(dir, { recursive: true, force: true });
  try {
    for (const name of names) {
      const rel = safeEntryPath(name);
      const target = path.join(dir, ...rel.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entries[name]!);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { dir, cleanup };
}

/** Pack files (path → contents) into a zip. */
export function packFiles(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const zippable: Zippable = {};
  for (const [rel, data] of files) zippable[rel] = data;
  return zipSync(zippable, { level: 6 });
}

/** A zip entry name as a clean relative path, or a {@link ZipError} if it would escape the folder. */
function safeEntryPath(name: string): string {
  const posix = name.replace(/\\/g, "/");
  if (posix.startsWith("/") || /^[A-Za-z]:/.test(posix) || posix.includes("\0")) {
    throw new ZipError(`The zip contains an unsafe path: "${name}".`);
  }
  const normalized = path.posix.normalize(posix);
  if (normalized === ".." || normalized.startsWith("../") || normalized === "." || normalized === "") {
    throw new ZipError(`The zip contains an unsafe path: "${name}".`);
  }
  return normalized;
}

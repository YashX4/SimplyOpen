/**
 * @file Types shared inside the Analyzer: the {@link ProjectSummary} that is
 * built from an uploaded project (by `projectSummary.ts`) and handed to the
 * prompt builder (`prompts.ts`) and the Claude client (`claudeClient.ts`).
 *
 * Types only — no logic and no imports — so any Analyzer module can depend on
 * it without creating import cycles.
 */

/** One file listed in the project tree. */
export interface FileTreeEntry {
  /** Path relative to the archive root, forward slashes. */
  path: string;
  /** Size of the file in bytes. */
  sizeBytes: number;
}

/**
 * A bounded view of an uploaded project: what the analysis prompt presents
 * to the model. Every file falls into exactly one of these groups:
 *
 * - included: listed in `fileTree` AND its full text is in `includedFiles`;
 * - listed only: in `fileTree` and in `skippedFiles` (path and size shown,
 *   contents not);
 * - unlisted: only in `skippedFiles` and counted in `unlistedFileCount`
 *   (the tree itself had to be cut short);
 * - excluded by design: binary/asset files and cache or dependency folders,
 *   counted in `excludedFileCount` and nowhere else.
 *
 * Files are never cut part-way: a file is either shown in full or not at all.
 */
export interface ProjectSummary {
  /** Files shown in the tree (path and size), sorted by path. */
  fileTree: FileTreeEntry[];
  /** Full text of each included file, keyed by its path in `fileTree`. */
  includedFiles: Map<string, string>;
  /**
   * `true` whenever any file's contents had to be left out for size
   * (i.e. `skippedFiles` is not empty). The analyzer then tells the model
   * which files it could not read.
   */
  truncated: boolean;
  /** Paths of every non-excluded file whose contents were left out, listed or not. Empty when nothing was cut. */
  skippedFiles: string[];
  /** How many of `skippedFiles` are not in `fileTree` because the tree was too long to list in full. */
  unlistedFileCount: number;
  /** Files left out entirely by design: binaries, images, archives, compiled files, and cache/dependency folders. */
  excludedFileCount: number;
  /**
   * Telling lines (entry-point guards, argument parsing, `input(`, game or
   * GUI or server start-up, environment variables, …) taken from code files
   * whose full contents were left out for size. Lets the model see how a big
   * project runs without reading all of it. In rank order; empty when
   * nothing was cut.
   */
  keyLines: KeyLine[];
  /**
   * Paths of asset files the program may load (images, sounds, fonts,
   * video). Their contents are never shown, only their names, so the model
   * knows they exist (e.g. a game's sprites). Capped; also counted in
   * `excludedFileCount`.
   */
  assetFiles: string[];
}

/** One telling line from a file that was not shown in full. */
export interface KeyLine {
  /** Path of the file, relative to the archive root. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** The line's text, trimmed and cut to a reasonable length. */
  text: string;
}

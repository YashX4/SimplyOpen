/**
 * @file Chat with Claude about a project from the command line.
 *
 *   npm run chat -- <project folder or .zip>
 *
 * A folder is changed in place, so a running Runner pointed at it (the
 * `SIMPLYOPEN_PROJECT` folder) picks the changes up on its next run. A zip
 * is your own copy, unpacked to a temp folder; type /save to write a version
 * of it out, as a zip or as a plain folder you can run straight away.
 *
 * Commands: /versions, /undo, /restore <n>, /save [n] [where], /files, /quit.
 *   /save                      the latest version, as a zip next to the original
 *   /save 2                    version 2
 *   /save ~/Desktop/game.zip   to that zip file
 *   /save ~/Desktop/game       to that folder, unzipped (it must be new or empty)
 * Set CHECK_URL to run the automatic checks after every change.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { ChatModelError, ChatSession, HttpProjectChecker, ProjectFileError, ProjectFolder, type Version } from "./chat.js";
import { packFiles, unpackZip } from "./zip.js";

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npm run chat -- <project folder or .zip>");
    process.exit(2);
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("Set ANTHROPIC_API_KEY to your Claude API key first.");
    process.exit(2);
  }
  if (/^\s|\s$|^["']|["']$/.test(key)) {
    console.error("Your ANTHROPIC_API_KEY has quote marks or spaces around it (often copied from a .env file). Set it to the key alone.");
    process.exit(2);
  }
  const isZip = (await stat(target)).isFile();
  const unpacked = isZip ? await unpackZip(await readFile(target)) : null;
  const folder = await ProjectFolder.open(unpacked?.dir ?? target);
  const chat = new ChatSession(folder, process.env.CHECK_URL ? { checker: new HttpProjectChecker(process.env.CHECK_URL) } : {});
  // output is needed so what you type is shown as you type it.
  const io = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  // Reading through the line iterator keeps lines typed (or piped) ahead of time, and ends cleanly at end of input.
  const lines = io[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string | null> => {
    process.stdout.write(prompt);
    const next = await lines.next();
    return next.done ? null : next.value;
  };

  console.log(isZip ? `Your own copy of ${target}. Type /save to keep a version of it.` : `Changing files in ${path.resolve(target)} directly.`);
  console.log("Say what you'd like to change. Commands: /versions /undo /restore <n> /save [n] [file.zip or folder] /files /quit\n");
  try {
    for (;;) {
      const input = await ask("you> ");
      if (input === null) break;
      const line = input.trim();
      if (line === "") continue;
      const [command, ...args] = line.split(/\s+/);
      try {
        if (command === "/quit") break;
        else if (command === "/files") console.log((await folder.listFiles()).join("\n"));
        else if (command === "/versions") for (const v of chat.versions) console.log(describe(v));
        else if (command === "/undo") console.log(show(await chat.undo(), "Nothing to undo."));
        else if (command === "/restore") console.log(show(await chat.restore(Number(args[0])), "Already like that version."));
        else if (command === "/save") {
          // "/save [n] [where]"; where may contain spaces and may be in quotes.
          const rest = line.slice("/save".length).trim();
          const versionMatch = /^(\d+)(?:\s+|$)/.exec(rest);
          const n = versionMatch ? Number(versionMatch[1]) : chat.versions.length - 1;
          const where = (versionMatch ? rest.slice(versionMatch[0].length) : rest).trim().replace(/^(["'])(.*)\1$/, "$2");
          const out = expandHome(where || `${isZip ? target.replace(/\.zip$/i, "") : "project"}-v${n}.zip`);
          console.log(await save(n, out));
        } else {
          await talk(line);
        }
      } catch (error) {
        if (error instanceof ProjectFileError || error instanceof ChatModelError || error instanceof SaveError) console.log(`  [${error.message}]`);
        else if (isFileSystemError(error)) console.log(`  [Couldn't do that: ${error.message}]`);
        else throw error;
      }
    }
  } finally {
    io.close();
    await unpacked?.cleanup();
  }

  /** Write version `n` to `out`: a zip if it ends in .zip, otherwise a new or empty folder. */
  async function save(n: number, out: string): Promise<string> {
    const files = await chat.filesAt(n);
    const resolved = path.resolve(out);
    if (/\.zip$/i.test(out)) {
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, packFiles(files));
      return `Saved version ${n} to ${resolved}`;
    }
    const existing = await readdir(resolved).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      if (error.code === "ENOTDIR") throw new SaveError(`${resolved} is a file. Give a folder name, or a name ending in .zip.`);
      throw error;
    });
    if (existing.filter((name) => name !== ".DS_Store").length > 0) {
      throw new SaveError(`${resolved} already has files in it. Pick a new folder name, so nothing there is overwritten.`);
    }
    for (const [rel, data] of files) {
      const dest = path.join(resolved, ...rel.split("/"));
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, data);
    }
    return `Saved version ${n} to the folder ${resolved}`;
  }

  async function talk(message: string, confirmPrivate = false): Promise<void> {
    // "claude>" is shown only once Claude starts answering, so a privacy reminder never looks like it came from Claude.
    let started = false;
    const onText = (t: string): void => {
      if (!started) process.stdout.write("claude> ");
      started = true;
      process.stdout.write(t);
    };
    const result = await chat.send(message, { confirmPrivate, onText });
    if (result.kind === "privacy_reminder") {
      console.log(`  ${result.reminder}`);
      const answer = ((await ask("  Send it anyway? (y/N) ")) ?? "").trim().toLowerCase();
      if (answer === "y" || answer === "yes") await talk(message, true);
      return;
    }
    console.log(`\n${result.version ? `  [${describe(result.version)}]` : "  [no files changed]"}${result.stoppedEarly ? "  [stopped early]" : ""}`);
    if (result.readyToDownload) console.log(`  [ready to download: version ${result.readyToDownload.version}; type /save to keep it]`);
    console.log();
  }
}

/** A problem with where /save was asked to write; the message is shown as is. */
class SaveError extends Error {}

/** "~" or "~/…" → the home folder (the shell doesn't expand it inside the chat). */
function expandHome(p: string): string {
  return p === "~" ? os.homedir() : p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/** A Node file-system error (permission denied, read-only disk, …), as opposed to a bug. */
function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string" && (error as NodeJS.ErrnoException).syscall !== undefined;
}

function describe(v: Version): string {
  const changed = v.changes.map((c) => `${c.path} ${c.change}`).join(", ");
  const checks = v.checks ? `; checks ${v.checks.status}${v.checks.status === "passed" ? "" : `: ${v.checks.summary}`}` : "";
  return `version ${v.number}: ${v.label}${changed ? ` (${changed})` : ""}${checks}`;
}

function show(version: Version | null, nothing: string): string {
  return version ? `Now at ${describe(version)}` : nothing;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

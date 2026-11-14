/**
 * @file The tools Claude uses to look at and change the project, and the
 * code that carries them out on a {@link ProjectFolder}.
 *
 * - `str_replace_based_edit_tool`: Anthropic's built-in text editor tool
 *   (`text_editor_20250728`), which Claude is trained to use: `view`,
 *   `create`, `str_replace` and `insert`. Its input schema is built into the
 *   model, so it is declared by type and name only.
 * - `delete_file`: removes a file (the text editor can't).
 *
 * Every input comes from the model, so it is checked here before anything
 * runs; a bad input becomes an error result Claude can recover from, never
 * an exception.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { ProjectFileError, type ProjectFolder } from "./projectFolder.js";

/** Name of the built-in text editor tool. */
export const EDITOR_TOOL_NAME = "str_replace_based_edit_tool";
/** Name of the delete tool. */
export const DELETE_TOOL_NAME = "delete_file";

/** Most characters returned by one `view`, so a huge file can't flood the conversation. */
export const MAX_VIEW_CHARACTERS = 60_000;
/** Most entries shown when viewing a folder. */
const MAX_LISTED_FILES = 500;

/** The tool definitions sent to Claude. */
export const EDIT_TOOLS: Anthropic.ToolUnion[] = [
  { type: "text_editor_20250728", name: EDITOR_TOOL_NAME, max_characters: MAX_VIEW_CHARACTERS },
  {
    name: DELETE_TOOL_NAME,
    description:
      "Delete one file from the project. Use only when the person's request needs a file removed, never to tidy up. Paths are relative to the project folder.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: 'The file to delete, e.g. "old_notes.txt".' } },
      required: ["path"],
      additionalProperties: false,
    },
  },
];

/** What running one tool call produced. */
export interface ToolOutcome {
  /** Text sent back to Claude as the tool result. */
  content: string;
  /** True when the call failed; Claude sees it as an error it can fix. */
  isError: boolean;
}

/**
 * Carry out one tool call from Claude.
 *
 * @param name The tool's name from the `tool_use` block.
 * @param input The tool's input from the `tool_use` block (untrusted).
 * @param folder The project to work on.
 */
export async function runTool(name: string, input: unknown, folder: ProjectFolder): Promise<ToolOutcome> {
  try {
    if (!isRecord(input)) return fail("the tool input must be an object");
    if (name === DELETE_TOOL_NAME) {
      const p = requireString(input, "path");
      await folder.deleteFile(p);
      return ok(`Deleted ${folder.relative(p)}.`);
    }
    if (name !== EDITOR_TOOL_NAME) return fail(`there is no tool named "${name}"`);

    const command = requireString(input, "command");
    const p = requireString(input, "path");
    switch (command) {
      case "view":
        return ok(await view(folder, p, input.view_range));
      case "create": {
        const text = requireString(input, "file_text");
        const existed = await folder.readText(p).then(() => true, () => false);
        await folder.writeText(p, text);
        return ok(`${existed ? "Replaced" : "Created"} ${folder.relative(p)}.`);
      }
      case "str_replace": {
        const oldStr = requireString(input, "old_str");
        const newStr = optionalString(input, "new_str") ?? "";
        if (oldStr === "") return fail("old_str must not be empty");
        const text = await folder.readText(p);
        const count = text.split(oldStr).length - 1;
        if (count === 0) return fail(`old_str was not found in ${folder.relative(p)}. View the file and copy the text exactly, including spaces and indentation.`);
        if (count > 1) return fail(`old_str appears ${count} times in ${folder.relative(p)}; include more surrounding lines so it matches exactly once.`);
        await folder.writeText(p, text.replace(oldStr, () => newStr));
        return ok(`Edited ${folder.relative(p)}.`);
      }
      case "insert": {
        // The current tool calls it insert_text; older versions used new_str.
        const insertText = optionalString(input, "insert_text") ?? optionalString(input, "new_str");
        if (insertText === undefined) return fail('insert needs "insert_text"');
        const line = input.insert_line;
        if (typeof line !== "number" || !Number.isInteger(line) || line < 0) return fail("insert_line must be a whole number, 0 or more");
        const text = await folder.readText(p);
        const lines = text.split("\n");
        if (line > lines.length) return fail(`insert_line ${line} is past the end of ${folder.relative(p)} (${lines.length} lines)`);
        lines.splice(line, 0, ...insertText.split("\n"));
        await folder.writeText(p, lines.join("\n"));
        return ok(`Inserted text after line ${line} of ${folder.relative(p)}.`);
      }
      default:
        return fail(`unknown command "${command}"; use view, create, str_replace or insert`);
    }
  } catch (error) {
    if (error instanceof ProjectFileError || error instanceof InputError) return fail(error.message);
    throw error;
  }
}

/** `view`: a folder listing, or a file with line numbers (optionally a range of lines). */
async function view(folder: ProjectFolder, p: string, range: unknown): Promise<string> {
  const rel = folder.relative(p);
  if (rel === "" || (await folder.isFolder(rel))) {
    const prefix = rel === "" ? "" : `${rel}/`;
    const files = (await folder.listFiles()).filter((f) => f.startsWith(prefix));
    if (files.length === 0) return `${rel || "The project folder"} is empty.`;
    const shown = files.slice(0, MAX_LISTED_FILES).map((f) => `${f}${folder.isProtected(f) ? "  (read-only)" : ""}`);
    const more = files.length > shown.length ? [`… and ${files.length - shown.length} more files`] : [];
    return [`Files in ${rel || "the project folder"}:`, ...shown, ...more].join("\n");
  }

  const lines = (await folder.readText(rel)).split("\n");
  let start = 1;
  let end = lines.length;
  if (range !== undefined && range !== null) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every((n) => Number.isInteger(n))) {
      throw new InputError("view_range must be two whole numbers, [first line, last line] (use -1 for the last line)");
    }
    start = range[0] as number;
    end = (range[1] as number) === -1 ? lines.length : (range[1] as number);
    if (start < 1 || start > lines.length || end < start || end > lines.length) {
      throw new InputError(`view_range [${start}, ${range[1]}] doesn't fit ${rel}, which has ${lines.length} lines`);
    }
  }
  const numbered = lines.slice(start - 1, end).map((line, i) => `${String(start + i).padStart(6)}\t${line}`).join("\n");
  if (numbered.length <= MAX_VIEW_CHARACTERS) return numbered;
  return `${numbered.slice(0, MAX_VIEW_CHARACTERS)}\n… (cut off: view a smaller view_range to see the rest)`;
}

/** A tool input that doesn't have the right shape. */
class InputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new InputError(`"${key}" must be given as text`);
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new InputError(`"${key}" must be text`);
  return value;
}

const ok = (content: string): ToolOutcome => ({ content, isError: false });
const fail = (content: string): ToolOutcome => ({ content: `Error: ${content}`, isError: true });

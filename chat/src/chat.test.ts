/**
 * Tests for the chat: the project folder's safety rules, the edit tools,
 * the conversation loop, versions, the privacy reminder, automatic checks,
 * zips, and the HTTP service. Claude is replaced by a
 * scripted fake, so no network calls are made; a live run is separate.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import multipartPlugin from "@fastify/multipart";
import Fastify from "fastify";
import { unzipSync, zipSync } from "fflate";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ChatBusyError,
  ChatModelError,
  ChatSession,
  HttpProjectChecker,
  ProjectFolder,
  type ChatReply,
  type CheckResult,
  type ModelClient,
  type ModelRequest,
  type ProjectChecker,
  type SendOptions,
} from "./chat.js";
import { runTool } from "./editTools.js";
import { findPrivateText, privacyReminder } from "./privacy.js";
import { checksFailedNote, CUT_OFF_TOOL_RESULT, LAST_STEP_NOTE } from "./prompts.js";
import { buildServer } from "./server.js";
import { packFiles, TEMP_PREFIX, unpackZip, ZipError } from "./zip.js";

const workRoot = await mkdtemp(path.join(os.tmpdir(), "chat-test-"));
afterAll(() => rm(workRoot, { recursive: true, force: true }));

/** A small project like the ones people upload. */
const PROJECT: Record<string, string> = {
  "resize.py": 'import sys\n\nWIDTH = 800\n\n\ndef main():\n    print(f"Resizing to {WIDTH}")\n\n\nif __name__ == "__main__":\n    main()\n',
  "requirements.txt": "Pillow\n",
  "simplyopen.json": '{"name": "Image Resizer"}\n',
  ".git/config": "[core]\n",
};

async function makeProject(files: Record<string, string> = PROJECT): Promise<string> {
  const dir = await mkdtemp(path.join(workRoot, "project-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), text);
  }
  return dir;
}

const read = (dir: string, rel: string): Promise<string> => readFile(path.join(dir, rel), "utf8");

/* ------------------------------------------------------------------------ */
/* Fake model                                                               */
/* ------------------------------------------------------------------------ */

type Step = (request: ModelRequest) => Anthropic.Message | Promise<Anthropic.Message>;

/** Answers with the given steps in order, and records every request it got. */
class ScriptedModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: Step[]) {}
  async next(request: ModelRequest): Promise<Anthropic.Message> {
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();
    if (!step) throw new Error("the fake model ran out of scripted steps");
    return step(request);
  }
}

function message(content: unknown[], stopReason: string): Anthropic.Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "fake",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Message;
}
let toolIds = 0;
const callTool = (input: Record<string, unknown>, name = "str_replace_based_edit_tool"): Step => () =>
  message([{ type: "tool_use", id: `toolu_${++toolIds}`, name, input }], "tool_use");
const answer = (text: string): Step => () => message([{ type: "text", text, citations: null }], "end_turn");

/** A checker that answers with the given outcomes in order, and keeps every project it was given. */
class FakeChecker implements ProjectChecker {
  readonly zips: Record<string, Uint8Array>[] = [];
  constructor(private readonly outcomes: CheckResult["status"][]) {}
  async check(zip: Uint8Array): Promise<CheckResult> {
    this.zips.push(unzipSync(zip));
    const n = this.zips.length;
    const status = this.outcomes.shift() ?? "passed";
    return { status, summary: status === "passed" ? `check ${n} passed` : status === "failed" ? `check ${n} failed` : `check ${n} couldn't run` };
  }
}

/** The tool results sent back in the request's last message. */
function lastToolResults(request: ModelRequest): { content: string; is_error: boolean }[] {
  const last = request.messages[request.messages.length - 1]!;
  return (last.content as { type: string; content: string; is_error: boolean }[]).filter((b) => b.type === "tool_result");
}

/* ------------------------------------------------------------------------ */
/* ProjectFolder                                                            */
/* ------------------------------------------------------------------------ */

describe("ProjectFolder keeps every change inside the project", () => {
  it.each(["../outside.txt", "a/../../outside.txt", "/../../outside.txt", "..\\outside.txt"])("rejects %s", async (p) => {
    const folder = await ProjectFolder.open(await makeProject());
    await expect(folder.writeText(p, "x")).rejects.toThrow(/outside the project/);
    await expect(folder.readText(p)).rejects.toThrow(/outside the project/);
  });

  it("cleans paths itself, before touching the disk", async () => {
    const folder = await ProjectFolder.open(await makeProject());
    for (const p of ["../x", "a/../../x", "/../x", "..\\x", ".."]) expect(() => folder.relative(p), p).toThrow(/outside the project/);
    expect(folder.relative("./a//b/../c.py")).toBe("a/c.py");
    expect(folder.relative("/")).toBe("");
  });

  it("treats a leading / as the project folder, never the real root", async () => {
    const dir = await makeProject();
    const folder = await ProjectFolder.open(dir);
    await folder.writeText("/notes/todo.txt", "hi");
    expect(await read(dir, "notes/todo.txt")).toBe("hi");
    expect(folder.relative("/resize.py")).toBe("resize.py");
  });

  it("won't follow a symbolic link out of the project", async () => {
    const dir = await makeProject();
    const outside = await mkdtemp(path.join(workRoot, "outside-"));
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(dir, "link"));
    const folder = await ProjectFolder.open(dir);
    await expect(folder.readText("link/secret.txt")).rejects.toThrow(/outside the project/);
    await expect(folder.writeText("link/new.txt", "x")).rejects.toThrow(/outside the project/);
    expect(await readdir(outside)).toEqual(["secret.txt"]);
  });

  it("can read protected files but never change them", async () => {
    const folder = await ProjectFolder.open(await makeProject(), { protectedPaths: [".git/", "simplyopen.json"] });
    expect(await folder.readText(".git/config")).toBe("[core]\n");
    await expect(folder.writeText(".git/config", "x")).rejects.toThrow(/protected/);
    await expect(folder.writeText(".git/hooks/pre-commit", "x")).rejects.toThrow(/protected/);
    await expect(folder.deleteFile("simplyopen.json")).rejects.toThrow(/protected/);
    await folder.writeText(".gitignore", "x"); // only the folder is protected, not names that start the same
  });

  it("a protected folder name is protected at any depth (a project zipped as a folder has its .git one level down)", async () => {
    const dir = await makeProject({ "game/main.py": "print(1)\n", "game/.git/config": "[core]\n", "game/src/generated/x.py": "" });
    const folder = await ProjectFolder.open(dir, { protectedPaths: [".git/", "game/src/generated/"] });
    await expect(folder.writeText("game/.git/config", "x")).rejects.toThrow(/protected/);
    await expect(folder.writeText("game/.git/hooks/pre-commit", "x")).rejects.toThrow(/protected/);
    await expect(folder.writeText("game/src/generated/x.py", "x")).rejects.toThrow(/protected/);
    await folder.writeText("game/main.py", "print(2)\n"); // the rest of the project is editable
    await folder.writeText("other/src/generated/x.py", ""); // a path rule only applies at its path
    expect(await read(dir, "game/.git/config")).toBe("[core]\n");
  });

  it("refuses binary and oversized files", async () => {
    const dir = await makeProject();
    await writeFile(path.join(dir, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    const folder = await ProjectFolder.open(dir, { maxFileBytes: 100 });
    await expect(folder.readText("photo.png")).rejects.toThrow(/not a text file/);
    await expect(folder.readText("resize.py")).rejects.toThrow(/too big/);
    await expect(folder.writeText("big.txt", "x".repeat(101))).rejects.toThrow(/too big/);
  });

  it("lists files without version-control or cache folders", async () => {
    const dir = await makeProject({ ...PROJECT, "__pycache__/resize.cpython-312.pyc": "x", "src/util.py": "" });
    expect(await (await ProjectFolder.open(dir)).listFiles()).toEqual(["requirements.txt", "resize.py", "simplyopen.json", "src/util.py"]);
  });
});

/* ------------------------------------------------------------------------ */
/* Edit tools                                                               */
/* ------------------------------------------------------------------------ */

describe("edit tools", () => {
  let dir: string;
  let folder: ProjectFolder;
  beforeEach(async () => {
    dir = await makeProject();
    folder = await ProjectFolder.open(dir, { protectedPaths: [".git/", "simplyopen.json"] });
  });
  const edit = (input: Record<string, unknown>) => runTool("str_replace_based_edit_tool", input, folder);

  it("view: the folder, marking read-only files", async () => {
    const { content, isError } = await edit({ command: "view", path: "/" });
    expect(isError).toBe(false);
    expect(content).toBe("Files in the project folder:\nrequirements.txt\nresize.py\nsimplyopen.json  (read-only)");
  });

  it("view: a file with line numbers, or just a range", async () => {
    expect((await edit({ command: "view", path: "resize.py" })).content.split("\n")[2]).toBe("     3\tWIDTH = 800");
    expect((await edit({ command: "view", path: "resize.py", view_range: [3, 3] })).content).toBe("     3\tWIDTH = 800");
    expect((await edit({ command: "view", path: "resize.py", view_range: [10, -1] })).content).toBe('    10\tif __name__ == "__main__":\n    11\t    main()\n    12\t');
    expect(await edit({ command: "view", path: "resize.py", view_range: [5, 99] })).toMatchObject({ isError: true });
  });

  it("str_replace: exactly one match, or a helpful error", async () => {
    expect(await edit({ command: "str_replace", path: "resize.py", old_str: "WIDTH = 800", new_str: "WIDTH = 1024" })).toEqual({ content: "Edited resize.py.", isError: false });
    expect(await read(dir, "resize.py")).toContain("WIDTH = 1024");
    expect((await edit({ command: "str_replace", path: "resize.py", old_str: "WIDTH = 800", new_str: "x" })).content).toMatch(/was not found/);
    expect((await edit({ command: "str_replace", path: "resize.py", old_str: "main()", new_str: "x" })).content).toMatch(/appears 2 times/);
  });

  it("str_replace: replacement text is used literally (no $& patterns)", async () => {
    await edit({ command: "str_replace", path: "resize.py", old_str: "WIDTH = 800", new_str: "PRICE = '$&$1'" });
    expect(await read(dir, "resize.py")).toContain("PRICE = '$&$1'");
  });

  it("create and insert", async () => {
    expect((await edit({ command: "create", path: "README.md", file_text: "# Resizer\n" })).content).toBe("Created README.md.");
    expect((await edit({ command: "create", path: "README.md", file_text: "# Resizer 2\n" })).content).toBe("Replaced README.md.");
    await edit({ command: "insert", path: "README.md", insert_line: 0, insert_text: "<!-- top -->" });
    await edit({ command: "insert", path: "README.md", insert_line: 3, insert_text: "end" });
    expect(await read(dir, "README.md")).toBe("<!-- top -->\n# Resizer 2\n\nend");
    expect((await edit({ command: "insert", path: "README.md", insert_line: 99, insert_text: "x" })).content).toMatch(/past the end/);
  });

  it("delete_file, and protected files stay put", async () => {
    expect(await runTool("delete_file", { path: "requirements.txt" }, folder)).toEqual({ content: "Deleted requirements.txt.", isError: false });
    expect((await runTool("delete_file", { path: "requirements.txt" }, folder)).content).toMatch(/does not exist/);
    expect((await runTool("delete_file", { path: "simplyopen.json" }, folder)).content).toMatch(/protected/);
    expect((await edit({ command: "create", path: ".git/config", file_text: "x" })).content).toMatch(/protected/);
    expect(await read(dir, ".git/config")).toBe("[core]\n");
  });

  it.each([
    [{ command: "view" }, /"path" must be given as text/],
    [{ command: "create", path: "a.txt" }, /"file_text" must be given as text/],
    [{ command: "str_replace", path: "resize.py", old_str: "" }, /old_str must not be empty/],
    [{ command: "insert", path: "resize.py", insert_line: -1, insert_text: "x" }, /whole number/],
    [{ command: "rename", path: "resize.py" }, /unknown command/],
    [{ command: "view", path: "../../etc/passwd" }, /outside the project/],
  ])("bad input %j becomes an error result, not a crash", async (input, explanation) => {
    const outcome = await edit(input);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toMatch(explanation);
  });

  it("unknown tools and non-object inputs are errors too", async () => {
    expect((await runTool("bash", { command: "ls" }, folder)).content).toMatch(/no tool named "bash"/);
    expect((await runTool("str_replace_based_edit_tool", "view /", folder)).content).toMatch(/must be an object/);
  });
});

/* ------------------------------------------------------------------------ */
/* ChatSession                                                              */
/* ------------------------------------------------------------------------ */

describe("ChatSession", () => {
  /** A reply, asserting it isn't a privacy reminder. */
  async function reply(chat: ChatSession, message: string, options: SendOptions = {}): Promise<ChatReply> {
    const result = await chat.send(message, options);
    if (result.kind !== "reply") throw new Error(`expected a reply, got: ${result.reminder}`);
    return result;
  }

  it("looks, edits, answers, and records the change as a version in the person's words", async () => {
    const dir = await makeProject();
    const model = new ScriptedModel([
      callTool({ command: "view", path: "resize.py" }),
      callTool({ command: "str_replace", path: "resize.py", old_str: "WIDTH = 800", new_str: "WIDTH = 1024" }),
      answer("I changed resize.py so pictures come out 1024 pixels wide."),
    ]);
    const chat = new ChatSession(await ProjectFolder.open(dir), { model });
    const result = await reply(chat, "Make the pictures   bigger\nplease");

    expect(result).toMatchObject({
      kind: "reply",
      reply: "I changed resize.py so pictures come out 1024 pixels wide.",
      version: { number: 1, label: "You asked: Make the pictures bigger please", changes: [{ path: "resize.py", change: "edited" }], checks: null },
      readyToDownload: null,
      stoppedEarly: false,
    });
    expect(chat.versions.map((v) => v.label)).toEqual(["Your copy", "You asked: Make the pictures bigger please"]);
    expect(await read(dir, "resize.py")).toContain("WIDTH = 1024");
    expect(lastToolResults(model.requests[1]!)[0]!.content).toContain("WIDTH = 800"); // it saw the file before editing
  });

  it("Claude only gets the person's message: nothing else can be attached", async () => {
    const model = new ScriptedModel([answer("ok")]);
    const chat = new ChatSession(await ProjectFolder.open(await makeProject()), { model });
    await reply(chat, "Make the title bigger", { appContext: "a log with private data" } as SendOptions);
    expect(model.requests[0]!.messages).toEqual([{ role: "user", content: "Make the title bigger" }]);
  });

  it("a message that looks private gets a reminder first, and nothing is sent until they confirm", async () => {
    const model = new ScriptedModel([answer("ok")]);
    const chat = new ChatSession(await ProjectFolder.open(await makeProject()), { model });
    const message = "It should email the report to jane.doe@example.com";

    const first = await chat.send(message);
    expect(first).toEqual({ kind: "privacy_reminder", reminder: expect.stringMatching(/^Before I send this: your message seems to include an email address\./), found: ["an email address"] });
    expect(model.requests).toHaveLength(0);
    expect(chat.versions).toHaveLength(1);

    await reply(chat, message, { confirmPrivate: true });
    expect(model.requests[0]!.messages[0]!.content).toBe(message);
  });

  it("remembers the conversation between messages", async () => {
    const model = new ScriptedModel([answer("Sure, which colour?"), answer("ok")]);
    const chat = new ChatSession(await ProjectFolder.open(await makeProject()), { model });
    await reply(chat, "Change the colour");
    await reply(chat, "Blue");
    expect(model.requests[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("a message that changes nothing makes no version (created then deleted counts as nothing)", async () => {
    const model = new ScriptedModel([
      callTool({ command: "create", path: "tmp.txt", file_text: "x" }),
      callTool({ path: "tmp.txt" }, "delete_file"),
      answer("Nothing needed changing."),
    ]);
    const chat = new ChatSession(await ProjectFolder.open(await makeProject()), { model });
    expect((await reply(chat, "Tidy up")).version).toBeNull();
    expect(chat.versions).toHaveLength(1);
  });

  /** A session with two changes made: version 1 edits resize.py, version 2 adds notes.txt and deletes requirements.txt. */
  async function twoVersions(extraSteps: Step[] = []): Promise<{ dir: string; chat: ChatSession; model: ScriptedModel }> {
    const dir = await makeProject();
    const model = new ScriptedModel([
      callTool({ command: "str_replace", path: "resize.py", old_str: "WIDTH = 800", new_str: "WIDTH = 50" }),
      answer("Smaller now."),
      callTool({ command: "create", path: "notes.txt", file_text: "new" }),
      callTool({ path: "requirements.txt" }, "delete_file"),
      answer("Added notes."),
      ...extraSteps,
    ]);
    const chat = new ChatSession(await ProjectFolder.open(dir), { model });
    await reply(chat, "Make them smaller");
    await reply(chat, "Add notes and drop the requirements");
    return { dir, chat, model };
  }

  it("restore puts the whole copy back as an earlier version, recorded as a new version so nothing is lost", async () => {
    const { dir, chat } = await twoVersions();
    const restored = await chat.restore(0);
    expect(restored).toMatchObject({ number: 3, label: "Restored version 0", restoredFrom: 0 });
    expect(restored!.changes).toEqual([
      { path: "notes.txt", change: "deleted" },
      { path: "requirements.txt", change: "created" },
      { path: "resize.py", change: "edited" },
    ]);
    expect(await read(dir, "resize.py")).toBe(PROJECT["resize.py"]);
    expect(await readdir(dir)).not.toContain("notes.txt");

    // ...and version 2 is still there to go back to.
    await chat.restore(2);
    expect(await read(dir, "notes.txt")).toBe("new");
    expect(await read(dir, "resize.py")).toContain("WIDTH = 50");
    expect(await chat.restore(2)).toBeNull(); // already like that
    await expect(chat.restore(9)).rejects.toThrow(/no version 9/);
  });

  it("undo after a restore reverses the restore", async () => {
    const { dir, chat } = await twoVersions();
    await chat.restore(0);
    expect(await chat.undo()).toMatchObject({ number: 4, label: "Undid: Restored version 0", restoredFrom: 2 });
    expect(await read(dir, "notes.txt")).toBe("new");
  });

  it("undo goes back one version at a time, even across undos", async () => {
    const { dir, chat } = await twoVersions();
    expect(await chat.undo()).toMatchObject({ number: 3, label: "Undid: You asked: Add notes and drop the requirements", restoredFrom: 1 });
    expect(await read(dir, "requirements.txt")).toBe("Pillow\n");
    expect(await read(dir, "resize.py")).toContain("WIDTH = 50");
    expect(await chat.undo()).toMatchObject({ number: 4, restoredFrom: 0 });
    expect(await read(dir, "resize.py")).toBe(PROJECT["resize.py"]);
    expect(await chat.undo()).toBeNull(); // back at their copy as they got it
  });

  it("Claude is told about a restore with the next message", async () => {
    const { chat, model } = await twoVersions([answer("ok")]);
    await chat.restore(1);
    await reply(chat, "Thanks");
    expect(model.requests.at(-1)!.messages.at(-1)!.content).toMatch(/^\(I went back to version 1 \("You asked: Make them smaller"\)/);
  });

  it("any version can be downloaded, with every file as it was then", async () => {
    const { chat } = await twoVersions();
    const decode = (files: Map<string, Buffer>) => Object.fromEntries([...files].map(([k, v]) => [k, v.toString("utf8")]));
    expect(decode(await chat.filesAt(0))).toEqual(PROJECT);
    expect(decode(await chat.filesAt(1))).toEqual({ ...PROJECT, "resize.py": PROJECT["resize.py"]!.replace("800", "50") });
    expect(Object.keys(decode(await chat.filesAt()))).toEqual([".git/config", "notes.txt", "resize.py", "simplyopen.json"]);
  });

  it("saying undo or naming a version in the chat works too, through Claude's tools", async () => {
    const { dir, chat, model } = await twoVersions([
      callTool({}, "list_versions"),
      callTool({}, "undo_last_change"),
      answer("I put it back."),
      callTool({ version: 0 }, "restore_version"),
      answer("Back to your copy."),
    ]);
    const undone = await reply(chat, "undo that");
    expect(lastToolResults(model.requests[6]!)[0]!.content).toBe(
      "Version 0: Your copy\nVersion 1: You asked: Make them smaller\nVersion 2: You asked: Add notes and drop the requirements  (current)",
    );
    expect(undone.version).toMatchObject({ number: 3, label: "You asked: undo that", restoredFrom: 1 });
    expect(await read(dir, "requirements.txt")).toBe("Pillow\n");

    expect((await reply(chat, "go back to how it was at the start")).version).toMatchObject({ number: 4, restoredFrom: 0 });
    expect(await read(dir, "resize.py")).toBe(PROJECT["resize.py"]);
  });

  it("a bad version number from Claude is an error it can fix", async () => {
    const { model, chat } = await twoVersions([callTool({ version: 7 }, "restore_version"), answer("Sorry.")]);
    await reply(chat, "go back to version 7");
    expect(lastToolResults(model.requests.at(-1)!)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/^Error: "version" must be one of these/) });
  });

  it("when they're happy, Claude offers the download of the newest version", async () => {
    const { chat } = await twoVersions([callTool({}, "offer_download"), answer("Here's your download.")]);
    expect(await reply(chat, "Perfect, I'd like to download it")).toMatchObject({ readyToDownload: { version: 2 }, version: null });
  });

  it("automatic checks run after a change; if they fail, Claude is told and fixes it in the same message", async () => {
    const dir = await makeProject();
    const checker = new FakeChecker(["failed", "passed"]);
    const model = new ScriptedModel([
      callTool({ path: "resize.py" }, "delete_file"),
      answer("Removed it."),
      callTool({ command: "create", path: "resize.py", file_text: PROJECT["resize.py"]! }),
      answer("I put the main file back, so it starts again."),
    ]);
    const chat = new ChatSession(await ProjectFolder.open(dir), { model, checker });
    const result = await reply(chat, "Remove the main file");

    expect(model.requests[2]!.messages.at(-1)!.content).toBe(checksFailedNote("check 1 failed"));
    expect(result.reply).toBe("I put the main file back, so it starts again.");
    expect(result.version).toBeNull(); // the fix undid the change, so nothing changed overall
    expect(checker.zips.map((files) => Object.keys(files).includes("resize.py"))).toEqual([false]);
  });

  it("checks that keep failing are recorded on the version; checks that can't run aren't sent to Claude", async () => {
    const failing = new FakeChecker(["failed", "failed"]);
    const model = new ScriptedModel([
      callTool({ command: "str_replace", path: "resize.py", old_str: "WIDTH = 800", new_str: "WIDTH = oops" }),
      answer("Done."),
      callTool({ command: "str_replace", path: "resize.py", old_str: "WIDTH = oops", new_str: "WIDTH = 'oops'" }),
      answer("Fixed."),
    ]);
    const chat = new ChatSession(await ProjectFolder.open(await makeProject()), { model, checker: failing });
    expect((await reply(chat, "Break it")).version!.checks).toEqual({ status: "failed", summary: "check 2 failed" });

    const down = new FakeChecker(["unavailable"]);
    const model2 = new ScriptedModel([callTool({ command: "create", path: "a.txt", file_text: "a" }), answer("Done.")]);
    const chat2 = new ChatSession(await ProjectFolder.open(await makeProject()), { model: model2, checker: down });
    expect((await reply(chat2, "Add a file")).version!.checks!.status).toBe("unavailable");
    expect(model2.requests).toHaveLength(2); // no extra round for Claude
  });

  it("no checks run when nothing changed", async () => {
    const checker = new FakeChecker([]);
    const chat = new ChatSession(await ProjectFolder.open(await makeProject()), { model: new ScriptedModel([answer("Which colour?")]), checker });
    await reply(chat, "Change the colour");
    expect(checker.zips).toHaveLength(0);
  });

  it("a tool call cut off at the output limit is never run", async () => {
    const dir = await makeProject();
    const model = new ScriptedModel([
      () => message([{ type: "tool_use", id: "toolu_cut", name: "str_replace_based_edit_tool", input: { command: "create", path: "resize.py", file_text: "half a fi" } }], "max_tokens"),
      answer("I'll do it in smaller steps."),
    ]);
    const chat = new ChatSession(await ProjectFolder.open(dir), { model });
    const result = await reply(chat, "Rewrite it");
    expect(await read(dir, "resize.py")).toBe(PROJECT["resize.py"]);
    expect(lastToolResults(model.requests[1]!)[0]).toEqual(expect.objectContaining({ content: CUT_OFF_TOOL_RESULT, is_error: true }));
    expect(result.version).toBeNull();
  });

  it("a refusal runs nothing and says so", async () => {
    const dir = await makeProject();
    const model = new ScriptedModel([() => message([{ type: "tool_use", id: "toolu_r", name: "delete_file", input: { path: "resize.py" } }], "refusal")]);
    const chat = new ChatSession(await ProjectFolder.open(dir), { model });
    expect(await reply(chat, "...")).toMatchObject({ reply: "I can't help with that change.", version: null, stoppedEarly: true });
    expect(await read(dir, "resize.py")).toBe(PROJECT["resize.py"]);
  });

  it("stops at the step limit: tools are switched off on the last step, and Claude is told why", async () => {
    const steps: Step[] = Array.from({ length: 2 }, () => callTool({ command: "view", path: "/" }));
    const model = new ScriptedModel([...steps, answer("I looked around but ran out of steps.")]);
    const chat = new ChatSession(await ProjectFolder.open(await makeProject()), { model, maxStepsPerMessage: 3 });
    const result = await reply(chat, "Explore");
    expect(model.requests.map((r) => r.toolChoice)).toEqual(["auto", "auto", "none"]);
    const lastBlocks = model.requests[2]!.messages.at(-1)!.content as { type: string; text?: string }[];
    expect(lastBlocks.at(-1)).toEqual({ type: "text", text: LAST_STEP_NOTE });
    expect(result.stoppedEarly).toBe(true);
  });

  it("one message at a time", async () => {
    let release!: () => void;
    const model = new ScriptedModel([() => new Promise((resolve) => (release = () => resolve(message([{ type: "text", text: "ok" }], "end_turn")))), answer("ok")]);
    const chat = new ChatSession(await ProjectFolder.open(await makeProject()), { model });
    const first = chat.send("one");
    await expect(chat.send("two")).rejects.toBeInstanceOf(ChatBusyError);
    await expect(chat.undo()).rejects.toBeInstanceOf(ChatBusyError);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await first;
    await expect(chat.send("three")).resolves.toMatchObject({ reply: "ok" });
  });

  it("if Claude fails mid-message, changes so far are kept as a version that can be undone, and the conversation starts clean", async () => {
    const dir = await makeProject();
    const model = new ScriptedModel([
      callTool({ command: "str_replace", path: "resize.py", old_str: "WIDTH = 800", new_str: "WIDTH = 9" }),
      () => { throw new ChatModelError("Could not reach Claude"); },
      answer("ok"),
    ]);
    const chat = new ChatSession(await ProjectFolder.open(dir), { model });
    await expect(chat.send("Change it")).rejects.toBeInstanceOf(ChatModelError);
    expect(chat.versions.at(-1)).toMatchObject({ number: 1, label: "You asked: Change it (not finished)" });
    expect(await chat.undo()).toMatchObject({ restoredFrom: 0 });
    expect(await read(dir, "resize.py")).toBe(PROJECT["resize.py"]);
    await reply(chat, "Try again");
    expect(model.requests[2]!.messages).toHaveLength(1); // the failed exchange was dropped
  });
});

/* ------------------------------------------------------------------------ */
/* Privacy reminder and checks                                              */
/* ------------------------------------------------------------------------ */

describe("findPrivateText", () => {
  it.each([
    ["email jane.doe@example.com the report", ["an email address"]],
    ["call me on (413) 555-0182", ["a phone number"]],
    ["my card is 4111 1111 1111 1111", ["a card number"]],
    ["SSN 123-45-6789", ["an ID number (like a Social Security number)"]],
    [`use this key sk-proj-${"a1B2".repeat(8)}`, ["a password or key"]],
    ["the password is hunter22", ["a password or key"]],
    ["it opened /Users/janedoe/Documents/notes.txt", ["a file location that shows your name"]],
    [`here is my file:\n${"line\n".repeat(20)}`, ["a long piece of pasted text"]],
    ["email a@b.co and call +1 413 555 0182", ["an email address", "a phone number"]],
  ])("finds what's private in %j", (text, found) => {
    expect(findPrivateText(text)).toEqual(found);
  });

  it.each([
    "Put speaker names in brackets",
    "Make the default width 1024 pixels",
    "It crashed and said something about line 13",
    "Can the report list the 3 most common words?",
    "Use 2026-11-14 as the date format",
    "undo that",
    "Use 1234 5678 9012 3456 as the example order number", // 16 digits, but not a valid card number
  ])("leaves ordinary requests alone: %j", (text) => {
    expect(findPrivateText(text)).toEqual([]);
  });

  it("the reminder lists everything found", () => {
    expect(privacyReminder(["an email address", "a phone number", "a card number"])).toMatch(/^Before I send this: your message seems to include an email address, a phone number and a card number\. /);
  });
});

describe("HttpProjectChecker", () => {
  it("posts the zip, and reads passed / failed / unavailable from the answer", async () => {
    const received: string[] = [];
    const app = Fastify();
    await app.register(multipartPlugin);
    app.post("/check/:outcome", async (request, reply) => {
      const file = await request.file();
      received.push(Object.keys(unzipSync(new Uint8Array(await file!.toBuffer()))).join(","));
      const outcome = (request.params as { outcome: string }).outcome;
      if (outcome === "ok") return { manifest: { name: "Resizer" } };
      if (outcome === "bad") return reply.code(422).send({ error: { code: "X", message: "No program to run was found." } });
      return reply.code(502).send({ error: { code: "Y", message: "upstream down" } });
    });
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    const zip = zipSync({ "main.py": new TextEncoder().encode("print(1)") });
    const signal = new AbortController().signal;

    expect(await new HttpProjectChecker(`${base}/check/ok`).check(zip, signal)).toEqual({ status: "passed", summary: "The automatic checks passed.", report: { manifest: { name: "Resizer" } } });
    expect(await new HttpProjectChecker(`${base}/check/bad`).check(zip, signal)).toMatchObject({ status: "failed", summary: "No program to run was found." });
    expect(await new HttpProjectChecker(`${base}/check/down`).check(zip, signal)).toEqual({ status: "unavailable", summary: "The automatic checks couldn't run (502)." });
    expect(received).toEqual(["main.py", "main.py", "main.py"]);
    await app.close();
    expect((await new HttpProjectChecker(`${base}/check/ok`).check(zip, signal)).status).toBe("unavailable");
  });
});

/* ------------------------------------------------------------------------ */
/* Zips                                                                     */
/* ------------------------------------------------------------------------ */

describe("zips", () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it("unpacks, and packs back with every file (junk dropped)", async () => {
    const zip = zipSync({ "app/main.py": enc("print(1)\n"), "app/.git/HEAD": enc("ref\n"), "__MACOSX/._main.py": enc("x"), "app/.DS_Store": enc("x") });
    const { dir, cleanup } = await unpackZip(zip, {}, workRoot);
    expect(Object.keys(unzipSync(packFiles(await (await ProjectFolder.open(dir)).filesAt(0)))).sort()).toEqual(["app/.git/HEAD", "app/main.py"]);
    await cleanup();
    await expect(readdir(dir)).rejects.toThrow();
  });

  it.each(["../evil.txt", "a/../../evil.txt", "/etc/evil.txt", "C:/evil.txt"])("rejects the unsafe path %s and leaves nothing behind", async (name) => {
    const before = (await readdir(workRoot)).filter((n) => n.startsWith(TEMP_PREFIX)).length;
    await expect(unpackZip(zipSync({ "ok.txt": enc("ok"), [name]: enc("x") }), {}, workRoot)).rejects.toThrow(/unsafe path/);
    expect((await readdir(workRoot)).filter((n) => n.startsWith(TEMP_PREFIX))).toHaveLength(before);
  });

  it("refuses a zip that declares too much before unpacking any of it", async () => {
    // A tiny file whose central directory claims it unpacks to 2 GB.
    const zip = zipSync({ "a.txt": enc("x") });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = zip.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 2_000_000_000, true);
        break;
      }
    }
    await expect(unpackZip(zip, { maxTotalBytes: 1000 })).rejects.toThrow(/more than 1000 bytes/);
  });

  it("enforces size and count limits, and rejects non-zips and empty zips", async () => {
    await expect(unpackZip(zipSync({ "a.txt": enc("x".repeat(1000)) }), { maxTotalBytes: 999 })).rejects.toThrow(/more than 999 bytes/);
    await expect(unpackZip(zipSync({ "a": enc("1"), "b": enc("2"), "c": enc("3") }), { maxFiles: 2 })).rejects.toThrow(/more than 2 files/);
    await expect(unpackZip(enc("not a zip"))).rejects.toBeInstanceOf(ZipError);
    await expect(unpackZip(zipSync({ "folder/": new Uint8Array() }))).rejects.toThrow(/no files/);
  });
});

/* ------------------------------------------------------------------------ */
/* HTTP service                                                             */
/* ------------------------------------------------------------------------ */

describe("HTTP service", () => {
  function multipart(zip: Uint8Array, field = "file"): { payload: Buffer; headers: Record<string, string> } {
    const boundary = "----chat-test";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="project.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      Buffer.from(zip),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
  }
  const projectZip = () => zipSync(Object.fromEntries(Object.entries(PROJECT).map(([k, v]) => [k, new TextEncoder().encode(v)])));
  const fileIn = (zip: Buffer, name: string) => new TextDecoder().decode(unzipSync(new Uint8Array(zip))[name]);

  it("make a copy → chat → versions → download any version → restore → undo → delete", async () => {
    const model = new ScriptedModel([
      callTool({ command: "str_replace", path: "resize.py", old_str: "WIDTH = 800", new_str: "WIDTH = 640" }),
      answer("Pictures now come out 640 pixels wide."),
    ]);
    const app = await buildServer({ logger: false, session: { model, checker: new FakeChecker(["passed"]) } });

    const created = await app.inject({ method: "POST", url: "/sessions", ...multipart(projectZip()) });
    expect(created.statusCode).toBe(201);
    const { sessionId, files, version } = created.json() as { sessionId: string; files: string[]; version: { number: number; label: string } };
    expect(files).toEqual(["requirements.txt", "resize.py", "simplyopen.json"]);
    expect(version).toMatchObject({ number: 0, label: "Your copy" });
    const base = `/sessions/${sessionId}`;

    const sent = await app.inject({ method: "POST", url: `${base}/messages`, payload: { message: "Make them smaller" } });
    expect(sent.json()).toMatchObject({
      kind: "reply",
      reply: "Pictures now come out 640 pixels wide.",
      version: { number: 1, label: "You asked: Make them smaller", changes: [{ path: "resize.py", change: "edited" }], checks: { status: "passed" } },
      readyToDownload: null,
    });
    expect((await app.inject({ method: "GET", url: `${base}/versions` })).json().versions.map((v: { label: string }) => v.label)).toEqual(["Your copy", "You asked: Make them smaller"]);

    const latest = await app.inject({ method: "GET", url: `${base}/project.zip` });
    expect([latest.headers["content-type"], latest.headers["content-disposition"]]).toEqual(["application/zip", 'attachment; filename="project-v1.zip"']);
    expect(fileIn(latest.rawPayload, "resize.py")).toContain("WIDTH = 640");
    expect(Object.keys(unzipSync(new Uint8Array(latest.rawPayload)))).toContain(".git/config"); // nothing uploaded is lost
    expect(fileIn((await app.inject({ method: "GET", url: `${base}/project.zip?version=0` })).rawPayload, "resize.py")).toContain("WIDTH = 800");

    expect((await app.inject({ method: "POST", url: `${base}/versions/0/restore` })).json()).toMatchObject({ version: { number: 2, label: "Restored version 0" } });
    // Undo reverses the restore; undoing again keeps going back.
    expect((await app.inject({ method: "POST", url: `${base}/undo` })).json()).toMatchObject({ version: { number: 3, label: "Undid: Restored version 0", restoredFrom: 1 } });
    expect(fileIn((await app.inject({ method: "GET", url: `${base}/project.zip` })).rawPayload, "resize.py")).toContain("WIDTH = 640");
    expect((await app.inject({ method: "POST", url: `${base}/undo` })).json()).toMatchObject({ version: { number: 4, restoredFrom: 0 } });
    expect((await app.inject({ method: "POST", url: `${base}/undo` })).json()).toEqual({ version: null });

    expect((await app.inject({ method: "DELETE", url: base })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `${base}/files` })).statusCode).toBe(404);
    await app.close();
  });

  it("a message that looks private gets the reminder, and goes through only with confirmPrivate", async () => {
    const model = new ScriptedModel([answer("ok")]);
    const app = await buildServer({ logger: false, session: { model } });
    const { sessionId } = (await app.inject({ method: "POST", url: "/sessions", ...multipart(projectZip()) })).json() as { sessionId: string };
    const url = `/sessions/${sessionId}/messages`;
    const message = "Send it to me at jane@example.com";

    expect((await app.inject({ method: "POST", url, payload: { message } })).json()).toMatchObject({ kind: "privacy_reminder", found: ["an email address"] });
    expect(model.requests).toHaveLength(0);
    expect((await app.inject({ method: "POST", url, payload: { message, confirmPrivate: true } })).json()).toMatchObject({ kind: "reply", reply: "ok" });
    await app.close();
  });

  it("protects version-control folders like .git by default", async () => {
    const model = new ScriptedModel([callTool({ command: "create", path: ".git/config", file_text: "x" }), answer("I couldn't change that.")]);
    const app = await buildServer({ logger: false, session: { model } });
    const { sessionId } = (await app.inject({ method: "POST", url: "/sessions", ...multipart(projectZip()) })).json() as { sessionId: string };
    await app.inject({ method: "POST", url: `/sessions/${sessionId}/messages`, payload: { message: "x" } });
    expect(lastToolResults(model.requests[1]!)[0]!.content).toMatch(/protected/);
    await app.close();
  });

  it("rejects bad requests with clear codes, including anything besides the message", async () => {
    const app = await buildServer({ logger: false, session: { model: new ScriptedModel([]) } });
    const code = async (res: Promise<{ statusCode: number; json: () => unknown }>) => {
      const r = await res;
      return [r.statusCode, (r.json() as { error: { code: string } }).error.code];
    };
    expect(await code(app.inject({ method: "POST", url: "/sessions", payload: { a: 1 } }))).toEqual([415, "UNSUPPORTED_MEDIA_TYPE"]);
    expect(await code(app.inject({ method: "POST", url: "/sessions", ...multipart(new TextEncoder().encode("nope")) }))).toEqual([422, "BAD_ZIP"]);
    expect(await code(app.inject({ method: "POST", url: "/sessions", ...multipart(projectZip(), "other") }))).toEqual([400, "NO_FILE"]);
    expect(await code(app.inject({ method: "POST", url: "/sessions/nope/messages", payload: { message: "hi" } }))).toEqual([404, "NO_SUCH_SESSION"]);

    const { sessionId } = (await app.inject({ method: "POST", url: "/sessions", ...multipart(projectZip()) })).json() as { sessionId: string };
    const base = `/sessions/${sessionId}`;
    const url = `${base}/messages`;
    expect(await code(app.inject({ method: "POST", url, payload: { message: "  " } }))).toEqual([400, "NO_MESSAGE"]);
    expect(await code(app.inject({ method: "POST", url, payload: { message: "x".repeat(4001) } }))).toEqual([400, "MESSAGE_TOO_LONG"]);
    expect(await code(app.inject({ method: "POST", url, payload: { message: "hi", confirmPrivate: "yes" } }))).toEqual([400, "BAD_CONFIRM"]);
    expect(await code(app.inject({ method: "POST", url, payload: { message: "Why did it fail?", appContext: "run log" } }))).toEqual([400, "UNKNOWN_FIELDS"]);
    expect(await code(app.inject({ method: "POST", url: `${base}/versions/5/restore` }))).toEqual([404, "NO_SUCH_VERSION"]);
    expect(await code(app.inject({ method: "GET", url: `${base}/project.zip?version=-1` }))).toEqual([404, "NO_SUCH_VERSION"]);
    await app.close();
  });

  it("409 while busy, 502 when Claude fails, 429 when full", async () => {
    let release!: () => void;
    const model = new ScriptedModel([
      () => new Promise((resolve) => (release = () => resolve(message([{ type: "text", text: "ok" }], "end_turn")))),
      () => { throw new ChatModelError("The Claude API returned an error: 529 overloaded"); },
    ]);
    const app = await buildServer({ logger: false, maxSessions: 1, session: { model } });
    const { sessionId } = (await app.inject({ method: "POST", url: "/sessions", ...multipart(projectZip()) })).json() as { sessionId: string };
    const url = `/sessions/${sessionId}/messages`;

    const first = app.inject({ method: "POST", url, payload: { message: "one" } });
    await new Promise((r) => setTimeout(r, 50));
    expect((await app.inject({ method: "POST", url, payload: { message: "two" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/sessions/${sessionId}/undo` })).statusCode).toBe(409);
    release();
    expect((await first).statusCode).toBe(200);

    const failed = await app.inject({ method: "POST", url, payload: { message: "three" } });
    expect([failed.statusCode, (failed.json() as { error: { message: string } }).error.message]).toEqual([502, "The Claude API returned an error: 529 overloaded"]);
    expect((await app.inject({ method: "POST", url: "/sessions", ...multipart(projectZip()) })).statusCode).toBe(429);
    await app.close();
  });

  it("closing the server deletes every session's files", async () => {
    const before = new Set(await readdir(os.tmpdir()));
    const app = await buildServer({ logger: false, session: { model: new ScriptedModel([]) } });
    await app.inject({ method: "POST", url: "/sessions", ...multipart(projectZip()) });
    const during = (await readdir(os.tmpdir())).filter((n) => n.startsWith(TEMP_PREFIX) && !before.has(n));
    expect(during).toHaveLength(1);
    await app.close();
    expect((await readdir(os.tmpdir())).filter((n) => during.includes(n))).toEqual([]);
  });
});

describe("version history (HISTORY_URL)", () => {
  /** A stand-in for the History service that records every call. */
  async function fakeHistory(options: { failCreate?: boolean } = {}) {
    const calls: { url: string; request?: string; files: string[] }[] = [];
    const app = Fastify();
    await app.register(multipartPlugin);
    app.post("/api/projects", async (request, reply) => {
      const call = await readCall(request.url, request.parts());
      calls.push(call);
      if (options.failCreate) return reply.code(500).send({ error: { message: "down" } });
      return reply.code(201).send({ id: "proj-1", version: { number: 1 } });
    });
    app.post("/api/projects/:id/versions", async (request, reply) => {
      calls.push(await readCall(request.url, request.parts()));
      return reply.code(201).send({ number: calls.length, description: "A plain sentence.", date: "11/14/26 3:42 PM" });
    });
    return { url: await app.listen({ port: 0, host: "127.0.0.1" }), calls, close: () => app.close() };
  }

  async function readCall(url: string, parts: AsyncIterableIterator<{ type: string; fieldname: string; value?: unknown; toBuffer?: () => Promise<Buffer> }>) {
    const call: { url: string; request?: string; files: string[] } = { url, files: [] };
    for await (const part of parts) {
      if (part.type === "file") call.files = Object.keys(unzipSync(new Uint8Array(await part.toBuffer!()))).sort();
      else if (part.fieldname === "request") call.request = String(part.value);
    }
    return call;
  }

  function upload(zip: Uint8Array): { payload: Buffer; headers: Record<string, string> } {
    const boundary = "----history";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      Buffer.from(zip),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
  }
  const projectZip = () => zipSync(Object.fromEntries(Object.entries(PROJECT).map(([k, v]) => [k, new TextEncoder().encode(v)])));

  it("every change the person asks for, and every undo, becomes a History version; questions and answers don't", async () => {
    const history = await fakeHistory();
    const model = new ScriptedModel([
      callTool({ command: "str_replace", path: "resize.py", old_str: "WIDTH = 800", new_str: "WIDTH = 640" }),
      answer("Pictures now come out 640 pixels wide."),
      answer("Which colour would you like?"), // a question back: nothing changed
      callTool({ command: "create", path: "notes.txt", file_text: "hi" }),
      answer("Added a notes file."),
    ]);
    const app = await buildServer({ logger: false, session: { model }, historyUrl: history.url });

    const created = (await app.inject({ method: "POST", url: "/sessions", ...upload(projectZip()) })).json() as { sessionId: string; historyProjectId: string };
    expect(created.historyProjectId).toBe("proj-1");
    const say = (message: string) => app.inject({ method: "POST", url: `/sessions/${created.sessionId}/messages`, payload: { message } });

    expect((await say("Make them smaller")).json()).toMatchObject({ kind: "reply", history: { version: { description: "A plain sentence.", date: "11/14/26 3:42 PM" } } });
    expect((await say("Change the colour")).json()).not.toHaveProperty("history");
    await say("Add a notes file");
    expect((await app.inject({ method: "POST", url: `/sessions/${created.sessionId}/undo` })).json()).toMatchObject({ history: { version: {} } });

    expect(history.calls.map((c) => [c.url, c.request ?? null])).toEqual([
      ["/api/projects", null],
      ["/api/projects/proj-1/versions", "Make them smaller"],
      ["/api/projects/proj-1/versions", "Add a notes file"],
      ["/api/projects/proj-1/versions", "Undid: You asked: Add a notes file"],
    ]);
    // Each version holds the whole project as it was after that change.
    expect(history.calls[2]!.files).toContain("notes.txt");
    expect(history.calls[3]!.files).not.toContain("notes.txt");
    await app.close();
    await history.close();
  });

  it("History being down never stops the chat", async () => {
    const history = await fakeHistory({ failCreate: true });
    const model = new ScriptedModel([callTool({ command: "create", path: "a.txt", file_text: "a" }), answer("Done.")]);
    const app = await buildServer({ logger: false, session: { model }, historyUrl: history.url });
    const created = (await app.inject({ method: "POST", url: "/sessions", ...upload(projectZip()) })).json() as { sessionId: string; historyProjectId: string | null };
    expect(created.historyProjectId).toBeNull();
    const reply = (await app.inject({ method: "POST", url: `/sessions/${created.sessionId}/messages`, payload: { message: "Add a file" } })).json();
    expect(reply).toMatchObject({ kind: "reply", reply: "Done.", history: { error: expect.stringMatching(/wasn't reachable/) } });
    await app.close();
    await history.close();
  });
});

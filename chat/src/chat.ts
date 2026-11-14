/**
 * @file {@link ChatSession}: one person's conversation with Claude about
 * their own private copy of a project. Each message may lead Claude to look
 * at and change the project's files; every change becomes a version
 * labelled in the person's words ("You asked: …"), is checked
 * automatically, and can be undone or restored.
 *
 * Privacy: Claude only ever sees the project's files and the chat messages.
 * Before a message that looks like it holds something private is sent, the
 * person gets a reminder and must confirm.
 *
 * This is the chat's whole public surface. It depends only on a
 * {@link ProjectFolder} (any folder of files), a {@link ModelClient} (Claude,
 * or a fake in tests) and, optionally, a {@link ProjectChecker}. It knows
 * nothing about the Runner, the Analyzer, manifests, or how a program is run.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { CheckResult, ProjectChecker } from "./checks.js";
import { EDIT_TOOLS, runTool } from "./editTools.js";
import { findPrivateText, privacyReminder } from "./privacy.js";
import { ProjectFolder, type FileChange } from "./projectFolder.js";
import { checksFailedNote, CUT_OFF_TOOL_RESULT, LAST_STEP_NOTE, SYSTEM_PROMPT } from "./prompts.js";
import { packFiles } from "./zip.js";

export { ProjectFolder, ProjectFileError, DEFAULT_PROTECTED_PATHS, type FileChange, type ProjectFolderOptions } from "./projectFolder.js";
export { HttpProjectChecker, type CheckResult, type ProjectChecker } from "./checks.js";

/* ------------------------------------------------------------------------ */
/* The model                                                                */
/* ------------------------------------------------------------------------ */

/** One request to the model: everything needed for the next assistant message. */
export interface ModelRequest {
  system: string;
  tools: Anthropic.ToolUnion[];
  messages: Anthropic.MessageParam[];
  /** "none" on the last allowed step, so the model must answer in words. */
  toolChoice: "auto" | "none";
}

/** Anything that can produce the next assistant message. Implement with a fake to test without the network. */
export interface ModelClient {
  /**
   * @param request The conversation so far.
   * @param signal Cancels the call.
   * @param onText Called with each piece of reply text as it is written, if the client streams.
   * @throws {ChatModelError} If the call fails.
   */
  next(request: ModelRequest, signal: AbortSignal, onText?: (text: string) => void): Promise<Anthropic.Message>;
}

/** Thrown when the call to Claude fails (network, API error, timeout, cancellation). */
export class ChatModelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatModelError";
  }
}

/** Thrown when a message is sent while the session is still working on the previous one. */
export class ChatBusyError extends Error {
  constructor() {
    super("Still working on the previous message");
    this.name = "ChatBusyError";
  }
}

/** Options for {@link AnthropicModelClient}. */
export interface AnthropicModelClientOptions {
  /** Pre-built SDK client. Otherwise one is created from the environment (`ANTHROPIC_API_KEY`). */
  anthropic?: Anthropic;
  /** Model id. Default `claude-opus-5-5`. */
  model?: string;
  /** Reasoning effort. Default `"medium"`. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Output token cap per step, including thinking. Default 32,000 (room for rewriting a file). */
  maxTokens?: number;
  /** Time limit for one step, in milliseconds. Default 180,000. */
  timeoutMs?: number;
}

/**
 * {@link ModelClient} backed by the Anthropic Messages API: streamed, with
 * adaptive thinking, and with prompt caching on the system prompt and on the
 * conversation so far (each step resends the whole conversation, so caching
 * keeps a multi-step edit cheap and fast).
 */
export class AnthropicModelClient implements ModelClient {
  private readonly anthropic: Anthropic;
  private readonly model: string;
  private readonly effort: NonNullable<AnthropicModelClientOptions["effort"]>;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(options: AnthropicModelClientOptions = {}) {
    this.anthropic = options.anthropic ?? new Anthropic({ maxRetries: 2 });
    this.model = options.model ?? "claude-opus-5-5";
    this.effort = options.effort ?? "medium";
    this.maxTokens = options.maxTokens ?? 32_000;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async next(request: ModelRequest, signal: AbortSignal, onText?: (text: string) => void): Promise<Anthropic.Message> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const stream = this.anthropic.messages.stream(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: this.effort },
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          tools: request.tools,
          tool_choice: { type: request.toolChoice },
          messages: withCacheBreakpoint(request.messages),
        },
        { signal: combined },
      );
      if (onText) stream.on("text", onText);
      return await stream.finalMessage();
    } catch (error) {
      if (signal.aborted) throw new ChatModelError("The message was cancelled", { cause: error });
      if (timeout.aborted) throw new ChatModelError(`Claude did not answer within ${this.timeoutMs} ms`, { cause: error });
      if (error instanceof Anthropic.APIError) throw new ChatModelError(`The Claude API returned an error: ${error.message}`, { cause: error });
      throw new ChatModelError("Could not reach Claude", { cause: error });
    }
  }
}

/**
 * A copy of the conversation with a cache breakpoint on its last block, so
 * the next step reads everything before it from the cache. Only the copy is
 * marked, so breakpoints never pile up past the API's limit of four.
 */
function withCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const copy = messages.slice();
  const last = copy[copy.length - 1];
  if (!last) return copy;
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content.slice();
  const tail = blocks[blocks.length - 1];
  if (tail && (tail.type === "text" || tail.type === "tool_result")) {
    blocks[blocks.length - 1] = { ...tail, cache_control: { type: "ephemeral" } };
  }
  // Same role, same blocks, one more cache marker.
  copy[copy.length - 1] = { ...last, content: blocks } as Anthropic.MessageParam;
  return copy;
}

/* ------------------------------------------------------------------------ */
/* The session                                                              */
/* ------------------------------------------------------------------------ */

/** One version of the person's copy. Version 0 is the copy as they got it. */
export interface Version {
  /** 0, 1, 2, … */
  number: number;
  /** In the person's own words, e.g. "You asked: put speaker names in brackets". */
  label: string;
  /** When it was made (ISO 8601). */
  createdAt: string;
  /** What changed from the version before. */
  changes: FileChange[];
  /** The automatic checks on this version; null when no checker is set up, or for version 0. */
  checks: CheckResult | null;
  /** Set when this version only put back an earlier one (undo or restore): that version's number. */
  restoredFrom?: number;
}

/** Options for {@link ChatSession}. */
export interface ChatSessionOptions {
  /** The model to talk to. Default a new {@link AnthropicModelClient}. */
  model?: ModelClient;
  /** Runs the automatic checks after every change. Without one, no checks run. */
  checker?: ProjectChecker;
  /** Most model steps (each a look or a change) for one message. Default 25. */
  maxStepsPerMessage?: number;
}

/** Options for {@link ChatSession.send}. */
export interface SendOptions {
  /**
   * The person saw the privacy reminder for this message and chose to send
   * it anyway. Without this, a message that looks like it holds something
   * private is not sent; a {@link PrivacyReminder} comes back instead.
   */
  confirmPrivate?: boolean;
  /** Cancels the message. Changes already made are kept as a version. */
  signal?: AbortSignal;
  /** Called with each piece of Claude's reply as it is written. */
  onText?: (text: string) => void;
}

/** Claude's answer to one message. */
export interface ChatReply {
  kind: "reply";
  /** Claude's plain-English answer. */
  reply: string;
  /** The new version this message made, or null if nothing changed. */
  version: Version | null;
  /** Set when the person said they're ready: show the download for this version. */
  readyToDownload: { version: number } | null;
  /** True if Claude was stopped before finishing (step limit, or it declined). */
  stoppedEarly: boolean;
}

/** Returned instead of a reply when the message looks private and wasn't confirmed. Nothing was sent. */
export interface PrivacyReminder {
  kind: "privacy_reminder";
  /** The reminder to show, in plain English. */
  reminder: string;
  /** What was found, e.g. ["an email address"]. */
  found: string[];
}

/** Tools for versions and downloading, handled by the session itself. */
const SESSION_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_versions",
    description: "List every version of the person's copy, newest last, with what they asked for in each.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "undo_last_change",
    description: "Put the project back as it was before the latest change. Use when the person says undo, go back, or that the last change was wrong.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "restore_version",
    description: "Put the whole project back as it was at an earlier version (see list_versions). Nothing is lost: the restore is recorded as a new version.",
    input_schema: {
      type: "object",
      properties: { version: { type: "integer", description: "The version number to go back to; 0 is their copy as they got it." } },
      required: ["version"],
      additionalProperties: false,
    },
  },
  {
    name: "offer_download",
    description: "Show the person the download button for the newest version, so they can run it on their own computer. Call when they say they're happy with it or want to download it.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/** Every tool Claude gets. */
const ALL_TOOLS: Anthropic.ToolUnion[] = [...EDIT_TOOLS, ...SESSION_TOOLS];

/** Longest label kept from the person's message. */
const MAX_LABEL_CHARS = 100;

/** What happened during one message's tool loop, beyond the reply. */
interface TurnState {
  /** The version the files were last restored to with nothing changed since, if any. */
  restoredFrom: number | undefined;
  /** Whether that restore was an undo. */
  wasUndo: boolean;
  /** Whether Claude offered the download. */
  offerDownload: boolean;
}

/**
 * One person's conversation about their own copy of a project. Keeps the
 * conversation between messages, so they can refer back ("make it bigger",
 * "undo that"), and keeps every version.
 *
 * Handles one message at a time; a second {@link send} while one is running
 * throws {@link ChatBusyError}.
 */
export class ChatSession {
  private readonly messages: Anthropic.MessageParam[] = [];
  /** Something Claude must be told with the next message (e.g. that the person restored a version). */
  private pendingNote: string | null = null;
  private readonly history: Version[] = [{ number: 0, label: "Your copy", createdAt: new Date().toISOString(), changes: [], checks: null }];
  /** Numbers of the versions made by an undo, so undoing again keeps going back. */
  private readonly undoVersions = new Set<number>();
  private readonly model: ModelClient;
  private readonly checker: ProjectChecker | undefined;
  private readonly maxSteps: number;
  private busy = false;

  constructor(
    /** The person's copy of the project. */
    readonly folder: ProjectFolder,
    options: ChatSessionOptions = {},
  ) {
    this.model = options.model ?? new AnthropicModelClient();
    this.checker = options.checker;
    this.maxSteps = options.maxStepsPerMessage ?? 25;
  }

  /** Every version so far, oldest first. The last one is the current state of the copy. */
  get versions(): readonly Version[] {
    return this.history;
  }

  /**
   * Send the person's message and let Claude look at and change the project
   * until it has an answer.
   *
   * @returns Claude's reply; or, if the message looks private and wasn't
   *   confirmed, a {@link PrivacyReminder} (nothing is sent to Claude).
   * @throws {ChatBusyError} If the previous message is still being handled.
   * @throws {ChatModelError} If Claude can't be reached. Changes made before the failure are kept as a version.
   */
  async send(message: string, options: SendOptions = {}): Promise<ChatReply | PrivacyReminder> {
    if (this.busy) throw new ChatBusyError();
    if (!options.confirmPrivate) {
      const found = findPrivateText(message);
      if (found.length > 0) return { kind: "privacy_reminder", reminder: privacyReminder(found), found };
    }

    this.busy = true;
    const signal = options.signal ?? new AbortController().signal;
    const startLength = this.messages.length;
    const turn: TurnState = { restoredFrom: undefined, wasUndo: false, offerDownload: false };
    this.folder.beginTurn();
    try {
      const note = this.pendingNote ? `(${this.pendingNote})\n\n` : "";
      this.messages.push({ role: "user", content: note + message });
      let { reply, stoppedEarly } = await this.loop(turn, signal, options.onText);
      this.pendingNote = null;

      // Check the changed project; if the checks find a problem, Claude gets one chance to fix it.
      let checks: CheckResult | null = null;
      if (this.checker && !stoppedEarly && (await this.folder.pendingChanges()).length > 0) {
        checks = await this.runChecks(signal);
        if (checks.status === "failed") {
          this.messages.push({ role: "user", content: checksFailedNote(checks.summary) });
          ({ reply, stoppedEarly } = await this.loop(turn, signal, options.onText));
          checks = (await this.folder.pendingChanges()).length > 0 ? await this.runChecks(signal) : null;
        }
      }

      const version = await this.commit(`You asked: ${label(message)}`, turn.restoredFrom, checks);
      if (version && turn.wasUndo && turn.restoredFrom !== undefined) this.undoVersions.add(version.number);
      const ready = turn.offerDownload ? { version: this.history[this.history.length - 1]!.number } : null;
      return { kind: "reply", reply, version, readyToDownload: ready, stoppedEarly };
    } catch (error) {
      // Leave the conversation as it was before this message, so the next one starts cleanly
      // (a half-finished exchange would end on an unanswered tool call). File changes are kept.
      this.messages.length = startLength;
      await this.commit(`You asked: ${label(message)} (not finished)`, undefined, null);
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Put the copy back as it was before the latest change (an undo button).
   * Recorded as a new version, so it can itself be undone.
   *
   * @returns The new version, or null if there was nothing to undo.
   */
  async undo(): Promise<Version | null> {
    if (this.busy) throw new ChatBusyError();
    const target = this.undoTarget();
    if (target === null) return null;
    const made = await this.restore(target, `Undid: ${this.history[this.history.length - 1]!.label}`);
    if (made) this.undoVersions.add(made.number);
    return made;
  }

  /**
   * Put the whole copy back as it was at `version`. Recorded as a new
   * version, so nothing is lost.
   *
   * @returns The new version, or null if the copy is already like that.
   * @throws {ProjectFileError} If there is no such version.
   */
  async restore(version: number, versionLabel = `Restored version ${version}`): Promise<Version | null> {
    if (this.busy) throw new ChatBusyError();
    this.busy = true;
    this.folder.beginTurn();
    try {
      await this.folder.restoreTo(version);
    } catch (error) {
      await this.folder.endTurn();
      this.busy = false;
      throw error;
    }
    try {
      const checks = this.checker && (await this.folder.pendingChanges()).length > 0 ? await this.runChecks(new AbortController().signal) : null;
      const made = await this.commit(versionLabel, version, checks);
      if (made) {
        const note = `I went back to version ${version} ("${this.history[version]!.label}"), so the files changed since then are as they were. Look at them again before changing them.`;
        this.pendingNote = this.pendingNote ? `${this.pendingNote} ${note}` : note;
      }
      return made;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Every file of the copy at `version` (default: the latest), e.g. to zip
   * up a draft for the person to download.
   */
  async filesAt(version = this.history.length - 1): Promise<Map<string, Buffer>> {
    return this.folder.filesAt(version);
  }

  /** The version "undo" goes back to, or null if there is nothing to undo. */
  private undoTarget(): number | null {
    const latest = this.history[this.history.length - 1]!;
    // Undo after undo keeps going back (like pressing undo twice); undo after anything else,
    // a restore included, goes back to just before it.
    const effective = this.undoVersions.has(latest.number) ? latest.restoredFrom! : latest.number;
    return effective === 0 ? null : effective - 1;
  }

  /** End the open turn; if it changed anything, record it as the next version. */
  private async commit(versionLabel: string, restoredFrom: number | undefined, checks: CheckResult | null): Promise<Version | null> {
    const changes = await this.folder.endTurn();
    if (changes.length === 0) return null;
    const version: Version = { number: this.folder.latestVersion, label: versionLabel, createdAt: new Date().toISOString(), changes, checks };
    if (restoredFrom !== undefined) version.restoredFrom = restoredFrom;
    this.history.push(version);
    return version;
  }

  private async runChecks(signal: AbortSignal): Promise<CheckResult> {
    return this.checker!.check(packFiles(await this.folder.filesAt(this.folder.latestVersion)), signal);
  }

  /** Carry out one of the session's own tools (versions, download). */
  private async runSessionTool(name: string, input: unknown, turn: TurnState): Promise<{ content: string; isError: boolean }> {
    const list = (): string =>
      this.history.map((v, i) => `Version ${v.number}: ${v.label}${i === this.history.length - 1 ? "  (current)" : ""}`).join("\n");
    if (name === "list_versions") return { content: list(), isError: false };
    if (name === "offer_download") {
      turn.offerDownload = true;
      return { content: "The download button will be shown for the newest version when you reply.", isError: false };
    }

    let target: number | null;
    if (name === "undo_last_change") {
      target = this.undoTarget();
      if (target === null) return { content: "There's nothing to undo: this is their copy as they got it.", isError: true };
      if ((await this.folder.pendingChanges()).length > 0) {
        return { content: "You've already changed files in this message. Use restore_version with the version to go back to.", isError: true };
      }
    } else {
      const version = (input as { version?: unknown } | null)?.version;
      if (typeof version !== "number" || !Number.isInteger(version) || version < 0 || version >= this.history.length) {
        return { content: `Error: "version" must be one of these:\n${list()}`, isError: true };
      }
      target = version;
    }
    await this.folder.restoreTo(target);
    turn.restoredFrom = target;
    turn.wasUndo = name === "undo_last_change";
    return { content: `The project is now as it was at version ${target} ("${this.history[target]!.label}").`, isError: false };
  }

  /** The tool-use loop for one message. */
  private async loop(turn: TurnState, signal: AbortSignal, onText?: (text: string) => void): Promise<{ reply: string; stoppedEarly: boolean }> {
    for (let step = 1; ; step++) {
      const lastStep = step >= this.maxSteps;
      const response = await this.model.next(
        { system: SYSTEM_PROMPT, tools: ALL_TOOLS, messages: this.messages, toolChoice: lastStep ? "none" : "auto" },
        signal,
        onText,
      );
      // Keep the whole reply, thinking included, so the next step continues from it.
      this.messages.push({ role: "assistant", content: response.content });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

      if (response.stop_reason === "refusal") {
        // A refused turn may hold a cut-off tool call; never run it, and drop it from the conversation.
        this.messages.pop();
        this.messages.push({ role: "assistant", content: text || "I can't help with that change." });
        return { reply: text || "I can't help with that change.", stoppedEarly: true };
      }
      if (toolUses.length === 0) {
        return { reply: text || "Done.", stoppedEarly: lastStep };
      }

      const results: Anthropic.ContentBlockParam[] = [];
      for (const call of toolUses) {
        let outcome: { content: string; isError: boolean };
        if (response.stop_reason === "max_tokens") {
          // A call cut off at the output limit can look complete; never run it.
          outcome = { content: CUT_OFF_TOOL_RESULT, isError: true };
        } else if (SESSION_TOOLS.some((t) => t.name === call.name)) {
          outcome = await this.runSessionTool(call.name, call.input, turn);
        } else {
          outcome = await runTool(call.name, call.input, this.folder);
          // A file change after a restore means this version is no longer just the restored one.
          if (!outcome.isError && !isLookOnly(call.input)) {
            turn.restoredFrom = undefined;
            turn.wasUndo = false;
          }
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.content, is_error: outcome.isError });
      }
      if (step + 1 >= this.maxSteps) results.push({ type: "text", text: LAST_STEP_NOTE });
      this.messages.push({ role: "user", content: results });
    }
  }
}

/** Whether an edit-tool input only looks (a `view`). */
function isLookOnly(input: unknown): boolean {
  return typeof input === "object" && input !== null && (input as { command?: unknown }).command === "view";
}

/** The person's message as a one-line version label. */
function label(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_LABEL_CHARS ? `${oneLine.slice(0, MAX_LABEL_CHARS - 1)}…` : oneLine;
}

/**
 * @file The Claude API call, behind the small {@link ClaudeClient} interface
 * so orchestration code can be tested with a fake and no network.
 *
 * The client only ASKS for a manifest; it does not validate one. Everything
 * it returns from the model is untrusted and typed `unknown` until a
 * validator checks it against `src/manifest/schema.json`.
 *
 * All prompt text comes from `prompts.ts`; this file only makes the call.
 */

// Official Anthropic TypeScript SDK: typed requests, typed API errors,
// built-in retry with backoff for 429/5xx/connection failures, and
// AbortSignal support. Required by the spec; nothing else would be better.
import Anthropic from "@anthropic-ai/sdk";
import type { Manifest } from "../manifest/schema.js";
// The runtime form of the same contract. The tool's input schema is derived
// from it so there is a single source of truth for what the model must return.
import manifestJsonSchema from "../manifest/schema.json" with { type: "json" };
import { ClaudeApiError } from "./errors.js";
import {
  buildAnalysisPrompt,
  buildSystemPrompt,
  SUBMIT_TOOL_DESCRIPTION,
  SUBMIT_TOOL_NAME,
  type AnalysisPromptExtras,
} from "./prompts.js";
import type { ProjectSummary } from "./types.js";

/**
 * What the model is asked to submit. Describes the request, not the
 * (untrusted) response; see {@link RawAnalysis}.
 *
 * Exactly one of `manifest` and `unsupported_reason` is set.
 */
export interface RequestedAnalysis {
  /**
   * The folder in the zip that is the project folder (where `simplyopen.json`
   * goes, and what every manifest path is relative to): `""` for the zip's
   * root, or e.g. `"image_resizer"` when the project was zipped as a folder.
   */
  project_folder: string;
  /** The v0 manifest, or null when the project doesn't fit v0. */
  manifest: Manifest | null;
  /** Why the project doesn't fit v0, in plain English, or null when `manifest` is set. */
  unsupported_reason: string | null;
  /** One short plain-English sentence per guess or doubt; empty when there are none. */
  notes: string[];
}

/**
 * What the model actually returned. Every field from the model is `unknown`
 * on purpose: the model is asked to follow the tool schema, but nothing
 * forces it to (strict mode is off by default), some contract rules can't be
 * expressed in a schema at all, and a reply can be cut off. Callers must
 * validate before trusting any of it.
 *
 * All four model fields are `undefined` when the model did not submit an
 * answer (for example, its reply hit the output-token limit). The caller
 * treats that like any other invalid answer, and retries.
 */
export type RawAnalysis = { [K in keyof RequestedAnalysis]: unknown } & {
  /** Serialized model reply (text and tool calls), for logging and debugging only. Never pass it downstream. */
  rawModelOutput: string;
};

/**
 * Anything that can analyze a project summary. Implement this with a fake
 * to test orchestration without calling Claude.
 */
export interface ClaudeClient {
  /**
   * Ask the model to analyze a project.
   *
   * @param summary The bounded view of the project (file tree, which files
   *   are shown in full, in part, or by name only, and their contents),
   *   already cut down to size by the caller.
   * @param signal Cancels the request (e.g. the HTTP client disconnected).
   *   Implementations must honour it.
   * @param extras Optional additions to the prompt: the list of omitted
   *   files when the summary is truncated, and, on the retry, the problems
   *   found in the previous answer. See {@link AnalysisPromptExtras}.
   * @returns The model's unvalidated answer.
   * @throws {ClaudeApiError} If the call fails, times out, is cancelled, or the model declines.
   */
  analyzeProject(summary: ProjectSummary, signal: AbortSignal, extras?: AnalysisPromptExtras): Promise<RawAnalysis>;
}

/** Options for {@link AnthropicClaudeClient}. All optional. */
export interface AnthropicClaudeClientOptions {
  /** Pre-built SDK client, e.g. to share a connection pool or inject a fake in tests. Otherwise one is created from the environment. */
  anthropic?: Anthropic;
  /** Model id. Default {@link DEFAULT_MODEL}. */
  model?: string;
  /** Reasoning effort. Default `"medium"`: careful enough to read code, quick enough for an upload flow. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Output token cap, including thinking. Default 16,000 (a manifest is small). */
  maxTokens?: number;
  /** Time limit for one call, in milliseconds, including the SDK's own retries. Default {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Use strict tool use (`strict: true`), which makes the API constrain the
   * answer to the tool schema. Default `false`: the larger 1.0 manifest made
   * the API reject strict mode ("The compiled grammar is too large"), and it
   * hasn't been tried with v0 yet. The answer is validated against
   * `schema.json` and the contract rules, with one retry, either way; strict
   * mode only makes a well-formed first attempt more likely.
   */
  strictTool?: boolean;
}

/** Default model: the current Claude Opus. */
export const DEFAULT_MODEL = "claude-opus-5-5";

/** Default time limit for one call, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * {@link ClaudeClient} backed by the Anthropic Messages API.
 *
 * - One tool whose input schema is the manifest schema, with
 *   `tool_choice: auto` because current models reject forced tool choice;
 *   the prompt requires exactly one call. Strict tool use is off by default
 *   (see {@link AnthropicClaudeClientOptions.strictTool}); correctness comes
 *   from the caller's validation and retry.
 * - Adaptive thinking at the configured effort.
 * - Server-side refusal fallback (`fallbacks: "default"`): if the model
 *   declines on policy grounds, the API retries on a fallback model in the
 *   same call.
 * - A per-call time limit combined with the caller's signal.
 *
 * Holds only configuration and the SDK client, so one instance can serve
 * many concurrent requests.
 */
export class AnthropicClaudeClient implements ClaudeClient {
  private readonly anthropic: Anthropic;
  private readonly model: string;
  private readonly effort: NonNullable<AnthropicClaudeClientOptions["effort"]>;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly strictTool: boolean;
  private readonly toolInputSchema = buildSubmitToolInputSchema();

  /**
   * @param options See {@link AnthropicClaudeClientOptions}. Credentials are
   *   resolved by the SDK (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an
   *   `ant auth login` profile).
   */
  constructor(options: AnthropicClaudeClientOptions = {}) {
    this.anthropic = options.anthropic ?? new Anthropic({ maxRetries: 2 });
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort ?? "medium";
    this.maxTokens = options.maxTokens ?? 16_000;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.strictTool = options.strictTool ?? false;
  }

  /** {@inheritDoc ClaudeClient.analyzeProject} */
  async analyzeProject(summary: ProjectSummary, signal: AbortSignal, extras: AnalysisPromptExtras = {}): Promise<RawAnalysis> {
    if (signal.aborted) {
      throw new ClaudeApiError("The analysis was cancelled before it started", { cause: signal.reason });
    }
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);

    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.anthropic.beta.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: this.effort },
          system: [{ type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
          tools: [
            {
              name: SUBMIT_TOOL_NAME,
              description: SUBMIT_TOOL_DESCRIPTION,
              strict: this.strictTool,
              input_schema: this.toolInputSchema,
            },
          ],
          tool_choice: { type: "auto", disable_parallel_tool_use: true },
          messages: [{ role: "user", content: buildAnalysisPrompt(summary, extras) }],
        },
        { signal: combined },
      );
    } catch (error) {
      throw toClaudeApiError(error, { callerAborted: signal.aborted, timedOut: timeout.aborted, timeoutMs: this.timeoutMs });
    }

    const rawModelOutput = JSON.stringify(
      response.content.filter((block) => block.type === "text" || block.type === "tool_use"),
    );

    if (response.stop_reason === "refusal") {
      throw new ClaudeApiError("The model declined to analyze this project");
    }

    const call = response.content.find(
      (block): block is Anthropic.Beta.Messages.BetaToolUseBlock =>
        block.type === "tool_use" && block.name === SUBMIT_TOOL_NAME,
    );
    // A reply cut off at the token limit may hold a partial tool call; never use it.
    if (!call || response.stop_reason === "max_tokens") {
      return { project_folder: undefined, manifest: undefined, unsupported_reason: undefined, notes: undefined, rawModelOutput };
    }

    // The SDK parses tool input into an object; read fields without trusting them.
    const input: unknown = call.input;
    const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
    return {
      project_folder: record.project_folder,
      manifest: record.manifest,
      unsupported_reason: record.unsupported_reason,
      notes: record.notes,
      rawModelOutput,
    };
  }
}

/** Map anything the SDK throws into a {@link ClaudeApiError}, keeping the original as `cause`. */
function toClaudeApiError(
  error: unknown,
  context: { callerAborted: boolean; timedOut: boolean; timeoutMs: number },
): ClaudeApiError {
  if (context.callerAborted) {
    return new ClaudeApiError("The analysis was cancelled", { cause: error });
  }
  if (context.timedOut || error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ClaudeApiError(`The Claude API did not answer within ${context.timeoutMs} ms`, { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ClaudeApiError("Could not reach the Claude API", { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    // The SDK's message already starts with the HTTP status, e.g. "500 overloaded".
    return new ClaudeApiError(`The Claude API returned an error: ${error.message}`, { cause: error });
  }
  return new ClaudeApiError("Unexpected error while calling the Claude API", { cause: error });
}

/** JSON value, used while transforming the schema. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * JSON Schema keywords that strict tool use does not accept. They are
 * removed from the copy sent to the model; the full schema is still
 * enforced when the answer is validated, so removing them only loosens the
 * model-side guide and never lets an invalid manifest through.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema", "$id", "title",
  "if", "then", "else", "not",
  "pattern", "minLength", "maxLength", "minItems", "maxItems",
]);

/**
 * Build the submit tool's input schema,
 * `{ project_folder, manifest, unsupported_reason, notes }`, with `manifest`
 * derived from `src/manifest/schema.json` and adapted to what strict tool use
 * supports.
 *
 * @returns A new schema object on every call (safe for the caller to mutate).
 */
export function buildSubmitToolInputSchema(): Anthropic.Beta.Messages.BetaTool.InputSchema {
  const source = manifestJsonSchema as unknown as { [key: string]: Json };
  return {
    type: "object",
    additionalProperties: false,
    required: ["project_folder", "manifest", "unsupported_reason", "notes"],
    properties: {
      project_folder: {
        type: "string",
        description: 'The folder in the zip that holds the project, relative to the zip root: "" for the root itself.',
      },
      manifest: {
        description: "The SimplyOpen manifest, or null if the project doesn't fit it.",
        anyOf: [toStrictSchema(source), { type: "null" }],
      },
      unsupported_reason: {
        description: "Why the project doesn't fit the manifest, in plain English, or null when a manifest is given.",
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      notes: {
        type: "array",
        items: { type: "string" },
        description: "One short plain-English sentence per guess or doubt; empty if none.",
      },
    },
  };
}

/**
 * Recursively adapt a schema node for strict tool use: drop unsupported
 * keywords and turn `type: [a, b]` into `anyOf`.
 */
function toStrictSchema(node: Json): Json {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (node === null || typeof node !== "object") return node;

  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === "properties" && value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Property NAMES are never keywords, so only their schemas are adapted.
      const props: { [key: string]: Json } = {};
      for (const [prop, propSchema] of Object.entries(value)) props[prop] = toStrictSchema(propSchema);
      out[key] = props;
    } else {
      out[key] = toStrictSchema(value);
    }
  }

  if (Array.isArray(out.type)) {
    const { type, description, ...rest } = out;
    const variants: Json[] = (type as Json[]).map((t) => (t === "null" ? { type: "null" } : { type: t, ...rest }));
    return description === undefined ? { anyOf: variants } : { description, anyOf: variants };
  }
  return out;
}

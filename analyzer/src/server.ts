/**
 * @file HTTP entry point for the Analyzer: `POST /analyze`.
 *
 * HTTP plumbing only: receive one zip upload, save it to a request-scoped
 * temp file, call `analyzeZip`, and turn the outcome into a JSON response.
 * No analysis logic lives here.
 *
 * Request: `multipart/form-data` with the zip in a file field named `file`.
 *
 * Responses:
 * - `200` `{ manifest, name, description, status }`. The analyzer's `rawModelOutput`
 *   is written to the server log and never sent to the client: it is for
 *   debugging only and must not reach downstream consumers.
 * - Errors: `{ error: { code, message } }` with
 *   - `400` no file in the upload, or more than one file,
 *   - `413` upload over the size limit,
 *   - `415` not a multipart request,
 *   - `422` `UnzipError` / `SchemaValidationError` (the upload can't be analyzed),
 *   - `502` `AnalysisFailedError` / `ClaudeApiError` (the model, an upstream
 *     dependency, failed or answered badly),
 *   - `500` anything else.
 *
 * Configuration (environment variables): `PORT` (default 3000), `HOST`
 * (default 127.0.0.1; use 0.0.0.0 inside a container), `MAX_UPLOAD_BYTES`
 * (default 50 MiB).
 */

// Fastify rather than Express: async handlers are first-class (a rejected
// promise becomes an error response without extra wrappers), it ships a
// per-request structured logger, and its official multipart plugin streams
// uploads straight to disk with built-in size limits. Express would need
// multer plus an async-error wrapper to match.
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
// @fastify/multipart: the official Fastify multipart parser (busboy-based);
// streams the upload instead of buffering it and enforces size/part limits.
import multipart from "@fastify/multipart";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { analyzeZip, type AnalysisResult } from "./analyzer/analyzer.js";
import { AnalysisFailedError, AnalyzerError, ClaudeApiError, SchemaValidationError, UnzipError } from "./analyzer/errors.js";

/** Default upload size limit: 50 MiB. */
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** What `POST /analyze` returns on success: the analysis without the debug-only raw model output. */
export type AnalyzeResponse = Omit<AnalysisResult, "rawModelOutput">;

/** Options for {@link buildServer}. */
export interface ServerOptions {
  /** Largest accepted upload, in bytes. Default {@link DEFAULT_MAX_UPLOAD_BYTES}. */
  maxUploadBytes?: number;
  /** Fastify logger setting. Default `true`. */
  logger?: boolean;
  /**
   * Function that analyzes a saved zip. Defaults to `analyzeZip` with its
   * default Claude client; tests can inject a fake to exercise the HTTP layer alone.
   */
  analyze?: (zipPath: string, signal: AbortSignal) => Promise<AnalysisResult>;
}

/**
 * Build (but do not start) the HTTP server.
 *
 * @param options See {@link ServerOptions}.
 * @returns A Fastify instance with `POST /analyze` registered. Call `.listen()` to serve.
 */
export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const analyze = options.analyze ?? ((zipPath, signal) => analyzeZip(zipPath, undefined, { signal }));

  const app = Fastify({ logger: options.logger ?? true });
  await app.register(multipart, {
    limits: { fileSize: maxUploadBytes, files: 1, fields: 10, fieldSize: 1024, parts: 11 },
  });

  app.post("/analyze", async (request, reply) => {
    if (!request.isMultipart()) {
      return send(reply, errorOutcome(415, "UNSUPPORTED_MEDIA_TYPE", 'Send the zip as multipart/form-data in a field named "file".'));
    }

    // Cancel the analysis if the client goes away before we answer.
    const aborter = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) aborter.abort();
    });

    // The temp upload is deleted BEFORE the response is sent, so no request
    // ever leaves a file behind, even if the process stops right after.
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), "simplyopen-upload-"));
    let outcome: Outcome;
    try {
      const zipPath = await saveSingleZip(request, uploadDir);
      if (typeof zipPath !== "string") {
        outcome = zipPath;
      } else {
        const result = await analyze(zipPath, aborter.signal);
        request.log.info({ rawModelOutput: result.rawModelOutput }, "analysis complete");
        const body: AnalyzeResponse = { manifest: result.manifest, name: result.name, description: result.description, status: result.status };
        outcome = { status: 200, body };
      }
    } catch (error) {
      outcome = failureOutcome(request.log, error, maxUploadBytes);
    } finally {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
    }
    return send(reply, outcome);
  });

  /**
   * Stream the single file part named "file" to `<uploadDir>/upload.zip`.
   * Other form fields are ignored. Returns the saved path, or an error
   * outcome if there was no file or it was over the limit. A second file
   * makes the multipart plugin throw `FST_FILES_LIMIT`.
   */
  async function saveSingleZip(request: FastifyRequest, uploadDir: string): Promise<string | Outcome> {
    let zipPath: string | undefined;
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      if (part.fieldname !== "file") {
        part.file.resume(); // drain and ignore a file sent under another name
        continue;
      }
      zipPath = path.join(uploadDir, "upload.zip");
      await pipeline(part.file, createWriteStream(zipPath));
      if (part.file.truncated) return errorOutcome(413, "UPLOAD_TOO_LARGE", `The upload is larger than ${maxUploadBytes} bytes.`);
    }
    return zipPath ?? errorOutcome(400, "NO_FILE", 'No file was uploaded. Send the zip in a field named "file".');
  }

  return app;
}

/** A response to send: status plus JSON body. */
interface Outcome {
  status: number;
  body: unknown;
}

function errorOutcome(status: number, code: string, message: string): Outcome {
  return { status, body: { error: { code, message } } };
}

function send(reply: FastifyReply, outcome: Outcome): FastifyReply {
  return reply.code(outcome.status).send(outcome.body);
}

/** Map a thrown value to an HTTP status and a safe JSON body. */
function failureOutcome(log: FastifyInstance["log"], error: unknown, maxUploadBytes: number): Outcome {
  // Upload-size and form errors raised by the multipart plugin.
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "FST_REQ_FILE_TOO_LARGE") {
    return errorOutcome(413, "UPLOAD_TOO_LARGE", `The upload is larger than ${maxUploadBytes} bytes.`);
  }
  if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT" || code === "FST_FIELDS_LIMIT") {
    return errorOutcome(400, "TOO_MANY_PARTS", "Send exactly one zip file (in a field named \"file\").");
  }

  if (error instanceof AnalyzerError) {
    log.warn({ err: error }, "analysis failed");
    return errorOutcome(statusFor(error), error.name, error.message);
  }
  log.error({ err: error }, "unexpected error");
  return errorOutcome(500, "INTERNAL_ERROR", "Something went wrong while analyzing the upload.");
}

/** HTTP status for each Analyzer error type. */
function statusFor(error: AnalyzerError): number {
  if (error instanceof UnzipError || error instanceof SchemaValidationError) return 422;
  if (error instanceof AnalysisFailedError || error instanceof ClaudeApiError) return 502;
  return 500;
}

/** Start listening when this file is run directly (`npm run dev` / `npm start`), not when imported. */
async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const maxUploadBytes = process.env.MAX_UPLOAD_BYTES ? Number(process.env.MAX_UPLOAD_BYTES) : undefined;
  const app = await buildServer({ maxUploadBytes });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void app.close().then(() => process.exit(0)));
  }
  await app.listen({ port, host });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

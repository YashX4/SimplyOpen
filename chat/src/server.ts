/**
 * @file HTTP service for the chat, so any app (the Runner, the website) can
 * offer it without holding a Claude API key or knowing how the chat works.
 *
 * A session is one person's private copy of an uploaded project plus one
 * conversation about it ("Make my copy"):
 *
 * - `POST   /sessions`                          upload the project zip (multipart field "file")
 *                                                → 201 `{ sessionId, files, version }` (version 0, "Your copy")
 * - `POST   /sessions/:id/messages`             JSON `{ message, confirmPrivate? }`
 *                                                → 200 a reply `{ kind: "reply", reply, version, readyToDownload, stoppedEarly }`
 *                                                  or a reminder `{ kind: "privacy_reminder", reminder, found }` (nothing was sent)
 * - `GET    /sessions/:id/versions`             → 200 `{ versions }`, oldest first; the last is current
 * - `POST   /sessions/:id/versions/:n/restore`  → 200 `{ version }` (the new version; null if nothing changed)
 * - `POST   /sessions/:id/undo`                 → 200 `{ version }` (the new version; null if nothing to undo)
 * - `GET    /sessions/:id/files`                → 200 `{ files }`
 * - `GET    /sessions/:id/project.zip?version=n` → the project at version n (default: the latest), as a zip
 * - `DELETE /sessions/:id`                      → 204, and the copy's files are deleted
 *
 * The chat only ever sees the project's code and the messages: there is no
 * way to send it anything else (such as what happened when the program ran).
 *
 * Errors: `{ error: { code, message } }` with 400 (bad request), 404 (no such
 * session), 409 (still answering the previous message), 413 (upload too
 * large), 415 (not multipart), 422 (zip can't be unpacked), 429 (too many
 * sessions), 502 (Claude failed), 500 (anything else).
 *
 * Sessions live in memory and are deleted after `SESSION_IDLE_MINUTES`
 * without use. Configuration (environment): `PORT` (default 3100), `HOST`
 * (default 127.0.0.1), `MAX_UPLOAD_BYTES` (default 50 MiB), `MAX_SESSIONS`
 * (default 20), `SESSION_IDLE_MINUTES` (default 60), `CHECK_URL` (where to
 * send each changed version for the automatic checks, e.g. the Analyzer's
 * `http://127.0.0.1:3000/analyze`; no checks run without it), `HISTORY_URL`
 * (where SimplyOpen History runs, e.g. `http://127.0.0.1:3200`; each chat
 * then gets a History project, and every change the person asks for, and
 * every undo or go-back, becomes a version there, returned as `history`).
 */

import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ChatBusyError, ChatModelError, ChatSession, HttpProjectChecker, ProjectFileError, ProjectFolder, type ChatSessionOptions } from "./chat.js";
import { HistoryClient } from "./historyClient.js";
import { packFiles, unpackZip, ZipError } from "./zip.js";

/** Longest message accepted from a person, in characters. */
export const MAX_MESSAGE_CHARS = 4_000;

/** Options for {@link buildServer}. */
export interface ChatServerOptions {
  /** Largest accepted upload, in bytes. Default 50 MiB. */
  maxUploadBytes?: number;
  /** Most sessions open at once. Default 20. */
  maxSessions?: number;
  /** Delete a session after this long without use, in milliseconds. Default one hour. */
  idleMs?: number;
  /** Fastify logger setting. Default `true`. */
  logger?: boolean;
  /** Options for every new {@link ChatSession} (e.g. a fake model in tests, or a checker). */
  session?: ChatSessionOptions;
  /** Paths the chat may not change in uploaded projects. Default {@link DEFAULT_PROTECTED_PATHS} from projectFolder.ts. */
  protectedPaths?: readonly string[];
  /**
   * Where SimplyOpen History runs (e.g. "http://127.0.0.1:3200"). When set,
   * each chat gets a History project, and every change the person asks for
   * (and every undo or go-back) becomes a version there.
   */
  historyUrl?: string;
}

interface OpenSession {
  chat: ChatSession;
  cleanup: () => Promise<void>;
  lastUsed: number;
  /** The chat's History project, if History is set up and was reachable when the chat started. */
  historyProjectId?: string;
}

/**
 * Build (but do not start) the chat server.
 *
 * @returns A Fastify instance. Closing it deletes every session's files.
 */
export async function buildServer(options: ChatServerOptions = {}): Promise<FastifyInstance> {
  const maxUploadBytes = options.maxUploadBytes ?? 50 * 1024 * 1024;
  const maxSessions = options.maxSessions ?? 20;
  const idleMs = options.idleMs ?? 60 * 60 * 1000;
  const sessions = new Map<string, OpenSession>();
  const history = options.historyUrl ? new HistoryClient(options.historyUrl) : null;

  /**
   * Record the chat's current code as a new History version. Returns what
   * goes in the response under "history": the new version, or an error
   * note. History being down never stops the chat.
   */
  const record = async (open: OpenSession, request: string, log: FastifyInstance["log"]): Promise<{ version: unknown } | { error: string } | undefined> => {
    if (!history) return undefined;
    if (!open.historyProjectId) return { error: "History wasn't reachable when this chat started, so changes aren't being saved there." };
    try {
      return { version: await history.addVersion(open.historyProjectId, packFiles(await open.chat.filesAt()), request) };
    } catch (error) {
      log.warn({ err: error }, "saving to History failed");
      return { error: "This change couldn't be saved to the version history." };
    }
  };

  const app = Fastify({ logger: options.logger ?? true });
  await app.register(multipart, { limits: { fileSize: maxUploadBytes, files: 1, fields: 10, fieldSize: 1024, parts: 11 } });

  const close = async (id: string): Promise<void> => {
    const open = sessions.get(id);
    if (!open) return;
    sessions.delete(id);
    await open.cleanup();
  };
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, open] of sessions) if (now - open.lastUsed > idleMs) void close(id);
  }, Math.min(idleMs, 60_000));
  sweep.unref();
  app.addHook("onClose", async () => {
    clearInterval(sweep);
    await Promise.all([...sessions.keys()].map(close));
  });

  /** The session for a request, or a 404 already sent. */
  const find = (id: string, reply: FastifyReply): OpenSession | null => {
    const open = sessions.get(id);
    if (!open) {
      void send(reply, 404, "NO_SUCH_SESSION", "There is no chat with that id (it may have expired).");
      return null;
    }
    open.lastUsed = Date.now();
    return open;
  };

  app.post("/sessions", async (request, reply) => {
    if (!request.isMultipart()) return send(reply, 415, "UNSUPPORTED_MEDIA_TYPE", 'Send the project zip as multipart/form-data in a field named "file".');
    if (sessions.size >= maxSessions) return send(reply, 429, "TOO_MANY_SESSIONS", "Too many chats are open. Try again later.");

    let zip: Buffer | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type !== "file") continue;
        if (part.fieldname !== "file") {
          part.file.resume();
          continue;
        }
        zip = await part.toBuffer();
      }
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE") return send(reply, 413, "UPLOAD_TOO_LARGE", `The upload is larger than ${maxUploadBytes} bytes.`);
      if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT" || code === "FST_FIELDS_LIMIT") return send(reply, 400, "TOO_MANY_PARTS", 'Send exactly one zip file, in a field named "file".');
      throw error;
    }
    if (!zip) return send(reply, 400, "NO_FILE", 'No file was uploaded. Send the zip in a field named "file".');

    let unpacked;
    try {
      unpacked = await unpackZip(zip);
    } catch (error) {
      if (error instanceof ZipError) return send(reply, 422, "BAD_ZIP", error.message);
      throw error;
    }
    try {
      const folder = await ProjectFolder.open(unpacked.dir, options.protectedPaths ? { protectedPaths: options.protectedPaths } : {});
      const sessionId = randomUUID();
      const chat = new ChatSession(folder, options.session);
      const open: OpenSession = { chat, cleanup: unpacked.cleanup, lastUsed: Date.now() };
      if (history) {
        try {
          open.historyProjectId = await history.createProject(zip);
        } catch (error) {
          request.log.warn({ err: error }, "starting a History project failed");
        }
      }
      sessions.set(sessionId, open);
      return reply.code(201).send({ sessionId, files: await folder.listFiles(), version: chat.versions[0], ...(history ? { historyProjectId: open.historyProjectId ?? null } : {}) });
    } catch (error) {
      await unpacked.cleanup();
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/sessions/:id/messages", async (request, reply) => {
    const open = find(request.params.id, reply);
    if (!open) return reply;
    const body = request.body as Record<string, unknown> | null;
    const message = body?.message;
    const confirmPrivate = body?.confirmPrivate;
    if (typeof message !== "string" || message.trim() === "") return send(reply, 400, "NO_MESSAGE", 'Send JSON with a non-empty "message".');
    if (message.length > MAX_MESSAGE_CHARS) return send(reply, 400, "MESSAGE_TOO_LONG", `"message" must be at most ${MAX_MESSAGE_CHARS} characters.`);
    if (confirmPrivate !== undefined && typeof confirmPrivate !== "boolean") return send(reply, 400, "BAD_CONFIRM", '"confirmPrivate" must be true or false.');
    const unknown = Object.keys(body ?? {}).filter((k) => k !== "message" && k !== "confirmPrivate");
    if (unknown.length > 0) {
      // Refused rather than ignored: the chat may only see the project's code and the messages.
      return send(reply, 400, "UNKNOWN_FIELDS", `Only "message" and "confirmPrivate" can be sent (not ${unknown.map((k) => `"${k}"`).join(", ")}).`);
    }

    // Stop working if the caller goes away.
    const aborter = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) aborter.abort();
    });
    try {
      const result = await open.chat.send(message, { confirmPrivate: confirmPrivate === true, signal: aborter.signal });
      open.lastUsed = Date.now();
      // Every request that changed something becomes a History version, described from the person's words.
      const saved = result.kind === "reply" && result.version ? await record(open, message, request.log) : undefined;
      return reply.send(saved ? { ...result, history: saved } : result);
    } catch (error) {
      if (error instanceof ChatBusyError) return send(reply, 409, "BUSY", "Still working on the previous message.");
      if (error instanceof ChatModelError) {
        request.log.warn({ err: error }, "chat model call failed");
        return send(reply, 502, "MODEL_FAILED", error.message);
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/versions", async (request, reply) => {
    const open = find(request.params.id, reply);
    if (!open) return reply;
    return reply.send({ versions: open.chat.versions });
  });

  app.post<{ Params: { id: string; n: string } }>("/sessions/:id/versions/:n/restore", async (request, reply) => {
    const open = find(request.params.id, reply);
    if (!open) return reply;
    const n = parseVersion(request.params.n, open.chat);
    if (n === null) return send(reply, 404, "NO_SUCH_VERSION", "There is no version with that number.");
    try {
      const version = await open.chat.restore(n);
      const saved = version ? await record(open, version.label, request.log) : undefined;
      return reply.send({ version, ...(saved ? { history: saved } : {}) });
    } catch (error) {
      if (error instanceof ChatBusyError) return send(reply, 409, "BUSY", "Still working on the previous message.");
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/undo", async (request, reply) => {
    const open = find(request.params.id, reply);
    if (!open) return reply;
    try {
      const version = await open.chat.undo();
      const saved = version ? await record(open, version.label, request.log) : undefined;
      return reply.send({ version, ...(saved ? { history: saved } : {}) });
    } catch (error) {
      if (error instanceof ChatBusyError) return send(reply, 409, "BUSY", "Still working on the previous message.");
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/files", async (request, reply) => {
    const open = find(request.params.id, reply);
    if (!open) return reply;
    return reply.send({ files: await open.chat.folder.listFiles() });
  });

  app.get<{ Params: { id: string }; Querystring: { version?: string } }>("/sessions/:id/project.zip", async (request, reply) => {
    const open = find(request.params.id, reply);
    if (!open) return reply;
    const latest = open.chat.versions.length - 1;
    const n = request.query.version === undefined ? latest : parseVersion(request.query.version, open.chat);
    if (n === null) return send(reply, 404, "NO_SUCH_VERSION", "There is no version with that number.");
    try {
      const zip = packFiles(await open.chat.filesAt(n));
      return reply.type("application/zip").header("content-disposition", `attachment; filename="project-v${n}.zip"`).send(Buffer.from(zip));
    } catch (error) {
      if (error instanceof ProjectFileError) return send(reply, 404, "NO_SUCH_VERSION", error.message);
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    if (!sessions.has(request.params.id)) return send(reply, 404, "NO_SUCH_SESSION", "There is no chat with that id (it may have expired).");
    await close(request.params.id);
    return reply.code(204).send();
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "unexpected error");
    void send(reply, 500, "INTERNAL_ERROR", "Something went wrong.");
  });

  return app;
}

/** A version number from a URL, or null if it isn't one of the session's versions. */
function parseVersion(text: string, chat: ChatSession): number | null {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n < chat.versions.length ? n : null;
}

function send(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  return reply.code(status).send({ error: { code, message } });
}

/** Start listening when run directly (`npm run dev` / `npm start`). */
async function main(): Promise<void> {
  const env = process.env;
  const app = await buildServer({
    maxUploadBytes: env.MAX_UPLOAD_BYTES ? Number(env.MAX_UPLOAD_BYTES) : undefined,
    maxSessions: env.MAX_SESSIONS ? Number(env.MAX_SESSIONS) : undefined,
    idleMs: env.SESSION_IDLE_MINUTES ? Number(env.SESSION_IDLE_MINUTES) * 60_000 : undefined,
    session: env.CHECK_URL ? { checker: new HttpProjectChecker(env.CHECK_URL) } : {},
    historyUrl: env.HISTORY_URL,
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close().then(() => process.exit(0)));
  await app.listen({ port: Number(env.PORT ?? 3100), host: env.HOST ?? "127.0.0.1" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

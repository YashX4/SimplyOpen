/**
 * @file HTTP API for version history. Backend only.
 *
 * - `POST /api/projects`                          zip in field "file" → 201 `{ id, version }`
 * - `POST /api/projects/:id/versions`             zip in field "file", optional field "request" → 201 the new version
 * - `GET  /api/projects/:id/versions`             → `{ versions }`, newest first, each `{ number, description, date, isCurrent }`
 * - `GET  /api/projects/:id/versions/:n/download` → that version's zip ("Get this one")
 * - `GET  /api/projects/:id/versions/:n/diff`     → `{ files }`: what version n changed (add `?from=m` to compare with version m)
 *
 * Errors are `{ error: { message } }` with 400, 404 or 413.
 * Environment: `PORT` (default 3200), `HOST` (default 127.0.0.1), `DATA_DIR`
 * (default ./data). With `ANTHROPIC_API_KEY` set, Claude writes descriptions.
 */

import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { pathToFileURL } from "node:url";
import { claudeDescribe } from "./describe.js";
import { StoreError, VersionStore } from "./store.js";

type WithId = { Params: { id: string } };
type WithVersion = { Params: { id: string; n: string }; Querystring: { from?: string } };

/** Build (but don't start) the server. */
export async function buildServer(store: VersionStore, maxUploadBytes = 50 * 1024 * 1024): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: maxUploadBytes, files: 1 } });

  app.post("/api/projects", async (request, reply) => reply.code(201).send(await store.createProject((await upload(request)).zip)));

  app.post<WithId>("/api/projects/:id/versions", async (request, reply) => {
    const { zip, request: asked } = await upload(request);
    return reply.code(201).send(await store.addVersion(request.params.id, zip, asked));
  });

  app.get<WithId>("/api/projects/:id/versions", async (request) => ({ versions: await store.listVersions(request.params.id) }));

  app.get<WithVersion>("/api/projects/:id/versions/:n/download", async (request, reply) => {
    const zip = await store.getZip(request.params.id, Number(request.params.n));
    return reply.type("application/zip").header("content-disposition", `attachment; filename="version-${Number(request.params.n)}.zip"`).send(Buffer.from(zip));
  });

  app.get<WithVersion>("/api/projects/:id/versions/:n/diff", async (request) => {
    const n = Number(request.params.n);
    return { files: await store.diff(request.params.id, n, request.query.from === undefined ? n - 1 : Number(request.query.from)) };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof StoreError) return reply.code(error.status).send({ error: { message: error.message } });
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: { message: "The upload is too large." } });
    return reply.code(400).send({ error: { message: "The request couldn't be read." } });
  });
  return app;
}

/** The uploaded zip (field "file") and the optional "request" text field. */
async function upload(request: FastifyRequest): Promise<{ zip: Uint8Array; request?: string }> {
  if (!request.isMultipart()) throw new StoreError('Send the zip as multipart/form-data in a field named "file".', 400);
  let zip: Uint8Array | undefined;
  let asked: string | undefined;
  for await (const part of request.parts()) {
    if (part.type === "file" && part.fieldname === "file") zip = await part.toBuffer();
    else if (part.type === "file") part.file.resume();
    else if (part.fieldname === "request" && typeof part.value === "string") asked = part.value;
  }
  if (!zip) throw new StoreError('No file was uploaded. Send the zip in a field named "file".', 400);
  return { zip, ...(asked ? { request: asked } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new VersionStore(process.env.DATA_DIR ?? "data", process.env.ANTHROPIC_API_KEY ? claudeDescribe() : undefined);
  const app = await buildServer(store);
  await app.listen({ port: Number(process.env.PORT ?? 3200), host: process.env.HOST ?? "127.0.0.1" });
}

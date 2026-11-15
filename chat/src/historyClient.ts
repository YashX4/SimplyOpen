/**
 * @file Records chat changes in SimplyOpen History (the `history/` service),
 * so every change the person asks for becomes a version there: a new
 * project when a chat starts, then one version per request that changed
 * something (and per undo or go-back).
 *
 * Talks to History only over HTTP, so the chat doesn't depend on its code.
 */

/** A History service at `baseUrl`, e.g. "http://127.0.0.1:3200". */
export class HistoryClient {
  constructor(
    private readonly baseUrl: string,
    /** Time limit per call; saving a version waits for Claude to describe it. */
    private readonly timeoutMs = 60_000,
  ) {}

  /** Start a History project from the uploaded zip (its version 1). @returns The project's id. */
  async createProject(zip: Uint8Array): Promise<string> {
    const body = (await this.post("/api/projects", zip)) as { id?: unknown };
    if (typeof body.id !== "string") throw new Error("History didn't return a project id");
    return body.id;
  }

  /** Save the project's code as History's next version. @param request What the person asked for. */
  async addVersion(projectId: string, zip: Uint8Array, request: string): Promise<unknown> {
    return this.post(`/api/projects/${encodeURIComponent(projectId)}/versions`, zip, request);
  }

  private async post(path: string, zip: Uint8Array, request?: string): Promise<unknown> {
    const form = new FormData();
    if (request) form.append("request", request);
    form.append("file", new Blob([zip], { type: "application/zip" }), "project.zip");
    const response = await fetch(new URL(path, this.baseUrl), { method: "POST", body: form, signal: AbortSignal.timeout(this.timeoutMs) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`History answered ${response.status}`);
    return body;
  }
}

/** Tests for the version store and its HTTP API (Claude replaced by a fake). */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { timestamp, VersionStore } from "./store.js";

const root = await mkdtemp(path.join(os.tmpdir(), "history-test-"));
afterAll(() => rm(root, { recursive: true, force: true }));

const zip = (files: Record<string, string>): Uint8Array => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)])));
const newStore = async (describe?: ConstructorParameters<typeof VersionStore>[1]) => new VersionStore(await mkdtemp(path.join(root, "data-")), describe);

describe("VersionStore", () => {
  it("stores each version's code, description and date; the newest is current", async () => {
    const asked: (string | undefined)[] = [];
    const store = await newStore(async (_changes, request) => {
      asked.push(request);
      return "Keeps the speaker names when you ask it to.";
    });
    const { id, version } = await store.createProject(zip({ "app.py": "a\n" }));
    expect(version).toEqual({ number: 1, description: "First version.", date: expect.stringMatching(/^\d\d\/\d\d\/\d\d \d{1,2}:\d\d (AM|PM)$/) });

    await store.addVersion(id, zip({ "app.py": "b\n" }), "keep the speaker names");
    expect(asked).toEqual(["keep the speaker names"]);
    expect(await store.listVersions(id)).toEqual([
      { number: 2, description: "Keeps the speaker names when you ask it to.", date: expect.any(String), isCurrent: true },
      { number: 1, description: "First version.", date: expect.any(String), isCurrent: false },
    ]);
    // Getting an old version gives its code and changes nothing.
    expect(new TextDecoder().decode(unzipSync(await store.getZip(id, 1))["app.py"])).toBe("a\n");
    expect((await store.listVersions(id))[0]!.isCurrent).toBe(true);
  });

  it("times are mm/dd/yy with hours and minutes", () => {
    expect(timestamp(new Date(2026, 10, 4, 15, 7))).toBe("11/04/26 3:07 PM");
    expect(timestamp(new Date(2026, 0, 31, 0, 30))).toBe("01/31/26 12:30 AM");
    expect(timestamp(new Date(2026, 6, 1, 12, 0))).toBe("07/01/26 12:00 PM");
  });

  it("shows what each version changed, or between any two", async () => {
    const store = await newStore();
    const { id } = await store.createProject(zip({ "app.py": "one\ntwo\n", "old.txt": "x" }));
    await store.addVersion(id, zip({ "app.py": "one\nTWO\n", "new.txt": "y" }));
    expect(await store.diff(id, 2)).toEqual([
      { path: "app.py", change: "changed", lines: [{ type: "same", text: "one" }, { type: "removed", text: "two" }, { type: "added", text: "TWO" }] },
      { path: "new.txt", change: "added", lines: [{ type: "added", text: "y" }] },
      { path: "old.txt", change: "removed", lines: [{ type: "removed", text: "x" }] },
    ]);
    expect((await store.diff(id, 1)).map((f) => f.change)).toEqual(["added", "added"]); // version 1: everything is new
    expect((await store.diff(id, 1, 2)).map((f) => [f.path, f.change])).toEqual([["app.py", "changed"], ["new.txt", "removed"], ["old.txt", "added"]]);
  });

  it("falls back to a plain description when Claude fails", async () => {
    const store = await newStore(async () => {
      throw new Error("down");
    });
    const { id } = await store.createProject(zip({ "a.py": "1" }));
    expect((await store.addVersion(id, zip({ "a.py": "2" }))).description).toBe("Changed a.py.");
  });

  it("saves at the same time never share a number", async () => {
    const store = await newStore();
    const { id } = await store.createProject(zip({ "n": "0" }));
    await Promise.all([1, 2, 3, 4].map((n) => store.addVersion(id, zip({ n: String(n) }))));
    expect((await store.listVersions(id)).map((v) => v.number)).toEqual([5, 4, 3, 2, 1]);
  });

  it("refuses bad input: not a zip, unknown project or version", async () => {
    const store = await newStore();
    await expect(store.createProject(new TextEncoder().encode("nope"))).rejects.toMatchObject({ status: 400 });
    await expect(store.listVersions("../../etc")).rejects.toMatchObject({ status: 404 });
    const { id } = await store.createProject(zip({ "a.py": "1" }));
    for (const n of [0, 2, 1.5, NaN]) await expect(store.getZip(id, n)).rejects.toMatchObject({ status: 404 });
  });
});

describe("HTTP API", () => {
  function form(file: Uint8Array, requestText?: string): { payload: Buffer; headers: Record<string, string> } {
    const b = "----t";
    const parts = [
      ...(requestText ? [`--${b}\r\nContent-Disposition: form-data; name="request"\r\n\r\n${requestText}\r\n`] : []),
      `--${b}\r\nContent-Disposition: form-data; name="file"; filename="p.zip"\r\n\r\n`,
    ];
    return { payload: Buffer.concat([Buffer.from(parts.join("")), Buffer.from(file), Buffer.from(`\r\n--${b}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
  }

  it("upload, save, list, download, diff", async () => {
    const app = await buildServer(await newStore(async (_c, r) => `Did: ${r}`));
    const created = await app.inject({ method: "POST", url: "/api/projects", ...form(zip({ "a.py": "1\n" })) });
    expect(created.statusCode).toBe(201);
    const base = `/api/projects/${(created.json() as { id: string }).id}`;

    expect((await app.inject({ method: "POST", url: `${base}/versions`, ...form(zip({ "a.py": "2\n" }), "make it 2") })).json()).toMatchObject({ number: 2, description: "Did: make it 2" });
    expect((await app.inject({ method: "GET", url: `${base}/versions` })).json()).toMatchObject({ versions: [{ number: 2, isCurrent: true }, { number: 1, isCurrent: false }] });

    const download = await app.inject({ method: "GET", url: `${base}/versions/1/download` });
    expect([download.headers["content-type"], download.headers["content-disposition"]]).toEqual(["application/zip", 'attachment; filename="version-1.zip"']);
    expect(new TextDecoder().decode(unzipSync(new Uint8Array(download.rawPayload))["a.py"])).toBe("1\n");

    expect((await app.inject({ method: "GET", url: `${base}/versions/2/diff` })).json()).toEqual({
      files: [{ path: "a.py", change: "changed", lines: [{ type: "removed", text: "1" }, { type: "added", text: "2" }] }],
    });
    expect((await app.inject({ method: "GET", url: `${base}/versions/9/download` })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { a: 1 } })).statusCode).toBe(400);
    await app.close();
  });
});

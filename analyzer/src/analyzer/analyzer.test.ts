/**
 * Tests for `analyzeZip`, with Claude mocked: no network calls.
 *
 * How the mock works, and what that means for these tests:
 * a canned answer would only test the mock. Instead, `evidenceBasedFake`
 * decides whether the project fits the v0 manifest, and what goes in it,
 * ONLY from the evidence the analyzer chose to show it (`includedFiles`,
 * `keyLines`, `assetFiles`), the same evidence the real model gets. So these
 * tests check the analyzer's half of the job: that extraction, the
 * file-selection heuristic, key-line extraction, validation, retry and
 * cleanup deliver the right evidence and only ever return valid manifests.
 * They do NOT measure the real model's judgment; that needs a live run.
 *
 * Fixtures live in `testdata/<name>/` and are zipped into a temp dir per run.
 * `image-resizer` is the Runner's own example project (from `main`), and
 * `testdata/expected/image-resizer.simplyopen.json` is the Runner's
 * hand-written manifest for it. The big-project fixture is generated at
 * test time instead of committed.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Manifest, ManifestInput } from "../manifest/schema.js";
import localSchema from "../manifest/schema.json" with { type: "json" };
import { analyzeZip, manifestIssues } from "./analyzer.js";
import type { ClaudeClient, RawAnalysis } from "./claudeClient.js";
import { UnsupportedProjectError } from "./errors.js";
import { TEMP_DIR_PREFIX } from "./projectSummary.js";
import type { AnalysisPromptExtras } from "./prompts.js";
import type { ProjectSummary } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTDATA = path.resolve(HERE, "../../testdata");
/** The shared schema at the repository root; present once `main` is merged into this branch. */
const SHARED_SCHEMA = path.resolve(HERE, "../../../manifest/manifest.schema.json");

const FITS = ["image-resizer", "transcript-python"] as const;
const DOES_NOT_FIT = ["node-cli", "pygame-game", "interactive-quiz", "ambiguous-multi-entry", "wrapped-folder"] as const;
type Fixture = (typeof FITS)[number] | (typeof DOES_NOT_FIT)[number] | "big-project" | "wrapped-resizer";

let workDir: string;
let tmpRoot: string;
const zips = {} as Record<Fixture, string>;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), "analyzer-test-"));
  tmpRoot = await mkdtemp(path.join(workDir, "tmp-"));
  for (const name of [...FITS, ...DOES_NOT_FIT]) zips[name] = await zipDirectory(path.join(TESTDATA, name), path.join(workDir, `${name}.zip`));
  zips["big-project"] = await zipDirectory(await writeBigProject(path.join(workDir, "big-project")), path.join(workDir, "big-project.zip"));
  // The same resizer, zipped the way people often do it: as one folder.
  zips["wrapped-resizer"] = await zipDirectory(path.join(TESTDATA, "image-resizer"), path.join(workDir, "wrapped-resizer.zip"), "image_resizer/");
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------ */
/* Tests                                                                    */
/* ------------------------------------------------------------------------ */

describe("the v0 contract", () => {
  it.skipIf(!existsSync(SHARED_SCHEMA))("src/manifest/schema.json is an exact copy of the shared manifest/manifest.schema.json", async () => {
    expect(localSchema).toEqual(JSON.parse(await readFile(SHARED_SCHEMA, "utf8")));
  });

  it("the Runner's hand-written example manifest passes every check", async () => {
    const example = JSON.parse(await readFile(path.join(TESTDATA, "expected", "image-resizer.simplyopen.json"), "utf8")) as Manifest;
    expect(manifestIssues(example, ["resize.py", "requirements.txt", "sample/photo.png"], "")).toEqual([]);
  });
});

describe("analyzeZip with a mocked Claude client", () => {
  it("image-resizer: matches the Runner's own manifest for its example project", async () => {
    const { client, calls } = recordingClient();
    const result = await analyzeZip(zips["image-resizer"], client, { tmpRoot });
    const { manifest } = result;
    const expected = JSON.parse(await readFile(path.join(TESTDATA, "expected", "image-resizer.simplyopen.json"), "utf8")) as Manifest;

    expect(result.projectFolder).toBe("");
    expect(manifest).toMatchObject({ manifest_version: 0, entry: expected.entry, requirements: expected.requirements, results: expected.results });
    expect(manifest.inputs.map(({ id, type, flag, default: d }) => ({ id, type, flag, default: d }))).toEqual(
      expected.inputs.map(({ id, type, flag, default: d }) => ({ id, type, flag, default: d })),
    );
    expect(manifest.inputs[0]!.required).toBe(true);
    expect(manifest.inputs[2]!.options?.map((o) => o.value)).toEqual(expected.inputs[2]!.options?.map((o) => o.value));
    expect(manifest.sample?.image).toBe(expected.sample?.image);
    expect(result.name).toBe(manifest.name);

    // The analyzer's part: the script and requirements were shown in full, and the sample photo was named.
    expect(calls[0]!.summary.includedFiles.has("resize.py")).toBe(true);
    expect(calls[0]!.summary.includedFiles.has("requirements.txt")).toBe(true);
    expect(calls[0]!.summary.assetFiles).toEqual(["sample/photo.png"]);
  });

  it("wrapped-resizer: a project zipped as a folder gets that folder as projectFolder, and paths relative to it", async () => {
    const { client } = recordingClient();
    const result = await analyzeZip(zips["wrapped-resizer"], client, { tmpRoot });
    expect(result.projectFolder).toBe("image_resizer");
    expect(result.manifest.entry).toBe("resize.py");
    expect(result.manifest.requirements).toBe("requirements.txt");
    expect(result.manifest.sample?.image).toBe("sample/photo.png");
  });

  it("wrapped-resizer: an entry given relative to the zip root instead of the project folder is caught, with a fix suggested", async () => {
    const { client, calls } = recordingClient({
      breakFirst: (a) => { a.project_folder = ""; },
    });
    const result = await analyzeZip(zips["wrapped-resizer"], client, { tmpRoot });
    const issue = calls[1]!.extras?.retry?.issues.find((i) => i.startsWith("manifest/entry"));
    expect(issue).toMatch(/no "resize.py" in the project \(it exists at "image_resizer\/resize.py"/);
    expect(result.projectFolder).toBe("image_resizer");
  });

  it("transcript-python: positional file input, results folder flag, and the on/off option left out with a note", async () => {
    const { client, calls } = recordingClient();
    const { manifest, notes } = await analyzeZip(zips["transcript-python"], client, { tmpRoot });

    expect(manifest.entry).toBe("zoom_to_nvivo.py");
    expect(manifest.results.flag).toBe("--output-dir");
    expect(manifest.inputs).toEqual([{ id: "transcripts", label: "transcripts", type: "file", flag: null, required: true, extensions: ["vtt"] }]);
    expect(manifest.requirements).toBeUndefined();
    expect(notes.some((n) => /--keep-timestamps/.test(n))).toBe(true);
    expect(calls[0]!.summary.truncated).toBe(false);
  });

  it("big-project: entry and settings found from key lines even though the code didn't fit", async () => {
    const { client, calls } = recordingClient();
    const { manifest, notes } = await analyzeZip(zips["big-project"], client, { tmpRoot });
    const { summary, extras } = calls[0]!;

    // The analyzer's part: main.py was too big to include, but its telling lines and the omission were passed on.
    expect(summary.truncated).toBe(true);
    expect(summary.includedFiles.has("main.py")).toBe(false);
    const mainLines = summary.keyLines.filter((k) => k.path === "main.py").map((k) => k.text);
    expect(mainLines).toEqual(expect.arrayContaining([expect.stringMatching(/__name__ == "__main__"/), expect.stringMatching(/add_argument\("--output-dir"/)]));
    expect(extras?.omittedFiles).toContain("main.py");

    // ...so the (fake) model could still describe it, and said its view was partial.
    expect(manifest.entry).toBe("main.py");
    expect(manifest.inputs.map((i) => [i.id, i.type, i.flag])).toEqual([["data", "file", null], ["rows", "number", "--rows"]]);
    expect(manifest.results.flag).toBe("--output-dir");
    expect(notes.some((n) => /could not be read in full/i.test(n))).toBe(true);
  });

  it.each(DOES_NOT_FIT)("%s: doesn't fit v0, so it's turned down with a plain-English reason (no retry)", async (fixture) => {
    const { client, calls } = recordingClient();
    const failure = await analyzeZip(zips[fixture], client, { tmpRoot }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnsupportedProjectError);
    expect((failure as Error).message.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });

  it.each([...FITS, "big-project", "wrapped-resizer"] as const)("retry: invalid JSON first, then a valid answer (%s)", async (fixture) => {
    const { client, calls } = recordingClient({ firstAnswerInvalidJson: true });
    const result = await analyzeZip(zips[fixture], client, { tmpRoot });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.extras?.retry).toBeUndefined();
    expect(calls[1]!.extras?.retry?.issues.length).toBeGreaterThan(0);
    expect(calls[1]!.extras?.retry?.previousAnswer).toContain("{not valid json");
    expect(result.rawModelOutput).toHaveLength(2);
    expect(result.manifest.manifest_version).toBe(0);
  });

  // Each rule broken once on the image resizer: the analyzer must reject the answer and say why on the retry.
  const brokenRules: [string, (m: Manifest, a: Answer) => void, RegExp][] = [
    // schema.json
    ["input id that isn't snake_case (pattern)", (m) => { m.inputs[0]!.id = "Image"; }, /inputs\/0\/id: must match the pattern/],
    ["empty label (minLength)", (m) => { m.inputs[0]!.label = ""; }, /inputs\/0\/label: must be at least 1 character/],
    ["choice without options (if/then)", (m) => { delete m.inputs[2]!.options; }, /inputs\/2: is missing required property "options"/],
    ["extension with a dot (pattern)", (m) => { m.inputs[0]!.extensions = [".png"]; }, /inputs\/0\/extensions\/0: must match the pattern/],
    ["unknown field", (m) => { (m as unknown as Record<string, unknown>).confidence = "high"; }, /has unexpected property "confidence"/],
    ["wrong version", (m) => { (m as unknown as Record<string, unknown>).manifest_version = 1; }, /manifest_version: must be 0/],
    // Files
    ["entry that doesn't exist", (m) => { m.entry = "main.py"; }, /entry: there is no "main.py" in the project/],
    ["entry that isn't Python", (m) => { m.entry = "requirements.txt"; }, /must be a Python \(.py\) file/],
    ["entry starting with ./", (m) => { m.entry = "./resize.py"; }, /must not start with "\.\/"/],
    ["requirements that don't exist", (m) => { m.requirements = "requirements-dev.txt"; }, /requirements: there is no "requirements-dev.txt"/],
    ["project_folder that isn't a folder", (_m, a) => { a.project_folder = "src"; }, /project_folder: "src" is not a folder/],
    // Inputs
    ["duplicate input id", (m) => { m.inputs[1]!.id = "image"; }, /"image" is used more than once/],
    ["flag without dashes", (m) => { m.inputs[1]!.flag = "width"; }, /"width" must look like "-x" or "--name"/],
    ["flag with the value in it", (m) => { m.inputs[1]!.flag = "--width {value}"; }, /must look like "-x" or "--name"/],
    ["input reusing the results flag", (m) => { m.inputs[1]!.flag = "--output-dir"; }, /"--output-dir" is already used at \/inputs\/1\/flag/],
    ["optional positional input", (m) => { m.inputs[0]!.required = false; }, /passed by position, so it must be required/],
    ["extensions on a number", (m) => { m.inputs[1]!.extensions = ["png"]; }, /only file inputs have extensions/],
    ["upper-case extension", (m) => { m.inputs[0]!.extensions = ["PNG"]; }, /"PNG" must be lower case/],
    ["options on a text input", (m) => { m.inputs.push({ id: "title", label: "Title", type: "text", flag: "--title", options: [{ value: "a", label: "A" }] }); }, /only choice inputs have options/],
    ["repeated option value", (m) => { m.inputs[2]!.options!.push({ value: "png", label: "Again" }); }, /value "png" is used more than once/],
    ["default on a file input", (m) => { m.inputs[0]!.default = "photo.png"; }, /file inputs have no default/],
    ["choice default that isn't an option", (m) => { m.inputs[2]!.default = "gif"; }, /default: "gif" is not one of the option values/],
    ["number default that isn't a number", (m) => { m.inputs[1]!.default = "wide"; }, /default: "wide" is not a number/],
    // Sample
    ["sample for an unknown input", (m) => { m.sample = { ...m.sample, height: "5" }; }, /sample\/height: "height" is not the id of any input/],
    ["sample missing a required input", (m) => { m.sample = {}; }, /sample\/image: every required input needs a sample value/],
    ["sample file that doesn't exist", (m) => { m.sample = { image: "sample/cat.png" }; }, /no "sample\/cat.png"/],
    ["sample file with the wrong extension", (m) => { m.inputs[0]!.extensions = ["jpg"]; }, /doesn't end in one of the allowed extensions \(jpg\)/],
    ["sample choice that isn't an option", (m) => { m.sample = { ...m.sample, format: "gif" }; }, /sample\/format: "gif" is not one of the option values/],
    // Words
    ["long button label", (m) => { m.action_label = "Make this picture a different size right now"; }, /action_label: must be a short button label/],
    ["name that's a sentence", (m) => { m.name = "A tool that makes your pictures bigger or smaller for you"; }, /name: must be a few words/],
    ["description with jargon", (m) => { m.description = "A command-line tool that resizes images."; }, /must avoid technical words for non-coders \(found: command-line\)/],
    // The answer's shape
    ["both a manifest and a reason", (_m, a) => { a.unsupported_reason = "It is a game."; }, /Exactly one of manifest and unsupported_reason/],
    ["notes that aren't a list", (_m, a) => { a.notes = "none"; }, /notes: must be a list of strings/],
  ];
  it.each(brokenRules)("rule: %s is rejected and explained on the retry", async (_label, breakIt, explanation) => {
    const { client, calls } = recordingClient({ breakFirst: (a) => breakIt(a.manifest as Manifest, a) });
    const result = await analyzeZip(zips["image-resizer"], client, { tmpRoot });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.extras?.retry?.issues.some((issue) => explanation.test(issue)), JSON.stringify(calls[1]!.extras?.retry?.issues)).toBe(true);
    expect(result.manifest.entry).toBe("resize.py");
  });

  it("an empty unsupported_reason is rejected and retried, not passed on", async () => {
    const { client, calls } = recordingClient({ breakFirst: (a) => { a.manifest = null; a.unsupported_reason = "  "; } });
    const result = await analyzeZip(zips["image-resizer"], client, { tmpRoot });
    expect(calls[1]!.extras?.retry?.issues).toContain("/unsupported_reason: must be a non-empty string");
    expect(result.manifest.entry).toBe("resize.py");
  });

  it("concurrency: 5 simultaneous calls across image-resizer and transcript-python don't leak state", async () => {
    // Ground truth is fixed per fixture, NOT computed by running the code under
    // test, so state shared between calls can't make both sides wrong together.
    const truth = {
      "image-resizer": { entry: "resize.py", files: ["requirements.txt", "resize.py"] },
      "transcript-python": { entry: "zoom_to_nvivo.py", files: ["zoom_to_nvivo.py"] },
    };
    const order = ["image-resizer", "transcript-python", "image-resizer", "transcript-python", "image-resizer"] as const;

    // One recording client per call, so every summary is attributable to its own request.
    const runs = order.map((fixture) => {
      const recorder = recordingClient({ randomDelayMs: 40 });
      return { fixture, recorder, result: analyzeZip(zips[fixture], recorder.client, { tmpRoot }) };
    });
    const results = await Promise.all(runs.map((r) => r.result));

    runs.forEach(({ fixture, recorder }, i) => {
      expect(results[i]!.manifest.entry).toBe(truth[fixture].entry);
      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0]!.summary.fileTree.map((f) => f.path).sort()).toEqual(truth[fixture].files);
    });
    // Every request-scoped temp dir was removed.
    expect((await readdir(tmpRoot)).filter((n) => n.startsWith(TEMP_DIR_PREFIX))).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Mock Claude client                                                       */
/* ------------------------------------------------------------------------ */

interface RecordedCall {
  summary: ProjectSummary;
  extras: AnalysisPromptExtras | undefined;
}

/** The model's answer, before `rawModelOutput` is added. */
type Answer = Omit<RawAnalysis, "rawModelOutput">;

/** A ClaudeClient fake that records every call and answers via {@link evidenceBasedFake}. */
function recordingClient(
  options: { firstAnswerInvalidJson?: boolean; randomDelayMs?: number; breakFirst?: (answer: Answer) => void } = {},
): { client: ClaudeClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: ClaudeClient = {
    async analyzeProject(summary, _signal, extras) {
      calls.push({ summary, extras });
      const first = calls.length === 1;
      if (options.randomDelayMs) await new Promise((r) => setTimeout(r, Math.random() * options.randomDelayMs!));
      if (first && options.firstAnswerInvalidJson) {
        const garbage = "{not valid json";
        return { project_folder: undefined, manifest: garbage, unsupported_reason: undefined, notes: undefined, rawModelOutput: garbage };
      }
      const answer = evidenceBasedFake(summary);
      if (first && options.breakFirst) options.breakFirst(answer);
      return { ...answer, rawModelOutput: JSON.stringify(answer) };
    },
  };
  return { client, calls };
}

/**
 * Stand-in for the model. Uses only the evidence in the summary (full files,
 * key lines, asset names). Deliberately simple rules, enough for the fixtures.
 */
function evidenceBasedFake(summary: ProjectSummary): Answer {
  const notes: string[] = [];
  const unsupported = (reason: string): Answer => ({ project_folder: "", manifest: null, unsupported_reason: reason, notes });
  if ([...summary.includedFiles.keys()].some((p) => path.posix.basename(p) === "package.json")) {
    return unsupported("This project isn't written in Python, and SimplyOpen can only run Python for now.");
  }

  // Evidence per file: full text when shown, otherwise only its key lines.
  const sources = new Map<string, string>([...summary.includedFiles].filter(([p]) => p.endsWith(".py")));
  for (const k of summary.keyLines) if (!summary.includedFiles.has(k.path)) sources.set(k.path, `${sources.get(k.path) ?? ""}\n${k.text}`);
  const scripts = [...sources].filter(([, text]) => /__name__\s*==\s*["']__main__["']/.test(text));
  const [scriptPath, code] = scripts[0]!;
  if (scripts.length > 1) notes.push(`More than one script could be the main one (${scripts.map(([p]) => p).join(", ")}); the first was picked.`);
  if (summary.truncated) notes.push("Some files could not be read in full, so details may be missing.");

  if (/\bpygame\b/.test(code)) return unsupported("This is a game that opens its own window, which SimplyOpen can't run yet.");
  if (/\binput\(/.test(code)) return unsupported("This program asks questions while it runs, which SimplyOpen can't show yet.");

  const all = [...summary.fileTree.map((f) => f.path), ...summary.assetFiles];
  const top = all[0]!.split("/")[0]!;
  const folder = all.every((f) => f.startsWith(`${top}/`)) ? top : "";
  const local = (p: string): string => (folder ? p.slice(folder.length + 1) : p);

  // Settings from argparse calls, one per line; read to the line's final ")" so parentheses inside survive.
  const inputs: ManifestInput[] = [];
  let resultsFlag: string | undefined;
  for (const call of code.matchAll(/add_argument\(\s*"([^"]+)"(.*)\)\s*$/gm)) {
    const [, flag, rest] = call as unknown as [string, string, string];
    const id = flag.replace(/^-+/, "").replace(/-/g, "_");
    const defaultValue = /default=["']?([\w.-]+)/.exec(rest)?.[1];
    if (/(output|out)_dir$/.test(id)) resultsFlag = flag;
    else if (!flag.startsWith("-")) inputs.push({ id, label: id.replace(/_/g, " "), type: "file", flag: null, required: true, ...(code.includes(".vtt") ? { extensions: ["vtt"] } : {}) });
    else if (rest.includes("store_true")) notes.push(`The on/off setting ${flag} can't be shown, so it was left out.`);
    else if (rest.includes("type=int")) inputs.push({ id, label: id, type: "number", flag, ...(defaultValue ? { default: defaultValue } : {}) });
    else if (/choices=\[/.test(rest)) {
      const values = [.../choices=\[([^\]]*)\]/.exec(rest)![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
      inputs.push({ id, label: id, type: "choice", flag, options: values.map((value) => ({ value, label: value })), ...(defaultValue ? { default: defaultValue } : {}) });
    } else inputs.push({ id, label: id, type: "text", flag });
  }
  if (!resultsFlag) return unsupported("This program has no setting for where to save its results, which SimplyOpen needs.");

  const manifest: Manifest = {
    manifest_version: 0,
    name: "Test Tool",
    description: "Does one helpful job with your files.",
    entry: local(scriptPath),
    inputs,
    results: { flag: resultsFlag },
  };
  if (all.includes(folder ? `${folder}/requirements.txt` : "requirements.txt")) manifest.requirements = "requirements.txt";
  const sampleFile = all.map(local).find((p) => p.startsWith("sample/"));
  const fileInput = inputs.find((i) => i.type === "file");
  if (sampleFile && fileInput) manifest.sample = { [fileInput.id]: sampleFile };
  return { project_folder: folder, manifest, unsupported_reason: null, notes };
}

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Write a project too big for the content budget: a large main.py whose
 * argparse setup (including a results folder option) and __main__ guard sit
 * at the end, plus 40 helper modules.
 */
async function writeBigProject(dir: string): Promise<string> {
  await mkdir(path.join(dir, "helpers"), { recursive: true });
  const filler = Array.from({ length: 900 }, (_, i) => `def step_${i}(rows):\n    return [r for r in rows if r][: ${i} + 1]\n`).join("\n");
  await writeFile(
    path.join(dir, "main.py"),
    `import argparse\nfrom helpers import mod_0\n\n${filler}\n\ndef main():\n    parser = argparse.ArgumentParser()\n` +
      `    parser.add_argument("data", help="CSV file to summarise")\n` +
      `    parser.add_argument("--rows", type=int, choices=range(1, 1001), help="How many rows to show")\n` +
      `    parser.add_argument("--output-dir", default="out", help="Folder for the summary")\n` +
      `    args = parser.parse_args()\n    print(args)\n\n\nif __name__ == "__main__":\n    main()\n`,
  );
  for (let i = 0; i < 40; i++) {
    await writeFile(path.join(dir, "helpers", `mod_${i}.py`), Array.from({ length: 60 }, (_, j) => `def f_${i}_${j}(x):\n    return x * ${j}\n`).join("\n"));
  }
  return dir;
}

/** Write every file under `dir` into a deflate-compressed zip at `out`; paths are relative to `dir`, after `prefix` (e.g. "folder/"). */
async function zipDirectory(dir: string, out: string, prefix = ""): Promise<string> {
  const entries: { name: string; data: Buffer }[] = [];
  async function walk(rel: string): Promise<void> {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) entries.push({ name: `${prefix}${child}`, data: await readFile(path.join(dir, child)) });
    }
  }
  await walk("");

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(out, Buffer.concat([...locals, ...centrals, end]));
  return out;
}

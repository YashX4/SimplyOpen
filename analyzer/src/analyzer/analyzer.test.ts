/**
 * Tests for `analyzeZip`, with Claude mocked: no network calls.
 *
 * How the mock works, and what that means for these tests:
 * a canned answer would only test the mock. Instead, `evidenceBasedFake`
 * decides language, entry points, interface, inputs and confidence ONLY from
 * the evidence the analyzer chose to show it (`includedFiles`, `keyLines`,
 * `assetFiles`), the same evidence the real model gets. So these tests check
 * the analyzer's half of the job: that extraction, the file-selection
 * heuristic, key-line extraction, validation, retry and cleanup deliver the
 * right evidence and only ever return valid manifests. They do NOT measure
 * the real model's judgment; that needs a live eval against the same fixtures.
 *
 * Fixtures live in `testdata/<name>/` and are zipped into a temp dir per run.
 * The big-project fixture is generated at test time instead of committed.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Input, Interface, Manifest } from "../manifest/schema.js";
import { analyzeZip } from "./analyzer.js";
import type { ClaudeClient, RawAnalysis } from "./claudeClient.js";
import { TEMP_DIR_PREFIX } from "./projectSummary.js";
import type { AnalysisPromptExtras } from "./prompts.js";
import type { ProjectSummary } from "./types.js";

const TESTDATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../testdata");
const FIXTURES = ["transcript-python", "node-cli", "ambiguous-multi-entry", "pygame-game", "interactive-quiz", "wrapped-folder"] as const;
type Fixture = (typeof FIXTURES)[number] | "big-project";

let workDir: string;
let tmpRoot: string;
const zips = {} as Record<Fixture, string>;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), "analyzer-test-"));
  tmpRoot = await mkdtemp(path.join(workDir, "tmp-"));
  for (const name of FIXTURES) zips[name] = await zipDirectory(path.join(TESTDATA, name), path.join(workDir, `${name}.zip`));
  zips["big-project"] = await zipDirectory(await writeBigProject(path.join(workDir, "big-project")), path.join(workDir, "big-project.zip"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------ */
/* Tests                                                                    */
/* ------------------------------------------------------------------------ */

describe("analyzeZip with a mocked Claude client", () => {
  it("transcript-python: python, one primary entry point, transcript file input required", async () => {
    const { client, calls } = recordingClient();
    const { manifest } = await analyzeZip(zips["transcript-python"], client, { tmpRoot });

    expect(manifest.project.language).toBe("python");
    expect(manifest.project.entry_points).toHaveLength(1);
    expect(manifest.project.primary_entry_point).toBe(manifest.project.entry_points[0]!.id);
    expect(manifest.project.entry_points[0]!.path).toBe("zoom_to_nvivo.py");
    expect(manifest.project.entry_points[0]!.interface).toMatchObject({ kind: "command_line", exits_on_its_own: true });
    const transcripts = manifest.inputs.find((i) => i.kind === "file" && /transcript/i.test(`${i.id} ${i.label}`));
    expect(transcripts).toBeDefined();
    expect(transcripts!.required).toBe(true);
    expect(transcripts!.multiple).toBe(true); // nargs="+"
    expect(transcripts!.help).toMatch(/\.vtt/);

    // The analyzer's part: the whole script reached the model, nothing omitted.
    expect(calls[0]!.summary.includedFiles.has("zoom_to_nvivo.py")).toBe(true);
    expect(calls[0]!.summary.truncated).toBe(false);
  });

  it("node-cli: node, several entry points, primary matches package.json main", async () => {
    const { client, calls } = recordingClient();
    const { manifest } = await analyzeZip(zips["node-cli"], client, { tmpRoot });
    const pkg = JSON.parse(await readFile(path.join(TESTDATA, "node-cli", "package.json"), "utf8")) as { main: string };

    expect(manifest.project.language).toBe("node");
    expect(manifest.project.entry_points.length).toBeGreaterThan(1);
    const primary = manifest.project.entry_points.find((e) => e.id === manifest.project.primary_entry_point);
    expect(primary?.path).toBe(pkg.main);

    // The analyzer's part: package.json (the disambiguating evidence) was shown in full.
    expect(calls[0]!.summary.includedFiles.has("package.json")).toBe(true);
  });

  it("ambiguous-multi-entry: confidence below high, with a note about the ambiguity", async () => {
    const { client, calls } = recordingClient();
    const { manifest } = await analyzeZip(zips["ambiguous-multi-entry"], client, { tmpRoot });

    expect(manifest.confidence.overall).not.toBe("high");
    expect(manifest.confidence.notes.some((n) => /unclear|ambiguous|more than one/i.test(n))).toBe(true);
    // The analyzer's part: both candidate scripts were visible, so the ambiguity is real, not caused by omission.
    expect([...calls[0]!.summary.includedFiles.keys()].sort()).toEqual(["rename_photos.py", "resize_photos.py"]);
  });

  it("pygame-game: own window that runs until closed, with controls, assets and the pygame package", async () => {
    const { client, calls } = recordingClient();
    const { manifest } = await analyzeZip(zips["pygame-game"], client, { tmpRoot });
    const entry = manifest.project.entry_points[0]!;

    expect(entry.path).toBe("game.py");
    expect(entry.interface.kind).toBe("own_window");
    expect(entry.interface.exits_on_its_own).toBe(false);
    const keys = entry.interface.controls.flatMap((c) => c.keys);
    expect(keys).toEqual(expect.arrayContaining(["Left arrow", "Right arrow", "Escape"]));
    expect(manifest.project.assets).toEqual(["assets/**"]);
    expect(manifest.dependencies.packages).toEqual(["pygame>=2.5"]);
    expect(manifest.inputs).toEqual([]);

    // The analyzer's part: asset files were named (never read), and the game code was shown in full.
    expect(calls[0]!.summary.assetFiles).toEqual(["assets/basket.png", "assets/ding.wav", "assets/star.png"]);
    expect(calls[0]!.summary.fileTree.map((f) => f.path)).not.toContain("assets/basket.png");
    expect(calls[0]!.summary.includedFiles.has("game.py")).toBe(true);
  });

  it("interactive-quiz: interactive terminal with the questions it asks, in order", async () => {
    const { client } = recordingClient();
    const { manifest } = await analyzeZip(zips["interactive-quiz"], client, { tmpRoot });
    const ui = manifest.project.entry_points[0]!.interface;

    expect(ui.kind).toBe("interactive_terminal");
    expect(ui.prompts.map((p) => p.question)).toEqual([
      "What's your name?",
      "How many questions would you like?",
      "Pick a level (easy/hard):",
    ]);
    expect(ui.prompts.map((p) => p.kind)).toEqual(["text", "number", "choice"]);
    expect(ui.prompts[2]!.choices).toEqual(["easy", "hard"]);
    expect(ui.server).toBeNull();
  });

  it("big-project: entry point found from key lines even though its code didn't fit", async () => {
    const { client, calls } = recordingClient();
    const { manifest } = await analyzeZip(zips["big-project"], client, { tmpRoot });
    const { summary, extras } = calls[0]!;

    // The analyzer's part: main.py was too big to include, but its telling lines and the omission were passed on.
    expect(summary.truncated).toBe(true);
    expect(summary.includedFiles.has("main.py")).toBe(false);
    const mainLines = summary.keyLines.filter((k) => k.path === "main.py").map((k) => k.text);
    expect(mainLines).toEqual(expect.arrayContaining([expect.stringMatching(/__name__ == "__main__"/), expect.stringMatching(/add_argument\("--rows"/)]));
    expect(extras?.omittedFiles).toContain("main.py");

    // ...so the (fake) model could still describe it, and said its view was partial.
    expect(manifest.project.entry_points[0]!.path).toBe("main.py");
    expect(manifest.inputs.map((i) => i.id)).toEqual(["data", "rows"]);
    expect(manifest.inputs[1]).toMatchObject({ kind: "number", min: 1, max: 1000 });
    expect(manifest.confidence.overall).not.toBe("high");
    expect(manifest.confidence.notes.some((n) => /could not be read in full/i.test(n))).toBe(true);
  });

  it("wrapped-folder: a project zipped as a folder runs from that folder, so relative assets load", async () => {
    const { client, calls } = recordingClient();
    const { manifest } = await analyzeZip(zips["wrapped-folder"], client, { tmpRoot });
    const entry = manifest.project.entry_points[0]!;

    expect(entry.path).toBe("star-game/main.py");
    expect(entry.working_directory).toBe("star-game");
    expect(entry.run_command).toBe("python main.py {args}");
    expect(manifest.project.assets).toEqual(["star-game/assets/**"]);
    expect(calls[0]!.summary.assetFiles).toEqual(["star-game/assets/star.png"]);
  });

  it("wrapped-folder: the raycaster bug (run_command relative to the wrong folder) is caught, with a fix suggested", async () => {
    const calls: RecordedCall[] = [];
    const client: ClaudeClient = {
      async analyzeProject(summary, _signal, extras) {
        calls.push({ summary, extras });
        const answer = evidenceBasedFake(summary);
        // First attempt: what the live API returned for the user's raycaster: right path, wrong folder.
        if (calls.length === 1) (answer.manifest as Manifest).project.entry_points[0]!.working_directory = "";
        return answer;
      },
    };
    const { manifest } = await analyzeZip(zips["wrapped-folder"], client, { tmpRoot });
    const issue = calls[1]!.extras?.retry?.issues.find((i) => /refers to "main.py"/.test(i));
    expect(issue).toMatch(/it exists at "star-game\/main.py"; set working_directory to "star-game"/);
    expect(manifest.project.entry_points[0]!.working_directory).toBe("star-game");
  });

  it.each([...FIXTURES, "big-project"] as const)("retry: invalid JSON first, then a valid answer (%s)", async (fixture) => {
    const { client, calls } = recordingClient({ firstAnswerInvalidJson: true });
    const result = await analyzeZip(zips[fixture], client, { tmpRoot });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.extras?.retry).toBeUndefined();
    expect(calls[1]!.extras?.retry?.issues.length).toBeGreaterThan(0);
    expect(calls[1]!.extras?.retry?.previousAnswer).toContain("{not valid json");
    expect(result.rawModelOutput).toHaveLength(2);
    expect(result.manifest.schema_version).toBe("1.0");
  });

  // Each contract rule JSON Schema can't express, broken once: the analyzer must reject the answer and say why on the retry.
  const brokenRules: [string, (m: Manifest) => void, RegExp][] = [
    ["{port} outside a local server", (m) => { m.project.entry_points[0]!.run_command = "python game.py {port}"; }, /\{port\}" is only allowed/],
    ["server details on a non-server", (m) => { m.project.entry_points[0]!.interface.server = { port: 1, port_binding: null, url_path: "/", ready_text: null }; }, /server: must be set when kind is "local_server" and null otherwise/],
    ["prompts on a non-interactive program", (m) => { m.project.entry_points[0]!.interface.prompts = [{ question: "x", kind: "text", choices: [] }]; }, /prompts: must be empty unless/],
    ["unknown run_command placeholder", (m) => { m.project.entry_points[0]!.run_command = "python game.py {level}"; }, /"\{level\}" is not allowed/],
    ["boolean binding with {value}", (m) => { m.inputs.push(makeInput({ id: "fast", kind: "boolean", required: false, cli_binding: "--fast {value}" })); }, /boolean's binding is a plain flag/],
    ["text binding without {value}", (m) => { m.inputs.push(makeInput({ id: "name", kind: "text", required: false, cli_binding: "--name" })); }, /must contain "\{value\}" exactly once/],
    ["invalid env var name", (m) => { m.inputs.push(makeInput({ id: "key", kind: "text", required: true, secret: true, env_binding: "API KEY" })); }, /not a valid environment variable name/],
    ["multiple on a non-file input", (m) => { m.inputs.push(makeInput({ id: "n", kind: "text", required: false, multiple: true, cli_binding: "{value}" })); }, /multiple: can only be true for a "file" input/],
    ["min/max on a non-number", (m) => { m.inputs.push(makeInput({ id: "t", kind: "text", required: false, min: 1, cli_binding: "{value}" })); }, /min and max must be null unless kind is "number"/],
    ["min greater than max", (m) => { m.inputs.push(makeInput({ id: "n", kind: "number", required: false, min: 9, max: 1, cli_binding: "{value}" })); }, /min is greater than max/],
    ["choice default not in choices", (m) => { m.inputs.push(makeInput({ id: "c", kind: "choice", required: false, choices: ["a"], default: "z", cli_binding: "{value}" })); }, /"z" is not one of the choices/],
    ["console output with a path", (m) => { m.outputs.push({ id: "o", kind: "console", label: "Score", path_pattern: "score.txt" }); }, /must be null for a "console" output/],
    ["path_pattern naming no input", (m) => { m.outputs.push({ id: "o", kind: "folder", label: "Saves", path_pattern: "{save_dir}" }); }, /"\{save_dir\}" does not match any input id/],
    ["run_command naming a missing file", (m) => { m.project.entry_points[0]!.run_command = "python main.py {args}"; }, /refers to "main.py", but there is no "main.py" in the project/],
    ["working_directory that isn't a folder", (m) => { m.project.entry_points[0]!.working_directory = "src"; }, /working_directory: "src" is not a folder in the project tree/],
    ["working_directory starting with ./", (m) => { m.project.entry_points[0]!.working_directory = "./"; }, /working_directory: "\.\/" must not start with "\.\/"/],
    ["server port_binding without {port}", (m) => { m.project.entry_points[0]!.interface = { kind: "local_server", exits_on_its_own: false, controls: [], prompts: [], server: { port: 5000, port_binding: "--port {value}", url_path: "/", ready_text: null } }; }, /run_command must contain "\{port\}"/],
    ["cli inputs but no {args}", (m) => { m.project.entry_points[0]!.run_command = "python game.py"; m.inputs.push(makeInput({ id: "level", kind: "text", required: false, cli_binding: "--level {value}" })); }, /must contain "\{args\}"/],
    ["env_binding not in reads_env_vars", (m) => { m.inputs.push(makeInput({ id: "key", kind: "text", required: true, secret: true, env_binding: "GAME_KEY" })); }, /"GAME_KEY" must also be listed in capabilities.reads_env_vars/],
    ["accepts without a dot", (m) => { m.inputs.push(makeInput({ id: "map", kind: "file", required: false, accepts: ["json"], cli_binding: "{value}" })); }, /"json" must be a lower-case extension starting with a dot/],
    ["required unbound input at high confidence", (m) => { m.inputs.push(makeInput({ id: "name", kind: "text", required: true })); }, /can't be filled in automatically, so confidence.overall can't be "high"/],
    ["asset path starting with ./", (m) => { m.project.assets = ["./assets/**"]; }, /"\.\/assets\/\*\*" must not start with "\.\/"/],
    ["absolute output path", (m) => { m.outputs.push({ id: "o", kind: "folder", label: "Saves", path_pattern: "/tmp/saves" }); }, /must stay inside the project/],
  ];
  it.each(brokenRules)("contract rule: %s is rejected and explained on the retry", async (_label, breakIt, explanation) => {
    const calls: RecordedCall[] = [];
    let attempt = 0;
    const client: ClaudeClient = {
      async analyzeProject(summary, _signal, extras) {
        calls.push({ summary, extras });
        const answer = evidenceBasedFake(summary);
        if (attempt++ === 0) breakIt(answer.manifest as Manifest);
        return answer;
      },
    };
    const result = await analyzeZip(zips["pygame-game"], client, { tmpRoot });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.extras?.retry?.issues.some((issue) => explanation.test(issue))).toBe(true);
    expect(result.manifest.project.entry_points[0]!.interface.kind).toBe("own_window");
  });

  it("concurrency: 5 simultaneous calls across transcript-python and node-cli don't leak state", async () => {
    // Ground truth is fixed per fixture, NOT computed by running the code under
    // test, so state shared between calls can't make both sides wrong together.
    const truth = {
      "transcript-python": { language: "python", primaryPath: "zoom_to_nvivo.py", files: ["zoom_to_nvivo.py"] },
      "node-cli": {
        language: "node",
        primaryPath: "src/tidy.js",
        files: ["package.json", "scripts/clean-output.js", "src/lib/csv.js", "src/tidy.js"],
      },
    };
    const order = ["transcript-python", "node-cli", "transcript-python", "node-cli", "transcript-python"] as const;

    // One recording client per call, so every summary is attributable to its own request.
    const runs = order.map((fixture) => {
      const recorder = recordingClient({ randomDelayMs: 40 });
      return { fixture, recorder, result: analyzeZip(zips[fixture], recorder.client, { tmpRoot }) };
    });
    const results = await Promise.all(runs.map((r) => r.result));

    runs.forEach(({ fixture, recorder }, i) => {
      const { manifest } = results[i]!;
      const primary = manifest.project.entry_points.find((e) => e.id === manifest.project.primary_entry_point);
      expect(manifest.project.language).toBe(truth[fixture].language);
      expect(primary?.path).toBe(truth[fixture].primaryPath);
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

/** A ClaudeClient fake that records every call and answers via {@link evidenceBasedFake}. */
function recordingClient(options: { firstAnswerInvalidJson?: boolean; randomDelayMs?: number } = {}): {
  client: ClaudeClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let first = true;
  const client: ClaudeClient = {
    async analyzeProject(summary, _signal, extras) {
      calls.push({ summary, extras });
      if (options.randomDelayMs) await new Promise((r) => setTimeout(r, Math.random() * options.randomDelayMs!));
      if (first && options.firstAnswerInvalidJson) {
        first = false;
        const garbage = "{not valid json";
        return { name: undefined, description: undefined, manifest: garbage, rawModelOutput: garbage };
      }
      first = false;
      return evidenceBasedFake(summary);
    },
  };
  return { client, calls };
}

/**
 * Stand-in for the model. Uses only the evidence in the summary (full files,
 * key lines, asset names). Deliberately simple rules, enough for the fixtures.
 */
function evidenceBasedFake(summary: ProjectSummary): RawAnalysis {
  const pkgPath = [...summary.includedFiles.keys()].find((p) => path.posix.basename(p) === "package.json");
  const manifest = pkgPath ? fakeNode(summary.includedFiles, pkgPath) : fakePython(summary);
  return { manifest, name: "Test Tool", description: "Does one helpful job with your files.", rawModelOutput: JSON.stringify(manifest) };
}

const COMMAND_LINE: Interface = { kind: "command_line", exits_on_its_own: true, controls: [], prompts: [], server: null };

function baseManifest(language: string, entryPoints: Manifest["project"]["entry_points"], primary: string): Manifest {
  return {
    schema_version: "1.0",
    project_kind: "app_or_tool",
    project: { language, language_version: null, entry_points: entryPoints, primary_entry_point: primary, build_command: null, assets: [] },
    inputs: [],
    outputs: [],
    dependencies: { runtime: [], packages: [], system: [], operating_systems: ["macos", "windows", "linux"] },
    capabilities: { network_access: false, filesystem_access: "declared_inputs_outputs_only", reads_env_vars: [], runs_other_programs: false },
    confidence: { overall: "high", notes: [] },
  };
}

/** An input with every required field, defaults filled in. */
function makeInput(fields: Pick<Input, "id" | "kind" | "required"> & Partial<Input>): Input {
  return { label: fields.id.replace(/_/g, " "), help: null, multiple: false, min: null, max: null, secret: false, cli_binding: null, env_binding: null, ...fields };
}

function fakeNode(files: Map<string, string>, pkgPath: string): Manifest {
  const pkg = JSON.parse(files.get(pkgPath)!) as { main?: string; scripts?: Record<string, string> };
  const scriptPaths = Object.values(pkg.scripts ?? {}).flatMap((cmd) => /node\s+(\S+\.js)/.exec(cmd)?.[1] ?? []);
  const paths = [...new Set([pkg.main, ...scriptPaths].filter((p): p is string => !!p))];
  const entries = paths.map((p) => ({
    id: path.posix.basename(p, ".js").replace(/\W+/g, "_"),
    path: p,
    working_directory: "",
    run_command: `node ${p} {args}`,
    description: `Runs ${path.posix.basename(p)}`,
    interface: COMMAND_LINE,
  }));
  const primary = entries.find((e) => e.path === pkg.main) ?? entries[0]!;
  const m = baseManifest("node", entries, primary.id);
  m.inputs = [makeInput({ id: "csv_file", kind: "file", label: "CSV file", required: true, accepts: [".csv"], cli_binding: "{value}" })];
  return m;
}

/** pygame key constants → plain-English action and key name. */
const PYGAME_KEYS: Record<string, [action: string, key: string]> = {
  K_LEFT: ["Move left", "Left arrow"], K_a: ["Move left", "A"],
  K_RIGHT: ["Move right", "Right arrow"], K_d: ["Move right", "D"],
  K_SPACE: ["Jump", "Space"], K_p: ["Pause", "P"], K_ESCAPE: ["Quit", "Escape"],
};

function fakePython(summary: ProjectSummary): Manifest {
  // Evidence per file: full text when shown, otherwise only its key lines.
  const sources = new Map<string, string>([...summary.includedFiles].filter(([p]) => p.endsWith(".py")));
  for (const k of summary.keyLines) if (!sources.has(k.path)) sources.set(k.path, "");
  for (const k of summary.keyLines) if (!summary.includedFiles.has(k.path)) sources.set(k.path, `${sources.get(k.path)}\n${k.text}`);

  const scripts = [...sources].filter(([, text]) => /__name__\s*==\s*["']__main__["']/.test(text));
  const code = scripts[0]![1];

  let ui: Interface = COMMAND_LINE;
  if (/\bpygame\b/.test(code)) {
    const controls = new Map<string, string[]>();
    for (const [constant, [action, key]] of Object.entries(PYGAME_KEYS)) {
      if (new RegExp(`\\b${constant}\\b`).test(code)) controls.set(action, [...(controls.get(action) ?? []), key]);
    }
    ui = { kind: "own_window", exits_on_its_own: false, controls: [...controls].map(([action, keys]) => ({ action, keys })), prompts: [], server: null };
  } else if (/\binput\(\s*"/.test(code)) {
    const prompts = [...code.matchAll(/(int\()?input\(\s*"([^"]+)"/g)].map(([, asInt, question]) => {
      const options = /\(([a-z]+)\/([a-z]+)\)/.exec(question!);
      return { question: question!.trim(), kind: asInt ? ("number" as const) : options ? ("choice" as const) : ("text" as const), choices: options ? [options[1]!, options[2]!] : [] };
    });
    ui = { kind: "interactive_terminal", exits_on_its_own: true, controls: [], prompts, server: null };
  }

  const paths = [...summary.fileTree.map((f) => f.path), ...summary.assetFiles];
  const top = paths[0]!.split("/")[0]!;
  const workingDirectory = paths.every((f) => f.startsWith(`${top}/`)) ? top : "";
  const entries = scripts.map(([p]) => ({
    id: path.posix.basename(p, ".py"),
    path: p,
    working_directory: workingDirectory,
    run_command: `python ${workingDirectory ? p.slice(workingDirectory.length + 1) : p} {args}`,
    description: `Runs ${path.posix.basename(p)}`,
    interface: ui,
  }));
  const m = baseManifest("python", entries, entries[0]!.id);

  // Inputs from argparse calls: positional -> required file; store_true -> boolean; type=int -> number; other options -> folder/text.
  // One add_argument call per line; read to the line's final ")" so parentheses inside help text or range(...) survive.
  for (const call of code.matchAll(/add_argument\(\s*"([^"]+)"(.*)\)\s*$/gm)) {
    const [, flag, rest] = call as unknown as [string, string, string];
    const id = flag.replace(/^-+/, "").replace(/-/g, "_");
    const help = /help="([^"]+)"/.exec(rest)?.[1] ?? null;
    if (!flag.startsWith("-")) {
      m.inputs.push(makeInput({ id, kind: "file", required: true, help, multiple: /nargs="[+*]"/.test(rest), cli_binding: "{value}", ...(code.includes(".vtt") ? { accepts: [".vtt"] } : {}) }));
    } else if (rest.includes("store_true")) {
      m.inputs.push(makeInput({ id, kind: "boolean", required: false, help, cli_binding: flag }));
    } else if (rest.includes("type=int")) {
      const range = /range\((\d+),\s*(\d+)\)/.exec(rest);
      m.inputs.push(makeInput({ id, kind: "number", required: false, help, cli_binding: `${flag} {value}`, min: range ? Number(range[1]) : null, max: range ? Number(range[2]) - 1 : null }));
    } else {
      m.inputs.push(makeInput({ id, kind: id.endsWith("dir") ? "folder" : "text", required: false, help, cli_binding: `${flag} {value}` }));
    }
  }

  const requirements = summary.includedFiles.get("requirements.txt");
  if (requirements) m.dependencies.packages = requirements.split("\n").map((l) => l.trim()).filter(Boolean);
  const assetDir = workingDirectory ? `${workingDirectory}/assets/` : "assets/";
  if (summary.assetFiles.length > 0 && summary.assetFiles.every((p) => p.startsWith(assetDir))) m.project.assets = [`${assetDir}**`];

  const notes: string[] = [];
  if (entries.length > 1) notes.push(`More than one script could be the main one (${entries.map((e) => e.path).join(", ")}); it is unclear which is meant.`);
  if (summary.truncated) notes.push("Some files could not be read in full, so details may be missing.");
  if (notes.length > 0) m.confidence = { overall: "medium", notes };
  return m;
}

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Write a project too big for the content budget: a large main.py whose
 * argparse setup and __main__ guard sit at the end, plus 40 helper modules.
 */
async function writeBigProject(dir: string): Promise<string> {
  await mkdir(path.join(dir, "helpers"), { recursive: true });
  const filler = Array.from({ length: 900 }, (_, i) => `def step_${i}(rows):\n    return [r for r in rows if r][: ${i} + 1]\n`).join("\n");
  await writeFile(
    path.join(dir, "main.py"),
    `import argparse\nfrom helpers import mod_0\n\n${filler}\n\ndef main():\n    parser = argparse.ArgumentParser()\n` +
      `    parser.add_argument("data", help="CSV file to summarise")\n` +
      `    parser.add_argument("--rows", type=int, choices=range(1, 1001), help="How many rows to show")\n` +
      `    args = parser.parse_args()\n    print(args)\n\n\nif __name__ == "__main__":\n    main()\n`,
  );
  for (let i = 0; i < 40; i++) {
    await writeFile(path.join(dir, "helpers", `mod_${i}.py`), Array.from({ length: 60 }, (_, j) => `def f_${i}_${j}(x):\n    return x * ${j}\n`).join("\n"));
  }
  return dir;
}

/** Write every file under `dir` into a deflate-compressed zip at `out`; paths are relative to `dir`. */
async function zipDirectory(dir: string, out: string): Promise<string> {
  const entries: { name: string; data: Buffer }[] = [];
  async function walk(rel: string): Promise<void> {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) entries.push({ name: child, data: await readFile(path.join(dir, child)) });
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

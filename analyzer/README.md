# SimplyOpen Analyzer

Part of SimplyOpen, our HackUMass 2026 project: a place where people who don't code can share and use the tools they've made with AI help, without touching a terminal.

The **Analyzer** takes an uploaded project zip and works out how to run it. Claude reads the project, and the Analyzer returns either:

- a **manifest** in the SimplyOpen **v0** format: the `simplyopen.json` the Runner reads (the app's name and description, which Python file to run, the controls to show, and the setting for where results are saved), plus the **project folder** in the zip it belongs in and any **notes** on what Claude had to guess; or
- a plain-English **reason the project doesn't fit v0 yet** (for example, it's a game that opens its own window).

The manifest is the only thing the Analyzer hands to the rest of SimplyOpen:

| Component | Uses the manifest to |
|---|---|
| **Runner** | draw a simple window (pick a file, type a value, pick from a list, press Run, open the results) and run the project on the person's computer |
| **Factory** | build and smoke-test the Mac and Windows downloads (using `requirements` and `sample`) |
| **Web** | render the project page |

## Scope: what v0 can describe

v0 is deliberately small. A project fits only if:

- it is **Python**, with one `.py` file to run;
- it **runs once and finishes**: takes its settings, does its job, exits;
- it does **not** open its own window (games, desktop apps), ask questions while it runs, or start a web server;
- its script has an option for **the folder to save results in** (for example `--output-dir`); the Runner makes a fresh folder for every run and passes it last;
- every setting it needs is a **file**, **text**, a **number** or **one choice from a list**, passed as `--flag value` or as a bare value by position;
- any libraries it needs beyond Python's own are listed in a **requirements file**.

Anything else is turned down with `UnsupportedProjectError` and a plain-English reason. On/off options that take no value (like `--verbose`) can't be shown, so they're left out, with a note.

The larger **1.0** format, which also covers other languages, games, interactive programs and local web apps, is saved for later in [`future/manifest-1.0/`](future/manifest-1.0/). Nothing uses it today.

## The abstraction rule

The Analyzer's entire contract with the rest of the system is the **shared v0 schema**: `manifest/manifest.schema.json` at the repository root, owned together with the Runner. [`src/manifest/schema.json`](src/manifest/schema.json) is an exact copy (a test fails if they differ once both are on the same branch), and [`src/manifest/schema.ts`](src/manifest/schema.ts) has the matching TypeScript types and every extra rule the Analyzer checks.

- The Analyzer module MUST NOT import, call, or reference anything that belongs to the Runner, Factory, or Web. It only produces the manifest they read.
- Nothing else leaves this component: an HTTP response (or, at the module level, a typed object) with a manifest that passed validation, its project folder, and notes.
- Changing the manifest means changing the shared schema, and the Runner with it. Don't add fields on the Analyzer side only.

How this repo keeps to it:

- Source files under `src/analyzer/` and `src/manifest/` import only Node built-ins, the Anthropic SDK (`@anthropic-ai/sdk`), and each other. Even JSON Schema validation is built in rather than taken from a library. (The test file additionally uses Vitest.)
- `src/manifest/schema.ts` imports nothing, so anyone can read the contract on its own.
- The model's raw reply (`rawModelOutput`) is written to the server log for debugging and never sent downstream.

## How it works

1. **Unzip** the upload into a fresh temp folder that belongs to that request only. Unsafe or broken archives are rejected: paths that escape the folder, symlinks, encryption, ZIP64, zip bombs, archives or files over 50 MB, more than 200 MB unpacked in total.
2. **Choose what Claude sees** (`projectSummary.ts`). Manifest and config files are always included in full. Images, archives, compiled files and folders like `node_modules` or `.git` are left out. Everything else is ranked (near the project root, names like `main`/`index`/`app`/`run`/`cli`, and README first) and included in full until a budget of about 12,000 tokens is used up. Files that don't fit are listed by name and size only, and the summary records exactly what was left out. For big projects, **key lines** are still pulled from code that didn't fit (entry-point guards, argument parsing, `input(` prompts, game/window/server start-up, environment variables, subprocesses, network calls). **Asset files** (images, sounds, fonts, video) are listed by name only, never read, so a sample file for `sample` can still be found.
3. **Ask Claude** (`claudeClient.ts`, prompts in `prompts.ts`). The prompt explains exactly how the Runner runs a project, asks Claude to decide first whether the project fits v0, and then either fill in the manifest or give the reason it doesn't fit. When files were left out, the prompt names them.
4. **Check the answer** (`analyzer.ts`). The manifest is validated against `schema.json`, plus the rules the schema can't express (listed in `schema.ts`): `entry`, `requirements` and sample files exist in the project folder; flags look like `--name` and are never used twice; positional inputs are required; defaults and samples are valid for their input; the name is short and the description avoids technical words.
5. **Retry once if the answer is invalid**, with the list of problems added to the prompt. If the second answer is also invalid, the Analyzer fails with `AnalysisFailedError`. It never returns a manifest that didn't pass validation. A clear "doesn't fit" answer is not retried.
6. **Clean up** the temp folder, whatever happened.

### The project folder

The Runner starts `python <entry>` from the folder that holds `simplyopen.json`, and every path in the manifest is relative to it. People often zip a project as one folder, so the Analyzer reports which folder that is as `projectFolder`: `""` for the zip's root, or e.g. `"image_resizer"`. Whatever packages the project (the Factory) should put `simplyopen.json`, and the project's files, there.

## Running it

The Analyzer lives in its own `analyzer/` folder of the repository; run every command below from inside it:

```bash
cd analyzer
```

Requirements: **Node.js 22 or later**, and Claude API credentials. The SDK reads `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`, or a profile from `ant auth login`).

```bash
npm install
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npm run dev
```

`npm run dev` starts the server with automatic reload on `http://127.0.0.1:3000`. For a production-style run:

```bash
npm run build
```

```bash
npm start
```

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to bind; use `0.0.0.0` inside a container |
| `MAX_UPLOAD_BYTES` | `52428800` (50 MiB) | Largest accepted upload |

### HTTP API

`POST /analyze` takes `multipart/form-data` with the zip in a field named `file`:

```bash
curl -F "file=@my-project.zip" http://127.0.0.1:3000/analyze
```

On success (`200`) it returns:

```json
{
  "manifest": { "manifest_version": 0, "name": "Image Resizer", "entry": "resize.py", "…": "…" },
  "name": "Image Resizer",
  "description": "Make a picture smaller or larger without stretching it.",
  "projectFolder": "",
  "notes": []
}
```

`name` and `description` repeat the manifest's own fields, for convenience. Errors return `{ "error": { "code", "message" } }`:

| Status | When |
|---|---|
| `400` | No file, or more than one file |
| `413` | Upload larger than `MAX_UPLOAD_BYTES` |
| `415` | Not a multipart request |
| `422` | The zip can't be read safely (`UnzipError`), a manifest fails validation (`SchemaValidationError`), or the project doesn't fit v0 (`UnsupportedProjectError`, whose message is the plain-English reason, safe to show the uploader) |
| `502` | Claude failed, timed out, declined, or answered invalidly twice (`ClaudeApiError`, `AnalysisFailedError`) |
| `500` | Anything else |

### Using it as a module

```ts
import { analyzeZip } from "./src/analyzer/analyzer.js";

const { manifest, projectFolder, notes } = await analyzeZip("project.zip");
```

`analyzeZip(zipPath, client?, options?)` accepts an optional `ClaudeClient` (pass a fake in tests) and `{ signal, tmpRoot }` for cancellation and the temp-folder location. It's safe to call many times at once. `manifestIssues(manifest, projectFiles, projectFolder)` runs the same checks on any manifest, for example a hand-written one.

## Testing

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` runs the Vitest suite in [`src/analyzer/analyzer.test.ts`](src/analyzer/analyzer.test.ts) against the fixtures in [`testdata/`](testdata/). Claude is mocked, so tests make no network calls and need no API key. The mock answers only from the files the Analyzer chose to show it, so the tests check the Analyzer's own job:

- **The contract**: the Runner's hand-written example manifest ([`testdata/expected/image-resizer.simplyopen.json`](testdata/expected/image-resizer.simplyopen.json)) passes every check, and `src/manifest/schema.json` is identical to the shared schema (skipped on a branch that doesn't have the shared file yet).
- **`image-resizer/`**: the Runner's own example project. The result must match the Runner's hand-written manifest: entry, requirements, the three controls with their flags and defaults, the results flag, and the sample photo.
- **Wrapped resizer** (zipped at test time as the folder `image_resizer/`): expects `projectFolder: "image_resizer"` with paths relative to it, and checks that paths written relative to the zip root instead are rejected with the fix suggested.
- **`transcript-python/`**: a Zoom-to-NVivo converter. Expects a positional file input, `--output-dir` as the results flag, and its on/off option left out with a note.
- **Big project** (generated at test time): a `main.py` too large for the budget, plus 40 modules. Checks that its key lines (the `__main__` guard and argparse calls) still reach the model, and that the notes say the view was partial.
- **Projects that don't fit v0** (`node-cli/`, `pygame-game/`, `interactive-quiz/`, `ambiguous-multi-entry/`, `wrapped-folder/`): each is turned down with `UnsupportedProjectError` and a reason, with no retry.
- **Rules**: each rule (schema patterns, missing files, flags, positional inputs, defaults, samples, wording, the answer's shape), broken once, must be rejected and explained on the retry.
- **Retry**: an invalid answer followed by a valid one, on every fixture that fits.
- **Concurrency**: five simultaneous analyses mixing two fixtures, checking that nothing leaks between them and no temp folders are left behind.

These tests do **not** measure the real model's judgment. That needs a live run against the same fixtures.

## File layout

```
src/
  manifest/
    schema.ts          The v0 contract as TypeScript types, plus the extra rules. Imports nothing.
    schema.json        Exact copy of the shared manifest/manifest.schema.json, used to validate answers.
  analyzer/
    analyzer.ts        analyzeZip(): unzip → summarize → ask Claude → validate → retry once.
    analyzer.test.ts   Vitest suite (Claude mocked).
    claudeClient.ts    The Claude API call, behind a small ClaudeClient interface.
    prompts.ts         System prompt and per-project prompt text.
    projectSummary.ts  Safe zip extraction and the "what Claude sees" heuristic.
    types.ts           ProjectSummary and related shared types.
    errors.ts          AnalyzerError and its subclasses.
  server.ts            HTTP server (Fastify): POST /analyze. HTTP plumbing only.
testdata/              Fixture projects used by the tests, plus expected manifests.
examples/              Real project zips to try by hand with curl (not used by the tests).
future/manifest-1.0/   The larger manifest format, saved for later (not used).
```

All paths above are inside the `analyzer/` folder.

## Known limitations

- **v0 turns down many projects**: anything not in Python, games and other windowed apps, programs that ask questions while they run, local web apps, and scripts with no results-folder option.
- **Several files at once, folders and on/off switches can't be shown.** A setting that takes several files lets the person pick one; on/off options are left out.
- **A project with libraries but no requirements file is turned down**, because the Runner can't install what isn't listed.
- **`sample` is only given when the project ships a usable sample file.**
- **Whether a project fits is the model's call.** The code checks every manifest it returns, but it can't check a "doesn't fit" answer.
- **The server has no authentication or rate limiting**, and every request makes a paid Claude call. Don't expose it publicly as is.

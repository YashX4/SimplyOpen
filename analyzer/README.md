# SimplyOpen Analyzer

Part of SimplyOpen, our HackUMass 2026 project: a place where people who don't code can share and use the tools they've made with AI help, without touching a terminal.

The **Analyzer** takes an uploaded project zip and works out how to run it. Claude reads the project and the Analyzer returns:

- a **manifest**: a fixed-format JSON description of how to run the project (which file to start, what the person has to provide, what comes out, what it needs installed, what it can reach, and how sure the Analyzer is);
- a plain-English **name** (up to 60 characters) and **description** ("What it does", up to 200 characters) written for people who have never coded;
- a **status**: facts, worked out by code rather than Claude, for the project page's "Read the files" and "Checked for leaked keys" lines.

The manifest is the only thing the Analyzer hands to the rest of SimplyOpen. Three other components are built against it in parallel:

| Component | Uses the manifest to |
|---|---|
| **Runner** | draw a simple window (pick files, press Run, open results) and run the project on the person's computer |
| **Factory** | build and smoke-test the Mac and Windows downloads |
| **Web** | render the project page, including what the project can access |

## Scope

This Analyzer currently handles **one project kind: "app or tool"**: a script or small program meant to run on the person's own computer, in **any language it can detect signals for** (file extensions, shebang lines, and files like `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`).

It does **not** yet handle:

- web-page projects,
- Claude artifacts,
- prompt or skill projects,
- static file or template uploads.

Those are out of scope until a future version of the manifest schema adds project kinds for them. Every manifest today has `"project_kind": "app_or_tool"`.

## The abstraction rule

The Analyzer's entire contract with the rest of the system is the manifest schema ([`src/manifest/schema.ts`](src/manifest/schema.ts), with its runtime twin [`src/manifest/schema.json`](src/manifest/schema.json)). This is non-negotiable:

- The Analyzer module MUST NOT import, call, or reference anything that belongs to the Runner, Factory, or Web. It has no knowledge of Electron, bundled Python runtimes, GitHub Actions, or any specific OS packaging mechanism — those are downstream concerns.
- The only valid output of this service is: an HTTP response (or, at the module level, a typed object) containing a manifest conforming to the schema, plus a name and description string and the status facts. Nothing else leaves this component.
- If the manifest needs a new field, add it to the schema definition itself, with a comment explaining why — never bolt on an undocumented field to satisfy a "wouldn't it be convenient" instinct.
- Treat the manifest type as a versioned public interface, since Runner, Factory, and Web are being coded against it concurrently. A hidden assumption here breaks three other people's work silently.

How this repo keeps to it:

- Source files under `src/analyzer/` and `src/manifest/` import only Node built-ins, the Anthropic SDK (`@anthropic-ai/sdk`), and each other. Even JSON Schema validation is built in rather than taken from a library. (The test file additionally uses Vitest.)
- `src/manifest/schema.ts` imports nothing, so anyone can read the contract on its own.
- The HTTP response contains only `manifest`, `name`, `description` and `status`. The model's raw reply (`rawModelOutput`) is written to the server log for debugging and never sent downstream.

## How it works

1. **Unzip** the upload into a fresh temp folder that belongs to that request only. Unsafe or broken archives are rejected: paths that escape the folder, symlinks, encryption, ZIP64, zip bombs, archives or files over 50 MB, more than 200 MB unpacked in total.
2. **Check for leaked keys** (`secretScan.ts`, plain code, no AI). Every text file is scanned for well-known key formats (Anthropic, OpenAI, AWS, GitHub, Google, Slack, Stripe and Hugging Face keys, private keys, passwords inside web addresses) and for secret-sounding settings in `.env` files (examples and templates are skipped). Findings give the file, line and kind of key, never the key itself.
3. **Choose what Claude sees** (`projectSummary.ts`). Manifest and config files are always included in full. Images, archives, compiled files and folders like `node_modules` or `.git` are left out. Everything else is ranked (near the project root, names like `main`/`index`/`app`/`run`/`cli`, and README first) and included in full until a budget of about 12,000 tokens is used up. Files that don't fit are listed by name and size only, and the summary records exactly what was left out. For big projects, **key lines** are still pulled from code that didn't fit (entry-point guards, argument parsing, `input(` prompts, game/window/server start-up, environment variables, subprocesses, network calls), so the project's shape stays visible. **Asset files** (images, sounds, fonts, video) are listed by name only, never read.
   Any leaked key is blanked out (`[REDACTED OpenAI API key]`) before anything is sent to Claude.
4. **Ask Claude** (`claudeClient.ts`, prompts in `prompts.ts`). The prompt tells Claude not to assume any language, to list every plausible entry point and pick the primary one, and to lower confidence whenever it's unsure. When files were left out, the prompt names them.
5. **Check the answer** (`analyzer.ts`). The manifest is validated against `schema.json`, plus the consistency rules the schema can't express (listed in `schema.ts`): unique ids, a primary that matches a real entry point, entry-point paths and script files in `run_command` that exist, sensible placeholders and bindings, and paths that stay inside the project. The name must be at most 60 characters, and the description at most 200 characters and free of technical words.
6. **Retry once if the answer is invalid**, with the list of problems added to the prompt. If the second answer is also invalid, the Analyzer fails with `AnalysisFailedError`. It never returns a manifest that didn't pass validation.
7. **Clean up** the temp folder, whatever happened.

### The status

`status` holds facts only; the website's own templates turn them into sentences, so the wording can never oversell.

```json
"status": {
  "readTheFiles": { "complete": true, "filesRead": 3, "filesNotRead": 0, "filesSkippedByDesign": 1 },
  "leakedKeys": {
    "complete": true, "filesChecked": 3, "filesNotChecked": 0, "totalFound": 1,
    "found": [{ "path": "config.py", "line": 4, "kind": "OpenAI API key" }]
  }
}
```

- **`readTheFiles`**: `complete` is true when Claude read every code and text file in full. `filesNotRead` counts files left out for size; `filesSkippedByDesign` counts images, sounds, archives and dependency or cache folders, which are never read.
- **`leakedKeys`**: `complete` is true when every text file was scanned (text files over 2 MB aren't). `found` lists up to 50 findings; `totalFound` counts them all. An upload with leaked keys is still analyzed: deciding what to do about them is up to the website.

The confidence field (`confidence.overall`: `high`, `medium` or `low`, plus plain-English `notes`) is how the Analyzer says "don't trust my details here". When it isn't `high`, the Runner should use its generic pick-files-and-run window instead of the specific one the manifest describes.

## What the manifest can describe

Each entry point has an **`interface`** telling the Runner how to present the running program:

| `interface.kind` | Examples | What the manifest adds for the Runner |
|---|---|---|
| `command_line` | converters, cleaners, report generators | runs, shows progress, finishes on its own |
| `own_window` | PyGame/arcade games, Tkinter/Qt/Electron apps | `controls` (e.g. "Move left: Left arrow, A") for a how-to-play card; runs until closed |
| `interactive_terminal` | quizzes, menus, programs using `input()` | `prompts`: the questions it asks, in order, with answer type and choices |
| `local_server` | Flask, FastAPI, Streamlit, Gradio, Express | `server`: default port, how to set it (`port_binding`, rendered into `{port}`), path to open, and the "ready" text to wait for |

Inputs can be files (one or `multiple`), folders, text, numbers (with `min`/`max`), choices or on/off switches, each with plain-English `help`. Values reach the program through `cli_binding` (command line) or `env_binding` (an environment variable, e.g. an API key marked `secret` so it's masked). Outputs can be files, folders, or `console` text. The project also lists runtime `assets` (sprites, sounds, levels), an optional `build_command`, system tools (e.g. `ffmpeg`), supported operating systems, and whether it starts other programs.

Each entry point also has a **`working_directory`**: the folder to start it from. When a project was zipped as a folder (e.g. `star-game/`), the entry point is `star-game/main.py` but it runs from `star-game` as `python main.py`, so files it opens relative to itself (sprites, data) are found. Archive paths (`path`, `working_directory`, `assets`) are relative to the zip root; file names inside `run_command` are relative to `working_directory`.

Everything is in [`src/manifest/schema.ts`](src/manifest/schema.ts), including the exact rendering rules and the full list of consistency rules every manifest is checked against (for example: files named in `run_command` exist from `working_directory`, inputs with a `cli_binding` need `{args}`, servers with a `port_binding` need `{port}`, every `env_binding` appears in `reads_env_vars`).

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

To try a real project, use one of the zips in `examples/`:

```bash
curl -F "file=@examples/raycaster-starter-project.zip" http://127.0.0.1:3000/analyze
```

On success (`200`) it returns `{ "manifest": { … }, "name": "…", "description": "…", "status": { … } }`. Errors return `{ "error": { "code", "message" } }`:

| Status | When |
|---|---|
| `400` | No file, or more than one file |
| `413` | Upload larger than `MAX_UPLOAD_BYTES` |
| `415` | Not a multipart request |
| `422` | The zip can't be read safely (`UnzipError`), or a manifest fails validation (`SchemaValidationError`) |
| `502` | Claude failed, timed out, declined, or answered invalidly twice (`ClaudeApiError`, `AnalysisFailedError`) |
| `500` | Anything else |

### Using it as a module

```ts
import { analyzeZip } from "./src/analyzer/analyzer.js";

const { manifest, name, description, status } = await analyzeZip("project.zip");
```

`analyzeZip(zipPath, client?, options?)` accepts an optional `ClaudeClient` (pass a fake in tests) and `{ signal, tmpRoot }` for cancellation and the temp-folder location. It's safe to call many times at once.

## Testing

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` runs the Vitest suite in [`src/analyzer/analyzer.test.ts`](src/analyzer/analyzer.test.ts) against the fixtures in [`testdata/`](testdata/). Claude is mocked, so tests make no network calls and need no API key. The mock answers only from the files the Analyzer chose to show it, so the tests check the Analyzer's own job:

- **`transcript-python/`**: a single Python script that converts Zoom transcripts for NVivo. Expects Python, one primary entry point, and a required transcript-file input.
- **`node-cli/`**: a small Node project with a `package.json` `main` field and two scripts. Expects Node, several entry points, and the primary matching `main`.
- **`ambiguous-multi-entry/`**: two equally plausible Python scripts and nothing to say which is the main one. Expects confidence below `high`, with a note explaining why.
- **`pygame-game/`**: a PyGame game with sprites and a sound. Expects an `own_window` interface that runs until closed, its keyboard controls, `assets/**`, and the `pygame` package; checks the asset files were named but never read.
- **`interactive-quiz/`**: a program that asks questions with `input()`. Expects an `interactive_terminal` interface listing the questions in order, with their answer types.
- **`wrapped-folder/`**: a small game zipped as a folder (`star-game/`). Expects `working_directory: "star-game"` and `run_command: "python main.py {args}"`, and checks that a command written relative to the wrong folder is rejected with the fix suggested.
- **Big project** (generated at test time): a `main.py` too large for the budget, plus 40 modules. Checks that `main.py`'s key lines (its `__main__` guard and argparse calls) still reach the model, and that confidence drops with a note.
- **Status** (projects generated at test time, with fake keys assembled at run time so none are committed): each leaked key is found by file, line and kind and never reported itself; keys are blanked out of everything sent to Claude, including key lines from files too big to send whole; example `.env` files are left alone; a clean project reports everything read and checked; a big project reports a partial read; a text file too big to scan makes the check incomplete. Also: a description over 200 characters is rejected on the retry.
- **Contract rules**: each rule JSON Schema can't express (placeholders, bindings, `server`/`prompts` consistency, number limits, choice defaults, output paths), broken once, must be rejected and explained on the retry.
- **Retry**: an invalid answer followed by a valid one, on every fixture.
- **Concurrency**: five simultaneous analyses mixing two fixtures, checking that nothing leaks between them and no temp folders are left behind.

These tests do **not** measure the real model's judgment. That needs a live run against the same fixtures.

## File layout

```
src/
  manifest/
    schema.ts          The shared contract (TypeScript types). Imports nothing.
    schema.json        The same contract as JSON Schema, used to validate answers.
  analyzer/
    analyzer.ts        analyzeZip(): unzip → summarize → ask Claude → validate → retry once.
    analyzer.test.ts   Vitest suite (Claude mocked).
    claudeClient.ts    The Claude API call, behind a small ClaudeClient interface.
    prompts.ts         System prompt and per-project prompt text.
    projectSummary.ts  Safe zip extraction and the "what Claude sees" heuristic.
    secretScan.ts      The leaked-key check, and blanking keys out before Claude sees them.
    types.ts           ProjectSummary and related shared types.
    errors.ts          AnalyzerError and its subclasses.
  server.ts            HTTP server (Fastify): POST /analyze. HTTP plumbing only.
testdata/              Fixture projects used by the tests.
examples/              Real project zips to try by hand with curl (not used by the tests).
```

All paths above are inside the `analyzer/` folder.

## Known limitations

- **Not yet run against the live Claude API.** Everything above is tested with Claude mocked. The first real runs may surface issues (for example, the API rejecting the tool schema, or answers that are slightly off and keep getting rejected).
- **Confidence comes from the model.** No code-level checks lower it yet when the doubt is obvious (files left out, an input with no `cli_binding`, several runnable scripts).
- **Capabilities are taken from the model's reading of the code**, not cross-checked.
- **The leaked-key check only knows well-known key formats.** It can miss a key in a format it doesn't know, or a password written straight into code, and it can't read compressed files such as git history.
- **Alternate entry points have no inputs of their own.** `inputs` describe the primary entry point only.
- **Interactive programs whose questions branch** on earlier answers can only list the first questions in `prompts`.
- **The server has no authentication or rate limiting**, and every request makes a paid Claude call. Don't expose it publicly as is.

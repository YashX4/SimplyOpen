# SimplyOpen

Our HackUMass 2026 project.

SimplyOpen lets people who don't code use small programs that other people have made. A maker uploads a Python project. SimplyOpen works out how to run it, wraps it in a simple window, and builds a desktop app that anyone can download and open. There is no terminal, nothing to install, and the user's files never leave their computer.

## How it works

```
Upload a project  →  Analyzer  →  Factory  →  Download  →  Runner
                     reads the    builds and   one app     the app the
                     code with    tests the    per         user opens
                     Claude       app          system
```

1. **Analyzer.** Claude reads the uploaded project and writes a *manifest*: which file to start, what the user has to provide, where results appear, and which libraries it needs. It also writes a plain-English name and description.
2. **Factory.** Packs three things into one app: the Runner, a private copy of Python with the project's libraries, and the project itself. It then starts the app and runs it once on sample inputs, and only releases it if that works.
3. **Runner.** The app the user opens. It reads the manifest, draws a form with one control per input, runs the project when the user clicks Run, shows progress, and opens the results.
4. **Chat.** A maker can ask Claude, in plain words, to change a project's code. Each change becomes a version they can undo, and the result goes back through the Factory.

The manifest is the contract between the parts. Its format is defined once, in [analyzer/src/manifest/schema.ts](analyzer/src/manifest/schema.ts), and everything else reads that definition.

## What works today

| Part | Folder | Status |
|---|---|---|
| Analyzer | [analyzer/](analyzer/) | Working. See [its README](analyzer/README.md). |
| Runner | [runner/](runner/) | Working for Python programs that take their inputs up front, do their job, and finish, and for web pages and React components (Claude artifacts), which it shows in the app's window. |
| Factory | [.github/workflows/build.yml](.github/workflows/build.yml) | Builds and tests apps for Mac (Apple Silicon), Windows and Linux. |
| Chat | [chat/](chat/) | Working as its own service. See [its README](chat/README.md). |
| Website | [web/](web/) | Working, and live at [www.simplyopen.us](https://www.simplyopen.us). Upload a project, watch it build, download the apps. See [its README](web/README.md) and [DEPLOY.md](DEPLOY.md). |

Not supported yet:

- Projects in languages other than Python, apart from web pages and React components.
- React components that use Claude's built-in interface pieces (imports starting with `@/components/`), or that are spread over more than one file.
- Games, programs with their own window, web servers, and programs that ask questions while they run. The Analyzer can describe these, and the Runner tells the user plainly that it can't open them yet.
- Signed apps. Mac and Windows show an "unidentified developer" warning the first time a downloaded app is opened.

## Try it

You need [Node.js](https://nodejs.org) 22 or newer. All commands below run from the `runner` folder.

```
cd runner
npm install
```

### Open the example in development

This uses the Python already on your computer, so it needs Python 3 and the example's one library:

```
pip install -r ../examples/image_resizer/requirements.txt
npm run dev
```

A window titled "Image Resizer" opens. Choose a picture (there is one in `examples/image_resizer/sample/`), choose a folder to save into, and click **Run**.

Use the window that opens. The web address printed in the terminal only works inside that window.

### Build the real app

These three commands are what the Factory runs. They need no Python on your computer.

```
npm run stage
npm run package
npm run smoke
```

- `stage` downloads a private Python, installs the project's libraries into it, and gathers the project.
- `package` builds the app into `runner/dist/`.
- `smoke` starts the built app in its hidden test mode and prints `SMOKE TEST PASSED` if it ran the project's sample inputs successfully.

Then open the app from `runner/dist/` by double-clicking it.

### Build an app from an uploaded project

Given a project zip and the Analyzer's answer for it (each a file or a web address):

```
npm run fetch-project -- project.zip analyzer-result.json
npm run stage -- resources/upload
npm run package
npm run smoke
```

### Run the checks

```
npm test
```

The same command works in `analyzer/` and `chat/`.

## The Factory on GitHub

The workflow in [.github/workflows/build.yml](.github/workflows/build.yml) runs the steps above on a Mac, a Windows and a Linux machine. It starts when the Runner or the examples change, or by hand from the repository's **Actions** tab, where you can give it an uploaded project's web addresses. Finished apps appear under **Artifacts** on the run's page. Builds started by hand or by the website are also published to the repository's **Releases** page as `build-<build_id>`, where anyone can download them without logging in. [examples/upload_test/](examples/upload_test/) has a ready-made project to try this with.

The build installs and runs uploaded code, so it has no permission to change the repository and holds no passwords or keys.

## What's in this repository

```
analyzer/                   Reads a project and writes its manifest (uses Claude)
chat/                       Changes a project's code by talking to Claude
runner/                     The desktop app (Electron, React, TypeScript)
  src/shared/               Turns a manifest and the user's answers into a command
  src/main/                 Reads the manifest, runs the project, the hidden test mode
  src/renderer/             The window the user sees
  scripts/                  The Factory's steps: fetch-project, stage, smoke-test
web/                        The website: its server (src/) and its pages (client/)
examples/                   Sixty sample projects, each with its manifest and sample inputs
  uploads/                  The same projects as zips, ready to upload on the website
.github/workflows/          The Factory
dev.sh                      Starts the analyzer, chat and website together on your computer
```

## A project's two files

Each project the Runner opens has these at its top level:

- `simplyopen.json`: the Analyzer's answer for the project, holding `manifest`, `name` and `description`. See [the example](examples/image_resizer/simplyopen.json).
- `simplyopen.sample.json` (optional): known-good inputs for the Factory's test run. See [the example](examples/image_resizer/simplyopen.sample.json). Without it, the Factory only checks that the app loads and its Python starts.

## License

[MIT](LICENSE)

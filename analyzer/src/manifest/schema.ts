/**
 * @file SimplyOpen manifest — SHARED CONTRACT.
 *
 * SCOPE: this schema covers ONE project kind only, `"app_or_tool"`: a
 * standalone script or small program meant to run on the person's own
 * computer (Python, Node, Go, a shell script, a PyGame game, a small local
 * web app, …). It does NOT cover web pages, Claude artifacts, prompts/skills,
 * or static files/templates. Those are separate project kinds handled
 * elsewhere and will get their own `project_kind` values. Do not assume this
 * schema describes every upload.
 *
 * The manifest is the only thing the Analyzer hands to the rest of the
 * system. Three other components are being built IN PARALLEL against this
 * file:
 *
 *   - Runner  — draws a window from `inputs`/`outputs`, runs the project, and
 *               presents it according to each entry point's `interface`.
 *   - Factory — builds the Mac/Windows downloads from `project`/`dependencies`.
 *   - Web     — renders the project page (including `capabilities`).
 *
 * DO NOT CHANGE THIS FILE (field names, types, or field meanings) without
 * coordinating with the owners of the Runner, the Factory, and Web. Any
 * change must be mirrored in `schema.json` (the runtime validator) and must
 * bump `schema_version`.
 *
 * This file has no imports and no dependencies on the rest of the project,
 * so it can be read on its own.
 *
 * Conventions every consumer relies on (documented here so there are no
 * hidden assumptions):
 *   - Two kinds of path, never mixed:
 *       - WHERE SOMETHING IS IN THE ZIP: `EntryPoint.path`, `EntryPoint.working_directory`
 *         and `Project.assets` are relative to the root of the uploaded
 *         archive, with forward slashes and no leading `./` or `/`.
 *       - WHAT THE PROGRAM SEES AT RUNTIME: an entry point runs with its
 *         working directory set to `<archive root>/<working_directory>`
 *         (just the archive root when `working_directory` is `""`). File
 *         names inside its `run_command`, and output `path_pattern`s without
 *         an input placeholder, are relative to that working directory.
 *     Example: a project zipped as a folder `star-game/` with `star-game/main.py`
 *     has `path: "star-game/main.py"`, `working_directory: "star-game"`,
 *     `run_command: "python main.py {args}"`.
 *   - Invocation mechanics live ONLY in three fields: `Input.cli_binding`,
 *     `Input.env_binding`, and `ServerInfo.port_binding`. Every other field
 *     describes WHAT something is, never HOW it is passed to the program.
 *   - In `run_command`, `{args}` stands for the rendered `cli_binding` of
 *     each input that has a value, in `inputs` order, separated by spaces.
 *     For a local server, `{port}` (if present) stands for the rendered
 *     `port_binding`. No other placeholders exist.
 *   - In `cli_binding`, `{value}` stands for the input's value, passed as a
 *     single argument (never split on spaces). A boolean's `cli_binding` has
 *     no `{value}`: it is added as-is when the switch is on. For a file input
 *     with `multiple: true`, the binding is rendered once per chosen file.
 *   - `env_binding` names an environment variable set to the input's value
 *     when the program starts (e.g. an API key).
 *   - `inputs` and `outputs` describe running the PRIMARY entry point.
 *     Nothing in this version says which inputs an alternate entry point
 *     takes, so consumers should not assume they apply to alternates.
 *
 * Rules JSON Schema cannot express, which validators must check in code:
 *   - `EntryPoint.id` values are unique within `project.entry_points`.
 *   - `project.primary_entry_point` equals the `id` of one of them.
 *   - `Input.id` values are unique; `Output.id` values are unique.
 *   - A non-boolean `cli_binding` contains `{value}` exactly once; a boolean's contains none.
 *   - A `choice` input's `default`, if set, is one of its `choices`.
 *   - `multiple` is `true` only for `file` inputs; `min`/`max` are non-null only for `number` inputs,
 *     and `min` is not greater than `max`.
 *   - `{<input id>}` placeholders in `path_pattern` name existing inputs;
 *     `path_pattern` is `null` exactly when the output's kind is `"console"`.
 *   - `interface.server` is non-null exactly when `interface.kind` is `"local_server"`;
 *     `interface.prompts` is empty unless the kind is `"interactive_terminal"`.
 *   - `{port}` appears in a `run_command` only for a local server with a `port_binding`,
 *     and a server with a `port_binding` has `{port}` in its `run_command`.
 *   - `working_directory` is `""` or a folder that exists in the project; every
 *     script file named in a `run_command` exists relative to it (unless
 *     `build_command` creates it).
 *   - Archive paths (`path`, `working_directory`, `assets`) have no leading `/`
 *     or `./`, no `..`, and no backslashes; output paths stay inside the project.
 *   - If any input has a `cli_binding`, the primary entry point's `run_command` contains `{args}`.
 *   - Every `env_binding` is also listed in `capabilities.reads_env_vars`.
 *   - `accepts` entries are lower-case extensions starting with a dot.
 *   - A required input with neither binding means `confidence.overall` is not `"high"`.
 */

/**
 * Root of the contract: everything another component needs to know to run,
 * package, and describe one `"app_or_tool"` project.
 */
export interface Manifest {
  /**
   * Version of this contract the manifest conforms to. Currently `"1.0"`.
   * Consumers should reject versions they do not understand.
   */
  schema_version: string;
  /**
   * Which kind of project this manifest describes. Only `"app_or_tool"`
   * exists for now (see the scope note in the file comment). It will be
   * widened to a union as other kinds (web pages, artifacts, …) get their
   * own schemas; consumers should switch on it rather than assume it.
   */
  project_kind: "app_or_tool";
  /** What to run and in which language. */
  project: Project;
  /**
   * What the person supplies before pressing Run, in the order they are
   * shown in the window and rendered into `{args}` of the primary entry point.
   */
  inputs: Input[];
  /** What the person can see or open after running the primary entry point. */
  outputs: Output[];
  /** What must be installed for the project to run. */
  dependencies: Dependencies;
  /** What the project can reach (network, files, environment variables, other programs). */
  capabilities: Capabilities;
  /**
   * How far the rest of this manifest can be trusted. The Runner uses this
   * to decide between drawing the specific window described by `inputs`
   * and falling back to a generic "pick files, press Run, see results"
   * window when the Analyzer was unsure. See {@link Confidence}.
   */
  confidence: Confidence;
}

/** What the project is written in and how it can be started. */
export interface Project {
  /**
   * Programming language, lower case, e.g. `"python"`, `"node"`, `"go"`,
   * `"shell"`.
   *
   * Deliberately a free string, not an enum: supporting a new language
   * must not require a schema change. Consumers must treat a value they
   * don't recognise as "unknown language" and fall back to generic
   * handling — never reject the manifest because of it.
   */
  language: string;
  /** Minimum language version needed, e.g. `"3.11"` or `"20"`; `null` if unknown. */
  language_version: string | null;
  /**
   * Every way this project can be started. Always at least one.
   *
   * An array because a project may contain more than one runnable script
   * (e.g. a converter plus a separate clean-up tool, or a game plus a level
   * editor). The Runner needs the full list so it can run the default one
   * and offer the rest as optional alternates. `primary_entry_point` says
   * which one is the default.
   */
  entry_points: EntryPoint[];
  /**
   * `id` of the entry point in `entry_points` to run by default (the one
   * the Run button starts). Every other entry point is an optional alternate.
   */
  primary_entry_point: string;
  /**
   * A command to run once before any entry point, e.g. `"cargo build --release"`
   * or `"npm run build"`; `null` if none is needed. Installing `dependencies`
   * is NOT a build step and never appears here.
   */
  build_command: string | null;
  /**
   * Non-code files the program loads while running (images, sounds, fonts,
   * levels, data), as paths or globs relative to the archive root, e.g.
   * `["assets/**", "levels/level1.json"]`. Packaging must keep them next to
   * the code. Empty if there are none.
   */
  assets: string[];
}

/** One runnable file in the project. */
export interface EntryPoint {
  /** Identifier, unique within `entry_points`; referenced by `primary_entry_point`. */
  id: string;
  /**
   * Path of the file or executable to run, relative to the root of the
   * uploaded archive, e.g. `"main.py"` or `"my-tool/run.sh"`.
   */
  path: string;
  /**
   * Folder to start the program from, relative to the archive root: `""`
   * for the root itself, or e.g. `"star-game"` when the project was zipped
   * as a folder. Programs often open files (sprites, data) relative to where
   * they were started, so this must be the folder the code expects.
   */
  working_directory: string;
  /**
   * Command template, run from `working_directory`, e.g.
   * `"python main.py {args}"`, `"node index.js {args}"`, or
   * `"./run.sh {args}"`. `{args}` (and, for a local server, `{port}`) are the
   * only placeholders (see the file comment). `null` if the Analyzer could
   * not tell how to start this entry point.
   */
  run_command: string | null;
  /**
   * Plain-English description of what this entry point does, for people
   * who have never coded, e.g. "Converts transcripts to NVivo format".
   * The Runner can show it when offering alternates.
   */
  description: string;
  /** How the person interacts with the program once it has started. */
  interface: Interface;
}

/**
 * The ways a running program can present itself:
 * - `"command_line"`: takes its inputs, does its job, prints and/or writes
 *   files, then exits. The Runner shows a progress/log view.
 * - `"own_window"`: opens its own window (a PyGame game, a Tkinter or Qt app,
 *   an Electron app). The Runner just launches it, can show its `controls`,
 *   and offers a Stop button.
 * - `"interactive_terminal"`: asks the person questions while it runs
 *   (`input()`, menus). The Runner shows a console the person can type into,
 *   and can show the expected `prompts` up front.
 * - `"local_server"`: starts a web app on the person's computer (Flask,
 *   Streamlit, a Node server). The Runner starts it, waits until it is ready,
 *   and opens the browser at its address.
 */
export type InterfaceKind = "command_line" | "own_window" | "interactive_terminal" | "local_server";

/** How one entry point behaves once started. */
export interface Interface {
  /** Which of the presentations above applies. */
  kind: InterfaceKind;
  /**
   * `true` if the program finishes by itself (most command-line tools);
   * `false` if it keeps running until the person closes it (games, windowed
   * apps, servers). The Runner shows a Stop button when `false`.
   */
  exits_on_its_own: boolean;
  /**
   * Keyboard and mouse controls, for a "how to play / how to use" card.
   * Mainly for `"own_window"`; empty when there are none or they're unknown.
   */
  controls: Control[];
  /**
   * Questions the program asks while running, in the order it asks them.
   * Only for `"interactive_terminal"`; empty otherwise. A program whose
   * questions depend on earlier answers may list only the first ones.
   */
  prompts: TerminalPrompt[];
  /** Details for a `"local_server"`; `null` for every other kind. */
  server: ServerInfo | null;
}

/** One control in a game or windowed app. */
export interface Control {
  /** What it does, in plain English, e.g. "Move left", "Jump", "Pause". */
  action: string;
  /** Keys or buttons, in plain English, e.g. `["Left arrow", "A"]`, `["Space"]`, `["Mouse click"]`. */
  keys: string[];
}

/** One question an interactive program asks. */
export interface TerminalPrompt {
  /** The question as the program prints it, or a close paraphrase, e.g. "How many players?". */
  question: string;
  /** What kind of answer it expects. */
  kind: "text" | "number" | "choice" | "yes_no";
  /** The accepted answers for `"choice"`; empty otherwise. */
  choices: string[];
}

/** How to reach a local web app. */
export interface ServerInfo {
  /** Port it listens on by default, e.g. `5000` or `8501`; `null` if unknown. */
  port: number | null;
  /**
   * How to choose the port, rendered in place of `{port}` in `run_command`,
   * with `{value}` standing for the port number, e.g. `"--port {value}"`;
   * `null` if the port can't be chosen.
   */
  port_binding: string | null;
  /** Path to open in the browser, e.g. `"/"`. */
  url_path: string;
  /**
   * Text the program prints once it's ready to accept requests, e.g.
   * `"Running on http://"`; `null` if unknown (the Runner then waits for the
   * port to open).
   */
  ready_text: string | null;
}

/** One thing the person provides before running (one control in the window). */
export interface Input {
  /** Identifier, unique within the manifest. */
  id: string;
  /**
   * Which control to draw:
   * - `"file"`: pick a file (or several, if `multiple`)
   * - `"folder"`: pick a folder
   * - `"text"`: type free text
   * - `"number"`: enter a number (bounded by `min`/`max` when set)
   * - `"choice"`: pick one of `choices`
   * - `"boolean"`: an on/off switch
   */
  kind: "file" | "folder" | "text" | "number" | "choice" | "boolean";
  /** Plain-English label shown next to the control, e.g. "Zoom transcript file". */
  label: string;
  /** Plain-English hint shown under or beside the control (e.g. from argparse `help=`); `null` if none. */
  help: string | null;
  /** Whether Run stays disabled until this input has a value. */
  required: boolean;
  /** Accepted file extensions, e.g. `[".vtt", ".txt"]`. Omitted means any file. */
  accepts?: string[];
  /** Whether the person may pick several files at once. Always `false` unless `kind` is `"file"`. */
  multiple: boolean;
  /** The allowed values. Only for `kind === "choice"`, where it is required. */
  choices?: string[];
  /** Smallest allowed value for a `"number"`; `null` otherwise or if unbounded. */
  min: number | null;
  /** Largest allowed value for a `"number"`; `null` otherwise or if unbounded. */
  max: number | null;
  /**
   * Whether the value is sensitive (a password or API key). The Runner masks
   * it and must never log it.
   */
  secret: boolean;
  /**
   * How this input reaches the program's command line, e.g.
   * `"--input {value}"`, `"{value}"` for a positional argument, or
   * `"--verbose"` for a boolean switch. `null` if it is not passed on the
   * command line. One of the only three invocation-mechanics fields.
   */
  cli_binding: string | null;
  /**
   * Name of the environment variable that carries this input, e.g.
   * `"OPENAI_API_KEY"`; `null` if none. One of the only three
   * invocation-mechanics fields.
   */
  env_binding: string | null;
  /** Value to pre-fill in the control, if the program has a default. */
  default?: unknown;
}

/** One result the person can see or open after a run. */
export interface Output {
  /** Identifier, unique within the manifest. */
  id: string;
  /**
   * What kind of result it is:
   * - `"file"` / `"folder"`: something written to disk, found via `path_pattern`;
   * - `"console"`: text the program prints, which the Runner shows on screen.
   */
  kind: "file" | "folder" | "console";
  /** Plain-English label, e.g. "NVivo-ready transcript". */
  label: string;
  /**
   * Where a file or folder result appears, e.g. `"output/*.docx"` or
   * `"{output_dir}/*.txt"`; `null` for a `"console"` result.
   */
  path_pattern: string | null;
}

/** What must be installed for the project to run. */
export interface Dependencies {
  /** Language runtime requirements, e.g. `["python>=3.10"]` or `["node>=20"]`. */
  runtime: string[];
  /**
   * Third-party packages in the language's own requirement syntax, e.g.
   * `["pandas==2.1.0"]` (pip) or `["lodash@4.17.21"]` (npm).
   */
  packages: string[];
  /**
   * Programs or system libraries that must exist outside the language's
   * package manager, in plain names, e.g. `["ffmpeg"]`, `["tesseract"]`.
   * Empty if none.
   */
  system: string[];
  /**
   * Operating systems the project can run on. All three unless the code is
   * tied to one (e.g. uses Windows-only APIs or macOS-only commands).
   */
  operating_systems: ("macos" | "windows" | "linux")[];
}

/**
 * What the project can reach. Web explains this in plain English on the
 * project page.
 */
export interface Capabilities {
  /** Whether the code can talk to the internet. */
  network_access: boolean;
  /**
   * Which files the code can touch:
   * - `"none"`: no files at all
   * - `"declared_inputs_outputs_only"`: only the declared inputs, outputs and its own assets
   * - `"broad"`: other locations too (home folder, fixed paths, …)
   */
  filesystem_access: "none" | "declared_inputs_outputs_only" | "broad";
  /** Names of environment variables the code reads, e.g. `["API_KEY"]`. */
  reads_env_vars: string[];
  /** Whether the code starts other programs (e.g. `subprocess`, `child_process`, `os.system`). */
  runs_other_programs: boolean;
}

/**
 * How sure the Analyzer is about this manifest.
 *
 * This is load-bearing, not cosmetic: the Runner uses it to fall back to a
 * generic "pick files, press Run, see results" window instead of drawing a
 * specific window that might be wrong. The Analyzer must lower it (and add
 * a note) whenever it is unsure about an input's required-ness, kind, or
 * binding, about which entry point is the primary one, or about how the
 * program presents itself — it never silently defaults to `"high"`.
 */
export interface Confidence {
  /**
   * - `"high"`: everything was read directly from the code; the Runner can
   *   draw the specific window.
   * - `"medium"`: should run, but some details were inferred.
   * - `"low"`: the Runner should use the generic fallback window.
   */
  overall: "high" | "medium" | "low";
  /** Plain-English notes explaining each uncertainty, for people and for logs. */
  notes: string[];
}

# SimplyOpen Chat

Part of SimplyOpen, our HackUMass 2026 project. This is the chat from **section 6.5, "Changing it with the chatbot"**: a person who doesn't code gets their own private copy of a project, then tells Claude in their own words what to change ("put speaker names in brackets"). Claude reads the project's code, makes the change, and the change is checked automatically. Every change becomes a version labelled in their words. They can undo or go back to any version, and when they're happy they download it. **The chat is the code editor.**

## What section 6.5 asks for, and where it is

| Section 6.5 | Here |
|---|---|
| "Make my copy" gives a private copy instantly | `POST /sessions` unpacks the uploaded project into a private folder for that session; it starts as version 0, "Your copy". |
| They type what they want in their own words; the AI reads the code and makes the change | `POST /sessions/:id/messages`: Claude looks at the files and edits them with Anthropic's text editor tool. |
| …and runs automatic checks | After every change, the whole project is sent to a checker (`CHECK_URL`, e.g. the Analyzer's `POST /analyze`). If the checks find a problem, Claude is told what they found and gets one chance to fix it. The result is stored on the version, with the checker's answer (e.g. the new manifest, for the live preview) passed through. |
| Every change they keep becomes a version labelled in their own words | Each message that changes files makes a numbered version labelled `You asked: <their message>`. |
| If it's wrong, they say undo or restore an earlier version | They can say it in the chat (Claude has `undo_last_change`, `restore_version` and `list_versions`), or the app can call `POST …/undo` or `POST …/versions/:n/restore`. Restoring never loses anything: it's recorded as a new version. |
| A download of the draft to run on their own files | `GET …/project.zip?version=n` gives any version. When they say they're happy or want to download it, Claude calls `offer_download` and the reply carries `readyToDownload: { version }`; the app then shows the download button and hands that version to the Factory to build their Runner. |
| The chatbot only ever sees the project's code and the chat messages | Claude gets only the project's files and the person's messages. There is no way to send it anything else: the service refuses any field besides `message` and `confirmPrivate`. Claude is told never to ask for their files or personal details, but to have them describe problems in their own words. |
| If someone pastes private text, the product reminds them first | Before a message is sent, plain code (no AI) looks for email addresses, phone numbers, card and ID numbers, passwords and keys, file paths that show a name, and long pasted text. If it finds any, nothing is sent: the person gets a reminder, and the message only goes through when sent again with `confirmPrivate: true`. |

Building the draft app, the live preview window, and the chat/app layout belong to the Factory, the Runner and the website. The chat gives them what they need: versions, check results and downloads.

## Kept apart from the Runner and the Analyzer

The chat doesn't import, call or know about the Runner, the Analyzer, the manifest, or how a program is run. It works on any folder of files, or a zip of one. The automatic checks are anything that takes a zip and answers passed, failed or unavailable (`ProjectChecker`); for SimplyOpen that's an HTTP call to a URL you configure. It runs as its own service, because a downloaded app can't safely hold a Claude API key.

## How it works

1. **The copy.** The uploaded zip is unpacked into a private temp folder (`zip.ts`). Paths that would escape it are refused, and so are zips that would unpack to more than 200 MB.
2. **The project folder** (`projectFolder.ts`) is the only way the chat touches files:
   - every path stays inside the copy, including through symbolic links;
   - protected paths (`.git/`, `node_modules/` and other version-control or cache folders) can be read but never changed;
   - files over 1 MB and non-text files can't be opened;
   - each change is recorded, so any version can be rebuilt, restored or downloaded.
3. **The conversation** (`chat.ts`):
   - **The model:** `claude-opus-5-5`, with adaptive thinking, streaming and prompt caching.
   - **Tools:** the built-in text editor (`view`, `create`, `str_replace`, `insert`), `delete_file`, and the version and download tools.
   - **Limits:** up to 25 steps per message. Every tool input is checked before it runs, and a tool call cut off at the output limit is never run.
   - **Memory:** the conversation is remembered between messages.
4. **The privacy reminder** (`privacy.ts`) runs before anything is sent.
5. **The automatic checks** (`checks.ts`) run after each change, with one fix round when they fail.

## Using it

Requirements: **Node.js 22 or later** and Claude API credentials (`ANTHROPIC_API_KEY`). Run everything from this folder:

```bash
cd chat
```

```bash
npm install
```

### As a service

```bash
npm run dev
```

It listens on `http://127.0.0.1:3100`. To run the Analyzer as the automatic checks, start it (it listens on port 3000) and set:

```bash
export CHECK_URL=http://127.0.0.1:3000/analyze
```

| Request | Does |
|---|---|
| `POST /sessions` (multipart, zip in field `file`) | Makes the person's copy → `201 { sessionId, files, version }` |
| `POST /sessions/:id/messages`, JSON `{ "message": "…" }` | A reply, or a privacy reminder (see below) |
| same, with `"confirmPrivate": true` | Sends a message the person confirmed after the reminder |
| `GET /sessions/:id/versions` | Every version, oldest first; the last is current |
| `POST /sessions/:id/versions/:n/restore` | Goes back to version n, as a new version → `{ version }` |
| `POST /sessions/:id/undo` | Undoes the latest change, as a new version → `{ version }` (null if nothing to undo) |
| `GET /sessions/:id/project.zip?version=n` | The project at version n (default: the latest) |
| `GET /sessions/:id/files` | The current files |
| `DELETE /sessions/:id` | Ends the session and deletes the copy |

A reply:

```json
{
  "kind": "reply",
  "reply": "I fixed the crash in word_count.py…",
  "version": {
    "number": 1, "label": "You asked: it crashes when I press Run",
    "createdAt": "2026-11-14T18:02:11.000Z",
    "changes": [{ "path": "word_count.py", "change": "edited" }],
    "checks": { "status": "passed", "summary": "The automatic checks passed.", "report": { "manifest": { … } } }
  },
  "readyToDownload": null,
  "stoppedEarly": false
}
```

A privacy reminder (nothing was sent to the AI):

```json
{ "kind": "privacy_reminder", "found": ["an email address"], "reminder": "Before I send this: your message seems to include an email address. …" }
```

Errors return `{ "error": { "code", "message" } }`:

| Status | When |
|---|---|
| `400` | Bad request, including fields other than `message` and `confirmPrivate` |
| `404` | No such session or version |
| `409` | Still answering the previous message |
| `413` | Upload too large |
| `415` | Not multipart |
| `422` | Zip can't be unpacked safely |
| `429` | Too many sessions |
| `502` | Claude failed |

Sessions are kept in memory and deleted after an hour unused.

Environment variables:

| Variable | Default |
|---|---|
| `PORT` | `3100` |
| `HOST` | `127.0.0.1` |
| `MAX_UPLOAD_BYTES` | 50 MiB |
| `MAX_SESSIONS` | `20` |
| `SESSION_IDLE_MINUTES` | `60` |
| `CHECK_URL` | none (no checks run) |

### From the command line

```bash
npm run chat -- path/to/project.zip
```

A zip is worked on as your own copy. A folder is changed in place, so a Runner started with `SIMPLYOPEN_PROJECT` pointing at it uses the changed code on its next run. The privacy reminder appears as a yes/no question. The other commands are `/versions`, `/undo`, `/restore <n>`, `/save [n] [file.zip]`, `/files` and `/quit`.

## Testing

```bash
npm test
```

```bash
npm run typecheck
```

The 75 tests replace Claude with a scripted fake, so they make no network calls. They cover:

- **Path and zip safety.**
- **Each edit command.**
- **The conversation loop.**
- **Versions:**
  - labels in the person's words;
  - restoring any version;
  - undo after undo, and undo after a restore;
  - downloading any version;
  - undo and restore by asking in the chat.
- **Privacy:**
  - the reminder, and that nothing is sent before the person confirms;
  - each kind of private text, and ordinary requests left alone;
  - that the service refuses anything besides the message.
- **Automatic checks:** a failure is fixed in the same message, a lasting failure is recorded on the version, and checks that can't run aren't sent to Claude. `HttpProjectChecker` is tested against a real local server.
- **Offering the download.**
- **Every HTTP route and error.**

Deliberately breaking each rule makes at least one test fail.

## Known limitations

- **The reminder looks for common patterns.** It can miss private text in other forms, and it can occasionally remind about something harmless (the person just sends again).
- **Keys left inside the project's own code** are seen by Claude. The Analyzer's leaked-key check (PR #5, not merged yet) blanks them out; the chat doesn't yet.
- **A very long conversation** will eventually exceed what Claude can take in at once.
- **Sessions live in one process's memory**, so they're lost on restart. "Private" here means only the session id gives access: there is no sign-in yet.
- **No authentication or rate limiting**, and every message is a paid Claude call (plus a check). Don't expose it publicly as is.

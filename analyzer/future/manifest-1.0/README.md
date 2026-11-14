# Manifest 1.0 (saved for later)

This folder keeps the larger manifest format the Analyzer first produced, so it can be picked up again later. **Nothing uses it today.** The Analyzer now produces Ashwin's v0 format (`manifest/manifest.schema.json` on `main`, copied to `src/manifest/schema.json`), because that is what the Runner reads.

- `schema.ts`: the 1.0 format as TypeScript types, with every rule explained.
- `schema.json`: the same format as JSON Schema.

## What 1.0 covers that v0 doesn't

- Any language, not just Python.
- Several ways to start one project (`entry_points`), each with its own `run_command` and `working_directory`.
- How the program presents itself (`interface.kind`): runs once from the command line, opens its own window (games such as pygame), asks questions while it runs, or starts a local website. It also records game controls, the questions asked, and server details.
- More input types (folder, on/off switches, several files at once, secrets, environment variables) and declared outputs.
- Dependencies, operating systems, what the project can reach (`capabilities`), and how sure the Analyzer is (`confidence`).

## Getting the whole 1.0 Analyzer back

The full working 1.0 Analyzer (prompts, about 25 consistency checks, and 39 tests) is in commit `a7c0597`, also kept on the local branch `manifest-1.0`:

```bash
git switch manifest-1.0
```

Bringing 1.0 back means changing the Runner as well, so agree on it with the Runner, Factory and Web owners first.

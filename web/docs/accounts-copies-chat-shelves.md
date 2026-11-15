# Accounts, copies, saved chats, shelves and questions

What the `web-accounts` branch adds to the web backend, why, and what has to happen next. Everything here is backend only: an API for the pages to call.

## What was asked for

| # | Requirement | Where it is now |
|---|---|---|
| 1 | Sign up and log in with a username, email and password, stored like a normal website | Task 1 |
| 2 | Metadata on each project: number of forks, stars, version history, and the rest of what the project page shows | Task 2 |
| 3 | People can fork ("copy") the project they are viewing, and every project has a version history | Task 3 |
| 4 | Each person's chat with Claude is saved, so Claude can pick up where they left off | Task 4 |
| 5 | A recommendation system for hot new projects, and the home page shelves | Task 5 |
| 6 | Questions and answers on the project page (from the page mock-up) | Task 6 |

Three decisions were made before starting:

- **Passwords sit beside the emailed sign-in link.** The link still works; nothing was removed.
- **One version history, in this database.** The separate `history/` service from PR #10 is retired.
- **The work is on its own branch** (`web-accounts`, off `web`), in new files wherever possible.

## Task 1: accounts with a password

| Request | Does |
|---|---|
| `POST /api/auth/sign-up` `{ username, email, password, name? }` | Makes the account, signs in, and emails a link to confirm the address |
| `POST /api/auth/sign-in` `{ login, password }` | `login` is a username or an email |
| `POST /api/auth/password` `{ password, current_password?, username? }` | Change the password, or add one (and a username) to an account made by emailed link |
| `GET /api/account` | The signed-in person, with their username |

- **Storage:** the password is kept only as a salted scrypt hash, in its own `passwords` table, so no query that reads a user can carry it along.
- **Wrong tries:** five in a row pause password sign-in on that account for 15 minutes. The emailed link still works meanwhile.
- **No probing:** a wrong password, an unknown name and an account with no password all get the same answer.
- **Changing a password** needs the current one and signs out every other browser.
- **Takeover protection:** if someone signs up with an address that isn't theirs, the real owner's first emailed-link sign-in removes that password and signs the stranger out. Opening the confirm link sent at sign-up keeps the password.

## Task 2: project facts

`GET /api/projects/:slug/facts` returns, with no account needed:

- **Counts:** stars, copies ("forks"), versions, waiting suggestions.
- **Dates:** created and last updated.
- **Systems:** each system the newest version was built for, with status and download size.
- **Checked:** whether the newest version passed the automatic checks.
- **What it touches:** Reads, Saves, Internet and Anything else, as facts from the Analyzer's manifest. The page's templates write the sentences. Anything unclear counts as touching, never as "Nothing".
- **You** (signed in only): whether you starred it, your copies of it, and whether you own it.

`DELETE /api/projects/:slug/star` takes a star back.

## Task 3: copies and the one version history

Making a copy was already there (`POST /api/projects/:slug/copies`). A copy now has its own history:

| Request | Does |
|---|---|
| `GET /api/copies/:id` | The copy, "Copied from" (project, maker, version), and its newest version |
| `GET /api/copies/:id/versions` | Every version, newest first |
| `POST /api/copies/:id/versions` (zip in `file`, plus `note`) | Saves the next version |
| `POST /api/copies/:id/versions/:n/restore` | Goes back to version n by adding a new version |
| `GET /api/copies/:id/versions/:n/download` | That version's code |

- **One table.** A copy's versions live in the same `versions` table as a project's. Each row belongs to a project or to a copy, never both, and a database rule enforces that.
- **Nothing is lost.** Going back adds a version that points at the old code.
- **Private.** A copy and its versions are visible only to its owner. Copy versions cannot be reached through the public version routes.
- **The original is never touched** by anything done to a copy.

## Task 4: saved chats

| Request | Does |
|---|---|
| `GET /api/copies/:id/chat` | Everything said about this copy so far |
| `POST /api/copies/:id/chat` `{ message, confirm_private? }` | Sends a message to Claude and saves the exchange |

- **One conversation per person, per copy.** A copy belongs to one person, so chats never mix.
- **Every change becomes a version** of the copy, labelled "You asked: …".
- **Picking up where they left off.** The chat service's sessions are temporary. When one is gone, or the copy was changed another way (such as going back a version), a new session starts from the copy's newest code and the saved conversation. Claude gets the last 60 messages and reads the files again.
- **Privacy reminder.** If a message looks private, nothing is sent to Claude and nothing is saved until the person confirms.
- **Chat service change:** `POST /sessions` accepts an `earlier` field holding the saved conversation.

## Task 5: home page shelves

`GET /api/shelves` returns all four in one call, with no account needed. Only public projects ever appear.

- **Picks from the team:** chosen and ordered by team members (`PUT` / `DELETE /api/picks/:slug`). The team is the addresses in `TEAM_EMAILS`, and an address only counts once it has been proved by emailed link.
- **Hot:** projects shared in the last 30 days, ranked by

  `score = (1 + 3 × stars this week + 2 × copies this week) ÷ (age in days + 2)^1.5`

  so something new and liked rises above something old with many stars.
- **New this week:** shared in the last seven days, newest first.
- **Lists made by people:** anyone signed in can make a list (`POST /api/lists`), add public projects (`PUT /api/lists/:id/projects/:slug`), take them out, or delete it. `GET /api/lists/:id` shows one.

## Task 6: questions and answers

| Request | Does |
|---|---|
| `GET /api/projects/:slug/questions` | The questions the viewer may see |
| `POST /api/projects/:slug/questions` `{ text }` | Ask one (signed in) |
| `POST /api/questions/:id/answer` `{ text }` | Answer it, or change the answer (the maker only) |
| `DELETE /api/questions/:id` | Remove it (the maker, or whoever asked) |

A question becomes public once the maker answers it. Until then only the asker and the maker see it. One person can have at most five questions waiting on a project.

## Database changes

Five new migrations, applied in order by `npm run migrate`:

| File | Adds |
|---|---|
| `006_passwords.sql` | `users.username`, `users.email_verified_at`, the `passwords` table |
| `007_copy_versions.sql` | `versions.copy_id` and `versions.restored_from`; a version may belong to a copy |
| `008_copy_chats.sql` | `chat_messages`, `chat_sessions` |
| `009_shelves.sql` | `picks`, `lists`, `list_items` |
| `010_questions.sql` | `questions` |

## Changes to existing files

Everything else is in new files.

- `src/app.ts`: registers the new routes; adds the optional `chat` and `teamEmails` settings.
- `src/server.ts`: reads `CHAT_URL` and `TEAM_EMAILS`.
- `src/routes/auth.ts`: the emailed link reports that the address was proved.
- `src/repo/versions.ts`: looking a version up by id finds project versions only.
- `vitest.config.ts`: longer setup time, and cheap password hashing in tests.
- `.env.example`: documents `TEAM_EMAILS`.
- `chat/src/chat.ts`, `chat/src/server.ts`: a session can start from an earlier conversation.

## Settings

| Variable | For |
|---|---|
| `CHAT_URL` | Where the chat service runs. Without it, the chat answers 503. |
| `TEAM_EMAILS` | Comma-separated addresses of the people who choose the team's picks. |
| `PASSWORD_HASH_COST` | Tests only. Leave unset in production. |

## How it was checked

- Every task has its own test file, run against a real Postgres held in memory.
- For every task, the code was broken on purpose, one rule at a time, to confirm a test fails. Gaps this found were closed.
- Task 4 was also run live: the real analyzer, chat and web servers together, with real Claude, across a chat-service restart.

## What has to happen next

1. **Merge this branch into `web`,** then run `npm run migrate` against Supabase. Until then none of these tables exist there, and a server without `DATABASE_URL` keeps everything in memory.
2. **Close or rework PR #10.** Its `history/` service is replaced by the `versions` table here.
3. **Build the pages** for sign-up and log-in, the copy workspace with its chat, the shelves, and questions.
4. **Send real email.** Sign-in and confirm links are only printed to the server's terminal today.
5. **Protect stored code.** Code zips are reachable by anyone who has their long, unguessable link. A private copy's code needs signed, expiring links to be truly private.
6. **Build drafts of copies.** A copy's versions are stored, but nothing builds them into downloads yet, so "try a draft on your own files" isn't possible.
7. **Save the leaked-keys result.** The Analyzer reports it (PR #5), but the pipeline doesn't store it, so "Checked for leaked keys" can only reflect the overall check.
8. **Let a maker chat about their own project.** Only copies can be changed by chat so far.
9. **Limit how often people can sign up, ask and chat.** Only password tries and waiting questions are limited today.

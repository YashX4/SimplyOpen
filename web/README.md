# SimplyOpen, the website's API

Fastify and TypeScript over Postgres, the same stack as the Analyzer and the
chat service, so there is only one set of habits in the repository.

Everything the API needs is injected, which means the whole thing runs in a
test with a real Postgres inside the process, a fake Analyzer and a fake
Factory, and no network at all. That is how the 56 tests run.

## Getting it going

    npm install
    cp .env.example .env     # fill in what you have; missing pieces degrade
    npm run migrate          # needs DATABASE_URL
    npm run dev

With no `DATABASE_URL` it starts on a database held in memory, seeded with
the demo project and five versions, so you can open it with nothing set up.

    npm test         # 56 tests, no network, no database server
    npm run typecheck

## What is wired, and what is not

| Piece | How |
| --- | --- |
| Database | Supabase Postgres through `DATABASE_URL`, or in memory |
| Storage | Supabase Storage through the service key, or in memory |
| Analyzer | `ANALYZER_URL`, their `POST /analyze` |
| Factory | GitHub Actions `build.yml`, by `workflow_dispatch` |
| Email | printed to the terminal; swap `ConsoleMailer` for a real sender |
| Chat | not proxied yet |

## The shape of it

    migrations/     every change to the database, applied once, in order
    src/db.ts       the one seam: Postgres over the wire, or in process
    src/repo/       one file per table group, the only place SQL lives
    src/services/   the outside world: analyzer, factory, storage, mailer
    src/services/pipeline.ts   zip in, three downloads out
    src/routes/     HTTP, and nothing else
    src/visibility.ts          who can see what, decided in one place

## Decisions worth knowing

**Versions are append only.** Nothing is ever updated in place. Going back a
version inserts a new one, which is why the history only grows. The number is
handed out inside the insert, so two writers cannot both make version 5.

**Credit is a column.** `versions.suggested_by` is null when the maker
changed it themselves and holds the other person's id when a suggestion was
taken. That one nullable column is the whole contribution story.

**A copy points at a version, not a project.** You copied something specific,
and the page says which.

**Three visibility values, not a boolean.** Private, link, public. Browse and
search list the third only. A private project answers 404 rather than 403, so
a slug cannot be fished for by watching status codes.

**Getting things never needs an account.** Browse, the project page and the
download route all work with no session. Only putting something in needs one.

**Three facts are lifted out of the manifest into columns:**
`network_access` because the project page branches on it, `confidence`
because it decides between the normal review screen and the simple window
one, and `operating_systems` because comparing what the project claims
against what the Factory managed is where the partial build screens come
from. Everything else stays in `checks.manifest` as jsonb.

**A system the project never claimed stays `cannot`,** whatever CI later
says about it.

**A built app can be too big to copy.** Supabase's free plan takes 50 MB a
file and a packaged Electron app with its own Python is well past that. So
`refresh` asks `storage.maxBytes` first: a small build is copied into the
bucket and the download route redirects to it, a big one stays a GitHub
artifact and the download route fetches it with our token and passes it on.
Either way the person downloading needs no account, which is what matters.

## Left to do
- Proxy the chat service, including its privacy reminder reply.
- Poll or webhook the Factory. `POST /api/versions/:id/refresh` does one pass;
  nothing calls it on a timer yet.
- Install counts. Stars and copies are counted; installs are not.

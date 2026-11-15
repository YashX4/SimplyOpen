# Putting SimplyOpen online

SimplyOpen runs as three small Node services. The database, file storage and
builds already live elsewhere (Supabase and GitHub Actions), so nothing here
needs a disk.

| Service    | Folder      | What it is                                      | Public? |
|------------|-------------|-------------------------------------------------|---------|
| `site`     | `web/`      | The website and its API, on one address         | Yes     |
| `analyzer` | `analyzer/` | Reads uploads and writes the manifest           | No      |
| `chat`     | `chat/`     | Changing a project by chatting                  | No      |

These steps use Railway, because its services stay awake (a demo never waits
a minute for a sleeping server) and the three services can talk to each other
privately. Any host that runs Node 22 works the same way.

## 1. Make the project

1. Sign in at railway.com with GitHub.
2. New Project, then Deploy from GitHub repo, then `akondreddy/SimplyOpen`.
3. That makes one service. Make two more from the same repo, so there are three.
4. Name them exactly `site`, `analyzer` and `chat` (Settings, at the top).
   The names become their private addresses below.
5. In each service's Settings, set the branch to `web` and the Root Directory
   to the folder in the table above.

## 2. Build and start

| Service    | Build command        | Start command |
|------------|----------------------|---------------|
| `site`     | `npm run build:all`  | `npm start`   |
| `analyzer` | leave it as found    | `npm start`   |
| `chat`     | leave it as found    | `npm start`   |

`build:all` builds the pages and the API together. In production the API
serves the pages itself, so the whole site is one address.

Keep `site` at one copy (the default). Open chats are held in its memory.

## 3. Settings (Variables tab of each service)

Use fresh keys here, not ones that were ever pasted into a chat or a file.

**analyzer**

    ANTHROPIC_API_KEY=...
    HOST=::
    PORT=3000

**chat**

    ANTHROPIC_API_KEY=...
    HOST=::
    PORT=3100
    CHECK_URL=http://analyzer.railway.internal:3000/analyze

**site**

    NODE_ENV=production
    SITE_URL=https://www.YOURDOMAIN
    DATABASE_URL=...            Supabase, pooled connection string
    SUPABASE_URL=...
    SUPABASE_SERVICE_KEY=...
    SUPABASE_BUCKET=files
    ANALYZER_URL=http://analyzer.railway.internal:3000/analyze
    CHAT_URL=http://chat.railway.internal:3100
    GITHUB_OWNER=akondreddy
    GITHUB_REPO=SimplyOpen
    GITHUB_TOKEN=...            fine grained, Actions read and write on the repo
    RESEND_API_KEY=...
    MAIL_FROM=SimplyOpen <hello@YOURDOMAIN>
    TEAM_EMAILS=...             who picks "Picks from the team", comma separated

`SITE_URL` must be exactly the address people open, with `https://`, because
sign in links and cookies depend on it. Leave `PORT` and `HOST` off `site`:
Railway gives it a port, and it listens everywhere on its own in production.

## 4. The domain (GoDaddy)

1. In `site`, Settings, Networking, Custom Domain, add `www.YOURDOMAIN`.
   Railway shows a CNAME target, and sometimes a TXT record to prove it is yours.
2. In GoDaddy, My Products, the domain, DNS:
   * add a CNAME record, name `www`, value the target Railway showed;
   * add the TXT record too, if Railway asked for one.
3. GoDaddy cannot point the bare domain at Railway, so forward it instead:
   Domain settings, Forwarding, forward `YOURDOMAIN` to `https://www.YOURDOMAIN`.
4. Wait for the green tick in Railway. The https certificate is made for you.

## 5. Email that reaches everyone

Without this, sign in emails only reach the address the Resend account was
made with, and nobody else can sign up.

1. In Resend, Domains, add `YOURDOMAIN`.
2. Add the records it lists to GoDaddy DNS, exactly as shown.
3. When Resend says Verified, set `MAIL_FROM` on `site` to an address on the domain.

## 6. Check it

* `https://www.YOURDOMAIN/api/health` answers `{"ok":true}`.
* The home page opens, and so does a link straight to a project page.
* Sign up with an address that is not yours and the email arrives.
* Upload a zip from `examples/uploads/`. The review page fills in, and the
  window picture appears there about ten minutes later.

## Fonts

The design's fonts are Grilli Type trials, which are kept out of the
repository (see `web/client/public/fonts/README.md`). The live site uses the
stand ins, Fraunces and Inter. Only add the real ones to a public site with a
licence for it.

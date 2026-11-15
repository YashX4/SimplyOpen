/**
 * Starts the website's API.
 *
 * Everything it needs comes from the environment, and every missing piece
 * degrades to something that still runs: no Analyzer means uploads fail
 * politely, no storage means files live in memory, no GitHub token means
 * builds never start. So `npm run dev` works on a laptop with nothing set up.
 */

import { pathToFileURL } from 'node:url'
import { buildApp } from './app.js'
import { connect, connectInMemory, type Db } from './db.js'
import { migrate } from './migrate.js'
import { HttpAnalyzer, type Analyzer } from './services/analyzer.js'
import { GithubFactory, type Factory } from './services/factory.js'
import { ConsoleMailer, ResendMailer } from './services/mailer.js'
import { HttpChat } from './services/chat.js'
import { MemoryStorage, SupabaseStorage, type Storage } from './services/storage.js'

class NoAnalyzer implements Analyzer {
  async analyze(): Promise<never> {
    throw new Error('ANALYZER_URL is not set, so uploads cannot be read yet.')
  }
}

class NoFactory implements Factory {
  async dispatch(): Promise<void> {
    console.warn('GITHUB_TOKEN is not set, so no build was started.')
  }
  async read() {
    return { found: false, finished: false, platforms: [], artifacts: [] }
  }
  async download(): Promise<never> {
    throw new Error('GITHUB_TOKEN is not set.')
  }
}

async function main(): Promise<void> {
  const env = process.env
  let db: Db
  if (env.DATABASE_URL) {
    db = await connect(env.DATABASE_URL)
  } else {
    console.warn('DATABASE_URL is not set, so this is running on a database in memory.')
    db = await connectInMemory()
  }
  const applied = await migrate(db)
  if (applied.length) console.log(`applied: ${applied.join(', ')}`)

  const storage: Storage =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY
      ? new SupabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, env.SUPABASE_BUCKET ?? 'files')
      : new MemoryStorage()

  const factory: Factory =
    env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO
      ? new GithubFactory(env.GITHUB_OWNER, env.GITHUB_REPO, env.GITHUB_TOKEN)
      : new NoFactory()

  const app = await buildApp({
    db,
    analyzer: env.ANALYZER_URL ? new HttpAnalyzer(env.ANALYZER_URL) : new NoAnalyzer(),
    storage,
    factory,
    // Real email when there is a Resend key; otherwise the link prints here.
    mailer: env.RESEND_API_KEY ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM || undefined) : new ConsoleMailer(),
    // SimplyOpen Chat, from chat/ in this repository. It listens on 3100.
    chat: env.CHAT_URL ? new HttpChat(env.CHAT_URL) : undefined,
    // Where the website is, because the sign in link opens the website.
    siteUrl: env.SITE_URL ?? 'http://localhost:5173',
    // No email is really sent, so on your own computer the page gets the link too.
    // Only ever for a site at localhost: anywhere public it would let anyone in as anyone.
    showSignInLinks:
      !env.RESEND_API_KEY &&
      env.NODE_ENV !== 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(env.SITE_URL ?? 'http://localhost:5173'),
    logger: true,
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void app.close().then(() => db.close()).then(() => process.exit(0)))
  }
  await app.listen({ port: Number(env.PORT ?? 3200), host: env.HOST ?? '127.0.0.1' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}

import { connectInMemory, type Db } from '../src/db.js'
import { migrate } from '../src/migrate.js'
import { buildApp, SESSION_COOKIE } from '../src/app.js'
import { MemoryStorage } from '../src/services/storage.js'
import { MemoryMailer } from '../src/services/mailer.js'
import type { Analyzer, AnalyzeResult, Manifest } from '../src/services/analyzer.js'
import type { Factory, RunState } from '../src/services/factory.js'
import * as users from '../src/repo/users.js'

export function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    schema_version: '1.0',
    project_kind: 'app_or_tool',
    project: { language: 'python', language_version: '3.11' },
    dependencies: { operating_systems: ['macos', 'windows', 'linux'] },
    capabilities: {
      network_access: false,
      filesystem_access: 'declared_inputs_outputs_only',
      reads_env_vars: [],
      runs_other_programs: false,
    },
    confidence: { overall: 'high', notes: [] },
    ...over,
  }
}

export class FakeAnalyzer implements Analyzer {
  calls = 0
  constructor(private readonly reply: AnalyzeResult | Error) {}
  async analyze(): Promise<AnalyzeResult> {
    this.calls += 1
    if (this.reply instanceof Error) throw this.reply
    return this.reply
  }
}

export class FakeFactory implements Factory {
  readonly dispatched: { buildId: string; projectUrl: string; appUrl: string }[] = []
  state: RunState = { found: false, finished: false, platforms: [], artifacts: [] }
  downloads: number[] = []

  async dispatch(input: { buildId: string; projectUrl: string; appUrl: string }): Promise<void> {
    this.dispatched.push(input)
  }
  async read(): Promise<RunState> {
    return this.state
  }
  async download(id: number): Promise<Uint8Array> {
    this.downloads.push(id)
    return new TextEncoder().encode(`app-${id}`)
  }
}

export interface Harness {
  db: Db
  app: Awaited<ReturnType<typeof buildApp>>
  storage: MemoryStorage
  mailer: MemoryMailer
  analyzer: FakeAnalyzer
  factory: FakeFactory
  /** A signed in person, and the cookie header that proves it. */
  signIn(email: string, name?: string): Promise<{ id: string; cookie: string }>
  close(): Promise<void>
}

export async function harness(over: { analyzer?: FakeAnalyzer } = {}): Promise<Harness> {
  const db = await connectInMemory()
  await migrate(db)
  const storage = new MemoryStorage()
  const mailer = new MemoryMailer()
  const analyzer =
    over.analyzer ??
    new FakeAnalyzer({
      manifest: manifest(),
      name: 'Zoom transcripts to NVivo',
      description: 'Turns Zoom transcripts into files NVivo opens.',
    })
  const factory = new FakeFactory()
  const app = await buildApp({ db, analyzer, storage, factory, mailer, logger: false })

  return {
    db,
    app,
    storage,
    mailer,
    analyzer,
    factory,
    async signIn(email: string, name = '') {
      const user = await users.findOrCreate(db, email, name)
      const token = await users.startSignIn(db, email)
      const done = await users.completeSignIn(db, token)
      if (!done) throw new Error('could not sign in the test person')
      return { id: user.id, cookie: `${SESSION_COOKIE}=${done.session}` }
    },
    async close() {
      await app.close()
      await db.close()
    },
  }
}

/** A multipart body with one file and some fields, built by hand. */
export function multipartBody(
  file: { field: string; filename: string; bytes: Uint8Array; type?: string },
  fields: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----simplyopentest' + Math.random().toString(16).slice(2)
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; ` +
        `filename="${file.filename}"\r\nContent-Type: ${file.type ?? 'application/zip'}\r\n\r\n`,
    ),
    Buffer.from(file.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

export const SOME_ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])

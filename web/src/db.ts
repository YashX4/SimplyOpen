/**
 * One tiny database seam, so the same code runs against Supabase in
 * production and against Postgres in process during tests.
 *
 * Nothing here knows about SimplyOpen. The repositories do.
 */

export interface QueryResult<T> {
  rows: T[]
}

export interface Db {
  /** Run one statement. Parameters are always bound, never interpolated. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  /** Run several statements as one unit. Rolls back if the callback throws. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>
  /** Run a whole file of statements, for migrations. */
  exec(sql: string): Promise<void>
  close(): Promise<void>
}

/** Postgres over the wire: Supabase, Neon, a local server. */
export async function connect(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg')
  // bigint comes back as a string by default, because Postgres allows
  // values JavaScript cannot hold exactly. Ours are file sizes and GitHub
  // artifact ids, both far inside the safe range, and a string leaks into
  // the JSON and then into arithmetic in the frontend. So read them as
  // numbers, same as the in-process database already does.
  pg.types.setTypeParser(20, (value: string) => Number(value))
  const pool = new pg.Pool({ connectionString, max: 10 })

  const wrap = (runner: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
  }): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await runner.query(sql, params)
      return { rows: r.rows as T[] }
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const out = await fn(wrap(client))
        await client.query('commit')
        return out
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
    async exec(sql: string) {
      await runner.query(sql)
    },
    async close() {
      await pool.end()
    },
  })

  return wrap(pool)
}

/**
 * Postgres compiled to WebAssembly, running inside this process.
 * Real Postgres, no server, nothing to clean up. Tests only.
 */
export async function connectInMemory(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  const lite = new PGlite()

  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await lite.query(sql, params as never[])
      return { rows: r.rows as T[] }
    },
    async tx<T>(fn: (inner: Db) => Promise<T>) {
      await lite.exec('begin')
      try {
        const out = await fn(db)
        await lite.exec('commit')
        return out
      } catch (error) {
        await lite.exec('rollback').catch(() => undefined)
        throw error
      }
    },
    async exec(sql: string) {
      await lite.exec(sql)
    },
    async close() {
      await lite.close()
    },
  }
  return db
}

/** The first row, or null. Saves writing `rows[0] ?? null` everywhere. */
export function one<T>(result: QueryResult<T>): T | null {
  return result.rows[0] ?? null
}

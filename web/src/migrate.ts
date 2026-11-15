/**
 * Applies every file in migrations/ once, in name order, and records which
 * ones have run. Safe to call on every boot.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Db } from './db.js'

const here = path.dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = path.resolve(here, '..', 'migrations')

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`
    create table if not exists _migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    );
  `)
  const done = new Set(
    (await db.query<{ name: string }>('select name from _migrations')).rows.map((r) => r.name),
  )
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []
  for (const file of files) {
    if (done.has(file)) continue
    const sql = await readFile(path.join(dir, file), 'utf8')
    await db.exec(sql)
    await db.query('insert into _migrations (name) values ($1)', [file])
    applied.push(file)
  }
  return applied
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('Set DATABASE_URL first. Supabase gives it to you under Project Settings, Database.')
    process.exit(1)
  }
  const { connect } = await import('./db.js')
  const db = await connect(url)
  const applied = await migrate(db)
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply')
  await db.close()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}

import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { build } from 'vite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb, migrateInWorker, type WorkspaceInfo } from '../src/main/db'
import { migrations } from '../src/main/db/migrations'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory }
}))

let bundle: string
let root: string
const path = (): string => join(environment.directory, 'nais3.db')
const backups = (): string => join(environment.directory, 'backups')

// The app loads the worker from the electron-vite build; bundle the same entry for Node here.
beforeAll(async () => {
  bundle = mkdtempSync(join(tmpdir(), 'nais3-migration-worker-'))
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: resolve('src/main/db/migrate.worker.ts'),
      outDir: bundle,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'migrate.worker.cjs',
          // Resolve the native module from the repository, not from the temporary bundle.
          paths: { 'better-sqlite3': createRequire(import.meta.url).resolve('better-sqlite3') }
        }
      }
    }
  })
  bundle = join(bundle, 'migrate.worker.cjs')
}, 60_000)

afterAll(() => {
  if (bundle) rmSync(join(bundle, '..'), { recursive: true, force: true })
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nais3-migration-'))
  environment.directory = join(root, "workspace's data")
  mkdirSync(environment.directory)
})

afterEach(() => {
  closeDb()
  rmSync(root, { recursive: true, force: true })
})

function seed(version: number, language?: string): void {
  const db = new Database(path())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (let v = 0; v < version; v++)
    db.transaction(() => {
      migrations[v](db)
      db.pragma(`user_version = ${v + 1}`)
    })()
  db.prepare('INSERT INTO images (file_path, thumbnail, payload_json) VALUES (?, ?, ?)').run(
    '/fixture/generated.png',
    Buffer.from([1, 2, 3]),
    '{}'
  )
  if (language)
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ui_language', language)
  db.close()
}

function version(): number {
  const db = new Database(path(), { readonly: true, fileMustExist: true })
  try {
    return db.pragma('user_version', { simple: true }) as number
  } finally {
    db.close()
  }
}

// Runs the worker and records what it reported when it opened the database.
async function run(workerFile = bundle): Promise<{ migrated: boolean; opened: WorkspaceInfo[] }> {
  const opened: WorkspaceInfo[] = []
  const migrated = await migrateInWorker(workerFile, (info) => opened.push(info))
  return { migrated, opened }
}

describe('DB migration worker', () => {
  it('backs up and migrates the database, leaving initDb only to open it', async () => {
    seed(18)
    await expect(run()).resolves.toEqual({
      migrated: true,
      opened: [{ language: 'ko', pending: true }]
    })
    expect(version()).toBe(migrations.length)
    expect(readdirSync(backups())).toEqual(['pre-migration-v18.db'])

    const initialized = initDb()
    expect(initialized).toMatchObject({ version: migrations.length, isNewDatabase: false })
    expect(getDb().prepare('SELECT file_path FROM images').all()).toEqual([
      { file_path: '/fixture/generated.png' }
    ])
  })

  it('reports the saved language, and no pending upgrade once migrated', async () => {
    seed(18, 'en')
    await expect(run()).resolves.toEqual({
      migrated: true,
      opened: [{ language: 'en', pending: true }]
    })
    // A start that needs no migration still removes temp files left by a killed snapshot.
    writeFileSync(join(backups(), 'pre-migration-v18.db.stale.tmp'), 'partial snapshot')
    await expect(run()).resolves.toEqual({
      migrated: true,
      opened: [{ language: 'en', pending: false }]
    })
    expect(readdirSync(backups())).toEqual(['pre-migration-v18.db'])
  })

  it('rejects with the migration error and leaves the database at its version', async () => {
    seed(18)
    writeFileSync(backups(), 'blocked directory')
    const opened: WorkspaceInfo[] = []
    await expect(migrateInWorker(bundle, (info) => opened.push(info))).rejects.toThrow()
    expect(opened).toEqual([{ language: 'ko', pending: true }])
    expect(version()).toBe(18)
  })

  it('rejects a database newer than the app with the update message', async () => {
    seed(migrations.length)
    const db = new Database(path())
    db.pragma(`user_version = ${migrations.length + 1}`)
    db.close()
    await expect(run()).rejects.toThrow('NAIS3를 최신 버전으로 업데이트하세요.')
    expect(version()).toBe(migrations.length + 1)
  })

  it('leaves a new installation to initDb without starting the worker', async () => {
    await expect(run(join(root, 'missing-worker.cjs'))).resolves.toEqual({
      migrated: true,
      opened: []
    })
    expect(readdirSync(environment.directory)).toEqual([])
  })

  it('falls back to the main thread when the worker cannot run', async () => {
    seed(18)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(run(join(root, 'missing-worker.cjs'))).resolves.toEqual({
      migrated: false,
      opened: []
    })
    expect(logged).toHaveBeenCalledWith('DB migration worker failed:', expect.any(Error))
    logged.mockRestore()
    expect(version()).toBe(18)
  })
})

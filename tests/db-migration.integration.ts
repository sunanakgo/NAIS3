import Database from 'better-sqlite3'
import { spawn } from 'child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backupNow, closeDb, getDb, initDb } from '../src/main/db'
import { migrations } from '../src/main/db/migrations'
import { resolveInitialLanguage } from '../src/main/i18n'

const environment = vi.hoisted(() => ({ directory: '', locale: 'zh-CN' }))
vi.mock('electron', () => ({
  app: {
    getPath: () => environment.directory,
    getLocale: () => environment.locale
  },
  safeStorage: { isEncryptionAvailable: () => false }
}))

let root: string
let legacy: Database.Database | undefined
const migration18 = migrations[17]
const path = (): string => join(environment.directory, 'nais3.db')
const backupPath = (): string => join(environment.directory, 'backups', 'pre-migration-v17.db')
type Rows = Record<string, Record<string, unknown>[]>

function snapshot(database: Database.Database): Rows {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[]
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      database.prepare(`SELECT * FROM ${name} ORDER BY ${name === 'settings' ? 'key' : 'id'}`).all()
    ])
  )
}

function seedLegacy(
  options: { language?: string; withSettings?: boolean } = {}
): Database.Database {
  legacy = new Database(path())
  legacy.pragma('journal_mode = WAL')
  legacy.pragma('wal_autocheckpoint = 0')
  legacy.pragma('foreign_keys = ON')
  for (let version = 0; version < 17; version++)
    legacy.transaction(() => {
      migrations[version](legacy!)
      legacy!.pragma(`user_version = ${version + 1}`)
    })()
  legacy.exec(`
    INSERT INTO fragment_folders (id, name, sort_order, collapsed, color)
      VALUES (1, ' Default ', 1, 1, '#abcdef');
    INSERT INTO fragments (id, name, content, folder_id, sort_order)
      VALUES (1, ' hair COLOR ', 'USER CONTENT', 1, 5);
    INSERT INTO character_folders (id, name) VALUES (1, 'Characters');
    INSERT INTO character_prompts (id, name, prompt, thumbnail, enabled, folder_id)
      VALUES (1, '설정', '<hair color>, girl', X'010203', 1, 1);
    INSERT INTO vibe_folders (id, name) VALUES (1, 'Vibes');
    INSERT INTO vibe_images (id, name, file_path, thumbnail, enabled, folder_id, encoded, encoded_ie)
      VALUES (1, 'vibe', '/fixture/vibe.png', X'0102', 1, 1, 'cached encoding', 0.7);
    INSERT INTO charref_folders (id, name) VALUES (1, 'References');
    INSERT INTO charref_images (id, name, file_path, thumbnail, enabled, folder_id)
      VALUES (1, 'reference', '/fixture/reference.png', X'0304', 1, 1);
    INSERT INTO gen_scenes (id, name, prompt, reserve_count, reserve_json)
      VALUES (1, 'scene', 'scene prompt', 3, '{"cast-1":3}');
    INSERT INTO images (id, file_path, thumbnail, payload_json, scene_id, favorite, seed)
      VALUES (1, '/fixture/generated.png', X'0506', '{"input":"saved"}', 1, 1, 12345);
    INSERT INTO prompt_presets (id, name, prompt, negative_prompt, params_json, prompt_parts_json)
      VALUES (1, 'preset', 'saved prompt', 'saved negative', '{"steps":28}',
        '{"base":"saved prompt","additional":"","detail":""}');
    INSERT INTO library_stacks (id, name) VALUES (1, 'stack');
    INSERT INTO library_images (id, name, file_path, thumbnail, stack_id, sort_order)
      VALUES (1, 'curated', '/fixture/curated.png', X'0708', 1, 3);
    INSERT INTO anlas_log (balance) VALUES (1234);
  `)
  if (options.withSettings !== false) {
    for (const [key, value] of Object.entries({
      main_params: '{"prompt":"<hair color>","model":"nai-diffusion-4-5-full","steps":28}',
      scene_casts: '[{"id":"cast-1","name":"saved cast","characterIds":[1]}]',
      nai_accounts_encrypted: 'opaque encrypted fixture',
      ui_theme: 'dark'
    }))
      legacy.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value)
  }
  if (options.language)
    legacy
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('ui_language', options.language)
  return legacy
}

function withBackup(check: (database: Database.Database) => void, file = backupPath()): void {
  const backup = new Database(file, { readonly: true, fileMustExist: true })
  try {
    check(backup)
  } finally {
    backup.close()
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nais3-migration-'))
  // Exercise parameterized VACUUM paths, including quotes and spaces.
  environment.directory = join(root, "workspace's data")
  environment.locale = 'zh-CN'
  mkdirSync(environment.directory)
})

afterEach(() => {
  closeDb()
  if (legacy?.open) legacy.close()
  legacy = undefined
  migrations[17] = migration18
  rmSync(root, { recursive: true, force: true })
})

describe('existing workspace migration', () => {
  it('preserves existing data, creates a standalone old-version backup and does not reseed on reopen', () => {
    const old = seedLegacy({ language: 'en' })
    const before = snapshot(old)
    old.close()
    const initialized = initDb()
    expect(initialized.isNewDatabase).toBe(false)
    expect(initialized.version).toBe(migrations.length)
    const after = snapshot(getDb())
    for (const [table, rows] of Object.entries(before)) {
      const key = table === 'settings' ? 'key' : 'id'
      for (const row of rows)
        expect(
          after[table].find((value) => value[key] === row[key]),
          table
          // v21 adds a nullable anlas_log.account_id; legacy rows stay unattributed
        ).toEqual(table === 'anlas_log' ? { ...row, account_id: null } : row)
    }
    expect(after.fragments).toHaveLength(8)
    expect(after.fragment_folders[1].name).toBe('Default (2)')
    withBackup((backup) => {
      expect(backup.pragma('user_version', { simple: true })).toBe(17)
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(snapshot(backup)).toEqual(before)
    })
    getDb().prepare("DELETE FROM fragments WHERE name = 'Eye color'").run()
    const edited = snapshot(getDb())
    closeDb()
    expect(initDb().isNewDatabase).toBe(false)
    expect(snapshot(getDb())).toEqual(edited)
  })

  it('includes committed WAL pages in both migration and periodic snapshots', () => {
    const old = seedLegacy()
    old.pragma('wal_checkpoint(TRUNCATE)')
    old
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('wal_only', 'committed WAL data')
    expect(statSync(`${path()}-wal`).size).toBeGreaterThan(0)
    const before = snapshot(old)
    initDb()
    withBackup((backup) => expect(snapshot(backup)).toEqual(before))
    getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run('newer WAL data', 'wal_only')
    const current = snapshot(getDb())
    withBackup((backup) => expect(snapshot(backup)).toEqual(current), backupNow())
  })

  it('rolls back a failed migration and can safely replace the backup on a later attempt', () => {
    const old = seedLegacy()
    const before = snapshot(old)
    old.close()
    migrations[17] = (database) => {
      migration18(database)
      throw new Error('Injected migration failure')
    }
    expect(() => initDb()).toThrow('Injected migration failure')
    expect(getDb().pragma('user_version', { simple: true })).toBe(17)
    expect(snapshot(getDb())).toEqual(before)
    withBackup((backup) => expect(snapshot(backup)).toEqual(before))

    migrations[17] = migration18
    getDb().prepare('UPDATE fragments SET content = ? WHERE id = 1').run('saved before retry')
    const retrySnapshot = snapshot(getDb())
    closeDb()
    expect(initDb().version).toBe(migrations.length)
    withBackup((backup) => expect(snapshot(backup)).toEqual(retrySnapshot))
    expect(readdirSync(join(environment.directory, 'backups'))).toEqual(['pre-migration-v17.db'])
  })

  it('removes snapshot temp files left behind by an interrupted launch', () => {
    seedLegacy().close()
    const backups = join(environment.directory, 'backups')
    mkdirSync(backups)
    const stale = 'pre-migration-v17.db.00000000-0000-0000-0000-000000000000.tmp'
    writeFileSync(join(backups, stale), 'partial snapshot')
    writeFileSync(join(backups, `${stale}-journal`), 'journal of the partial snapshot')
    initDb()
    expect(readdirSync(backups)).toEqual(['pre-migration-v17.db'])
  })

  it('removes snapshot temp files on a start that needs no migration', () => {
    seedLegacy().close()
    initDb()
    closeDb()
    // 1.0.28 workspaces already at the latest version still carry temp files from killed starts
    const backups = join(environment.directory, 'backups')
    const stale = 'pre-migration-v18.db.00000000-0000-0000-0000-000000000000.tmp'
    writeFileSync(join(backups, stale), 'partial snapshot')
    writeFileSync(join(backups, `${stale}-journal`), 'journal of the partial snapshot')
    expect(initDb().version).toBe(migrations.length)
    expect(readdirSync(backups)).toEqual(['pre-migration-v17.db'])
  })

  it('refuses a database from a newer app version without backing it up', () => {
    const old = seedLegacy()
    old.pragma(`user_version = ${migrations.length + 1}`)
    old.close()
    expect(() => initDb()).toThrow(`DB version ${migrations.length + 1} is newer than app supports`)
    expect(getDb().pragma('user_version', { simple: true })).toBe(migrations.length + 1)
    expect(readdirSync(environment.directory)).not.toContain('backups')
  })

  it('does not re-run a migration that another launch applied while this one waited', async () => {
    // 1.0.27 workspace (v18). A second process holds the write lock, applies v19 and commits
    // after this process has already read user_version 18 — the 1.0.28 double-launch race.
    const old = seedLegacy()
    old.transaction(() => {
      migrations[17](old)
      old.pragma('user_version = 18')
    })()
    old.close()
    const other = spawn(
      process.execPath,
      [
        '-e',
        `const db = new (require(process.argv[1]))(process.argv[2], { timeout: 5000 })
         db.exec('BEGIN IMMEDIATE')
         console.log('locked')
         Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
         db.exec('CREATE INDEX idx_images_file_path ON images(file_path)')
         db.pragma('user_version = 19')
         db.exec('COMMIT')
         db.close()`,
        createRequire(import.meta.url).resolve('better-sqlite3'),
        path()
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] }
    )
    const exited = new Promise((resolve) => other.on('exit', resolve))
    await new Promise((resolve) => other.stdout.once('data', resolve))

    expect(initDb().version).toBe(migrations.length)
    expect(await exited).toBe(0)
    expect(getDb().pragma('user_version', { simple: true })).toBe(migrations.length)
    const indexes = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .all('idx_images_file_path')
    expect(indexes).toHaveLength(1)
  })

  it('does not migrate if the backup directory cannot be created', () => {
    const old = seedLegacy()
    const before = snapshot(old)
    old.close()
    writeFileSync(join(environment.directory, 'backups'), 'blocked directory')
    expect(() => initDb()).toThrow()
    expect(getDb().pragma('user_version', { simple: true })).toBe(17)
    expect(snapshot(getDb())).toEqual(before)
  })

  it('cleans incomplete snapshots and stops before migration when publication fails', () => {
    seedLegacy().close()
    mkdirSync(backupPath(), { recursive: true }) // An invalid destination, simulating a rename failure.
    expect(() => initDb()).toThrow()
    expect(getDb().pragma('user_version', { simple: true })).toBe(17)
    expect(readdirSync(join(environment.directory, 'backups'))).toEqual(['pre-migration-v17.db'])
  })
})

describe('language initialization from database creation', () => {
  it('retains Korean for existing data even when the settings table is empty', () => {
    seedLegacy({ withSettings: false }).close()
    const initialized = initDb()
    expect(initialized.isNewDatabase).toBe(false)
    expect(getDb().prepare('SELECT * FROM settings').all()).toEqual([])
    expect(resolveInitialLanguage(initialized.isNewDatabase)).toBe('ko')
    expect(getDb().prepare("SELECT value FROM settings WHERE key = 'ui_language'").get()).toEqual({
      value: 'ko'
    })
  })

  it.each(['ko', 'en', 'zh-CN'])(
    'preserves a saved %s preference regardless of the OS locale',
    (language) => {
      seedLegacy({ language }).close()
      const initialized = initDb()
      environment.locale = 'ja-JP'
      expect(resolveInitialLanguage(initialized.isNewDatabase)).toBe(language)
    }
  )

  it.each([
    ['ko-KR', 'ko'],
    ['en-US', 'en'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hant-TW', 'en']
  ])('uses %s only for a newly created DB, then persists %s', (locale, expected) => {
    environment.locale = locale
    const initialized = initDb()
    expect(initialized.isNewDatabase).toBe(true)
    expect(resolveInitialLanguage(initialized.isNewDatabase)).toBe(expected)
    closeDb()
    environment.locale = 'ja-JP'
    const reopened = initDb()
    expect(reopened.isNewDatabase).toBe(false)
    expect(resolveInitialLanguage(reopened.isNewDatabase)).toBe(expected)
  })

  it('takes the conservative existing-install path for an already present empty DB file', () => {
    writeFileSync(path(), '')
    const initialized = initDb()
    expect(initialized.isNewDatabase).toBe(false)
    expect(resolveInitialLanguage(initialized.isNewDatabase)).toBe('ko')
  })
})

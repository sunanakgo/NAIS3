import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importNais2 } from '../src/main/backup/nais2'
import { captureBackupDatabase, restoreBackupDatabase } from '../src/main/backup/repo'
import { closeDb, getDb, initDb, snapshotBeforeImport } from '../src/main/db'
import { migrations } from '../src/main/db/migrations'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'en' },
  BrowserWindow: {},
  dialog: {}
}))

const snapshotDir = (): string => join(environment.directory, 'backups', 'pre-import')
const snapshotFiles = (): string[] => readdirSync(snapshotDir()).sort()

function characterNames(database: Database.Database = getDb()): string[] {
  return database
    .prepare('SELECT name FROM character_prompts ORDER BY id')
    .pluck()
    .all() as string[]
}

function fragmentContent(name: string): string {
  return getDb().prepare('SELECT content FROM fragments WHERE name = ?').pluck().get(name) as string
}

const nais2Characters = {
  'nais2-character-prompts': {
    state: { characters: [{ name: 'imported', prompt: 'imported prompt' }] }
  }
}

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-import-snapshot-'))
  initDb()
  getDb()
    .prepare('INSERT INTO character_prompts (name, prompt) VALUES (?, ?)')
    .run('existing', 'existing prompt')
  getDb().prepare('INSERT INTO fragments (name, content) VALUES (?, ?)').run('kept', 'before')
})

afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

describe('snapshot before a backup import', () => {
  it('keeps the characters a NAIS2 import replaces', () => {
    const before = characterNames()
    expect(before).toContain('existing')

    importNais2(nais2Characters, { beforeReplace: snapshotBeforeImport })

    expect(characterNames()).toEqual(['imported'])
    const [file, ...rest] = snapshotFiles()
    expect(rest).toEqual([])
    const snapshot = new Database(join(snapshotDir(), file), { readonly: true })
    try {
      expect(characterNames(snapshot)).toEqual(before)
      expect(snapshot.pragma('user_version', { simple: true })).toBe(migrations.length)
    } finally {
      snapshot.close()
    }
  })

  it('leaves the workspace unchanged when the snapshot fails', () => {
    const before = characterNames()
    const fail = (): void => {
      throw new Error('disk full')
    }

    expect(() => importNais2(nais2Characters, { beforeReplace: fail })).toThrow('disk full')
    expect(characterNames()).toEqual(before)

    const { database } = captureBackupDatabase()
    getDb().prepare('UPDATE fragments SET content = ? WHERE name = ?').run('after', 'kept')
    expect(() => restoreBackupDatabase(database, { beforeReplace: fail })).toThrow('disk full')
    expect(fragmentContent('kept')).toBe('after')
  })

  it('does not snapshot a backup it rejects', () => {
    const { database } = captureBackupDatabase()
    database.tables.fragments = [{ id: 1, name: 'x', content: 'y', unknown_column: 1 }]
    const beforeReplace = vi.fn(snapshotBeforeImport)

    expect(() => restoreBackupDatabase(database, { beforeReplace })).toThrow(
      'Unknown fragments column: unknown_column'
    )
    expect(beforeReplace).not.toHaveBeenCalled()
    expect(existsSync(snapshotDir())).toBe(false)
  })

  it('keeps the newest import snapshots apart from the upgrade snapshots', () => {
    const backups = join(environment.directory, 'backups')
    mkdirSync(snapshotDir(), { recursive: true })
    const older = [1, 2, 3].map((day) => `pre-import-2020-01-0${day}T00-00-00-000Z.db`)
    for (const name of older) writeFileSync(join(snapshotDir(), name), 'old snapshot')
    writeFileSync(join(snapshotDir(), 'pre-import-interrupted.db.abc.tmp'), 'partial')
    writeFileSync(join(backups, 'pre-migration-v17.db'), 'upgrade snapshot')

    const created = snapshotBeforeImport()

    expect(snapshotFiles()).toEqual([older[1], older[2], basename(created)])
    expect(readdirSync(backups).sort()).toEqual(['pre-import', 'pre-migration-v17.db'])
  })
})

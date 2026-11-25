import Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countWorkspace,
  dismissRecoveryNotice,
  findRecoveryNotice,
  listRecoverableBackups,
  restoreRecoverableBackup
} from '../src/main/backup/recovery'
import { closeDb, getDb, getDbPath, initDb } from '../src/main/db'
import { migrations } from '../src/main/db/migrations'
import { DEFAULT_DANBOORU_FRAGMENTS } from '../src/main/fragments/defaults'
import { totalWorkspaceCount } from '../src/shared/workspace-counts'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'en' },
  BrowserWindow: {},
  dialog: {}
}))

const at = (path: string): string => join(environment.directory, path)

function addCharacter(name: string, database: Database.Database = getDb()): void {
  database
    .prepare('INSERT INTO character_prompts (name, prompt) VALUES (?, ?)')
    .run(name, `${name} prompt`)
}

function characterNames(database: Database.Database = getDb()): string[] {
  return database
    .prepare('SELECT name FROM character_prompts ORDER BY id')
    .pluck()
    .all() as string[]
}

function setModified(path: string, iso: string): void {
  utimesSync(path, new Date(iso), new Date(iso))
}

/** 지금 DB를 백업 이름 규칙의 경로에 남긴다. edit로 백업 쪽만 고칠 수 있다 */
function writeBackup(
  id: string,
  modified: string,
  edit?: (database: Database.Database) => void
): string {
  const path = at(id)
  mkdirSync(dirname(path), { recursive: true })
  getDb().prepare('VACUUM INTO ?').run(path)
  if (edit) {
    const database = new Database(path)
    try {
      edit(database)
    } finally {
      database.close()
    }
  }
  setModified(path, modified)
  return path
}

/** 업데이트 직전 원본처럼 nais3.db와 -wal을 바이트 그대로 복사한다 */
function copyLiveDatabase(id: string, modified: string): string {
  const path = at(id)
  mkdirSync(dirname(path), { recursive: true })
  copyFileSync(getDbPath(), path)
  copyFileSync(`${getDbPath()}-wal`, `${path}-wal`)
  setModified(path, modified)
  return path
}

const restoreTemps = (): string[] =>
  readdirSync(environment.directory).filter((name) => name.includes('.restore-'))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-backup-recovery-'))
  initDb()
})

afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

describe('workspace counts', () => {
  it('treats a fresh database as empty', () => {
    expect(totalWorkspaceCount(countWorkspace(getDb()))).toBe(0)
  })

  it('counts user data and edited default fragments', () => {
    addCharacter('mine')
    const [first] = DEFAULT_DANBOORU_FRAGMENTS
    getDb()
      .prepare('UPDATE fragments SET content = ? WHERE name = ?')
      .run(`${first.content}\nedited`, first.name)
    getDb().prepare('INSERT INTO fragments (name, content) VALUES (?, ?)').run('own', 'a')

    const counts = countWorkspace(getDb())
    expect(counts.characters).toBe(1)
    expect(counts.fragments).toBe(2)
    expect(totalWorkspaceCount(counts)).toBe(3)
  })
})

describe('recoverable backup list', () => {
  it('lists every kind of app backup with data, newest first', () => {
    addCharacter('kept')
    copyLiveDatabase('upgrade-backups/schema-v19/nais3.db', '2026-01-01T00:00:00Z')
    writeBackup('backups/pre-migration-v19.db', '2026-01-02T00:00:00Z', (database) =>
      database.pragma('user_version = 19')
    )
    writeBackup('backups/auto-2026-01-03.db', '2026-01-03T00:00:00Z')
    writeBackup('backups/pre-import/pre-import-2026-01-04.db', '2026-01-04T00:00:00Z')
    writeBackup(
      'backups/pre-restore/pre-restore-2026-01-05.db',
      '2026-01-05T00:00:00Z',
      (database) => addCharacter('extra', database)
    )

    const { items, current } = listRecoverableBackups()

    expect(current.characters).toBe(1)
    expect(items.map((item) => [item.id, item.kind, item.schemaVersion])).toEqual([
      ['backups/pre-restore/pre-restore-2026-01-05.db', 'restore', migrations.length],
      ['backups/pre-import/pre-import-2026-01-04.db', 'import', migrations.length],
      ['backups/auto-2026-01-03.db', 'auto', migrations.length],
      ['backups/pre-migration-v19.db', 'upgrade', 19],
      ['upgrade-backups/schema-v19/nais3.db', 'upgrade-original', migrations.length]
    ])
    expect(items.map((item) => item.counts.characters)).toEqual([2, 1, 1, 1, 1])
    expect(items.map((item) => item.hasMoreThanCurrent)).toEqual([true, false, false, false, false])
  })

  it('skips empty, newer, corrupt and unrelated files', () => {
    writeBackup('backups/auto-empty.db', '2026-01-01T00:00:00Z')
    addCharacter('kept')
    writeBackup('backups/pre-migration-v99.db', '2026-01-02T00:00:00Z', (database) =>
      database.pragma(`user_version = ${migrations.length + 1}`)
    )
    mkdirSync(at('backups/pre-import'), { recursive: true })
    writeFileSync(at('backups/pre-import/pre-import-broken.db'), 'not a database')
    writeBackup('backups/notes.db', '2026-01-03T00:00:00Z')
    writeBackup('backups/pre-import/other-name.db', '2026-01-03T00:00:00Z')

    expect(listRecoverableBackups().items).toEqual([])
  })

  it('removes only the sidecar files the scan created', () => {
    addCharacter('kept')
    const original = copyLiveDatabase('upgrade-backups/schema-v20/nais3.db', '2026-01-01T00:00:00Z')
    const snapshot = writeBackup('backups/pre-import/pre-import-a.db', '2026-01-02T00:00:00Z')

    expect(listRecoverableBackups().items).toHaveLength(2)

    expect(existsSync(`${original}-wal`)).toBe(true)
    expect(existsSync(`${original}-shm`)).toBe(false)
    expect(existsSync(`${snapshot}-wal`)).toBe(false)
    expect(existsSync(`${snapshot}-shm`)).toBe(false)
  })
})

describe('recovery notice', () => {
  it('appears only while the workspace is empty', () => {
    addCharacter('kept')
    writeBackup('backups/pre-import/pre-import-a.db', '2026-01-01T00:00:00Z')
    expect(findRecoveryNotice()).toBeNull()

    getDb().prepare('DELETE FROM character_prompts').run()

    expect(findRecoveryNotice()?.id).toBe('backups/pre-import/pre-import-a.db')
  })

  it('stays dismissed for that backup and returns for a newer one', () => {
    addCharacter('kept')
    writeBackup('backups/pre-import/pre-import-a.db', '2026-01-02T00:00:00Z')
    const older = writeBackup('backups/pre-migration-v20.db', '2026-01-01T00:00:00Z')
    getDb().prepare('DELETE FROM character_prompts').run()

    dismissRecoveryNotice('backups/pre-import/pre-import-a.db')
    expect(findRecoveryNotice()).toBeNull()

    // pre-migration-v{N}.db는 같은 이름으로 다시 쓰인다 — 새로 쓴 파일은 다른 백업이다
    setModified(older, '2026-01-03T00:00:00Z')
    expect(findRecoveryNotice()?.id).toBe('backups/pre-migration-v20.db')
  })
})

describe('restore', () => {
  it('replaces the database and keeps the current one as a pre-restore snapshot', () => {
    addCharacter('before')
    writeBackup('backups/pre-import/pre-import-a.db', '2026-01-01T00:00:00Z')
    getDb().prepare('DELETE FROM character_prompts').run()
    addCharacter('after')

    restoreRecoverableBackup('backups/pre-import/pre-import-a.db')

    expect(() => getDb()).toThrow()
    expect(restoreTemps()).toEqual([])
    const [snapshot, ...rest] = readdirSync(at('backups/pre-restore'))
    expect(rest).toEqual([])
    const kept = new Database(at(`backups/pre-restore/${snapshot}`), { readonly: true })
    try {
      expect(characterNames(kept)).toEqual(['after'])
    } finally {
      kept.close()
    }

    initDb()
    expect(characterNames()).toEqual(['before'])
    expect(listRecoverableBackups().items.map((item) => item.kind)).toEqual(['restore', 'import'])
  })

  it('restores a byte copy that still has its -wal', () => {
    addCharacter('before')
    const original = copyLiveDatabase('upgrade-backups/schema-v20/nais3.db', '2026-01-01T00:00:00Z')
    getDb().prepare('DELETE FROM character_prompts').run()

    restoreRecoverableBackup('upgrade-backups/schema-v20/nais3.db')

    expect(existsSync(`${original}-wal`)).toBe(true)
    initDb()
    expect(characterNames()).toEqual(['before'])
  })

  it('changes nothing for an unknown or unsupported backup', () => {
    addCharacter('current')
    writeBackup('backups/pre-migration-v99.db', '2026-01-01T00:00:00Z', (database) =>
      database.pragma(`user_version = ${migrations.length + 1}`)
    )

    expect(() => restoreRecoverableBackup('backups/missing.db')).toThrow()
    expect(() => restoreRecoverableBackup('../outside.db')).toThrow()
    expect(() => restoreRecoverableBackup('backups/pre-migration-v99.db')).toThrow()

    expect(characterNames()).toEqual(['current'])
    expect(existsSync(at('backups/pre-restore'))).toBe(false)
    expect(restoreTemps()).toEqual([])
  })
})

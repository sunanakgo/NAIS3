import Database from 'better-sqlite3'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { basename, dirname, join, relative, sep } from 'path'
import type { RecoverableBackup, RecoverableBackupKind, WorkspaceCounts } from '../../shared/types'
import { totalWorkspaceCount } from '../../shared/workspace-counts'
import {
  closeDb,
  getBackupDir,
  getDb,
  getDbPath,
  getUpgradeBackupDir,
  initDb,
  snapshotBeforeRestore
} from '../db'
import { migrations } from '../db/migrations'
import { getSetting, setSetting } from '../db/settings'
import { DEFAULT_DANBOORU_FRAGMENTS } from '../fragments/defaults'
import { t } from '../i18n'

/**
 * 앱이 데이터 폴더 안에 스스로 남긴 DB 백업(업데이트·가져오기·복원 직전)을 찾아 데이터 수를 세고,
 * 그중 하나로 작업 공간 전체를 되돌린다.
 *
 * 데이터가 사라졌다고 알릴 근거는 "지금 작업 공간은 비었는데 백업에는 데이터가 있다"뿐이다 —
 * 일부만 지운 것은 사용자가 의도했을 수 있어 알리지 않고, 설정의 백업 목록에서만 조용히 표시한다.
 */

const COUNTED_TABLES = {
  characters: 'character_prompts',
  fragments: 'fragments',
  promptPresets: 'prompt_presets',
  scenes: 'gen_scenes',
  history: 'images',
  library: 'library_images',
  vibes: 'vibe_images',
  characterReferences: 'charref_images'
} as const satisfies Record<keyof WorkspaceCounts, string>

/** 이미 닫은 알림의 백업 (id·크기·수정 시각) — 같은 파일이면 다시 띄우지 않는다 */
const DISMISSED_NOTICE_KEY = 'recovery_notice_dismissed'

/** 오래된 스키마는 일부 테이블이 없다 — 있는 테이블만 센다 */
export function countWorkspace(database: Database.Database): WorkspaceCounts {
  const tables = new Set(
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all()
  )
  const count = (table: string): number =>
    tables.has(table)
      ? (database.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number)
      : 0
  const counts = {} as WorkspaceCounts
  for (const [key, table] of Object.entries(COUNTED_TABLES)) {
    counts[key as keyof WorkspaceCounts] = count(table)
  }
  // 새 DB가 넣는 기본 조각은 내용을 고치지 않았으면 사용자 데이터가 아니다
  if (counts.fragments > 0) {
    const untouched = database
      .prepare('SELECT COUNT(*) FROM fragments WHERE name = ? AND content = ?')
      .pluck()
    for (const fragment of DEFAULT_DANBOORU_FRAGMENTS) {
      counts.fragments -= untouched.get(fragment.name, fragment.content) as number
    }
  }
  return counts
}

interface BackupFile {
  id: string
  kind: RecoverableBackupKind
  path: string
  /** 같은 이름이라도 다시 쓴 파일은 다른 백업이다 (pre-migration-v{N}.db는 덮어쓴다) */
  key: string
  createdAt: number
}

function listNames(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** 열지 않고 파일만 찾는다. 이름 규칙에 맞는 파일만 — 사용자가 넣어 둔 다른 파일은 건드리지 않는다 */
function backupFiles(): BackupFile[] {
  const root = app.getPath('userData')
  const files: BackupFile[] = []
  const add = (path: string, kind: RecoverableBackupKind): void => {
    try {
      const stat = statSync(path)
      if (!stat.isFile()) return
      const id = relative(root, path).split(sep).join('/')
      files.push({
        id,
        kind,
        path,
        key: `${id}:${stat.size}:${stat.mtimeMs}`,
        createdAt: stat.mtimeMs
      })
    } catch {
      // 그사이 지워졌거나 읽을 수 없다
    }
  }

  const upgradeDir = getUpgradeBackupDir()
  for (const name of listNames(upgradeDir)) {
    if (/^schema-v\d+$/.test(name))
      add(join(upgradeDir, name, basename(getDbPath())), 'upgrade-original')
  }
  const backupDir = getBackupDir()
  for (const name of listNames(backupDir)) {
    if (/^pre-migration-v\d+\.db$/.test(name)) add(join(backupDir, name), 'upgrade')
    else if (/^auto-.+\.db$/.test(name)) add(join(backupDir, name), 'auto')
  }
  for (const [folder, kind] of [
    ['pre-import', 'import'],
    ['pre-restore', 'restore']
  ] as const) {
    const dir = join(backupDir, folder)
    for (const name of listNames(dir)) {
      if (name.startsWith(`${folder}-`) && name.endsWith('.db')) add(join(dir, name), kind)
    }
  }
  return files
}

/**
 * 백업을 읽기 전용으로 연다. WAL 모드 DB는 읽기 전용으로 열어도 SQLite가 -wal/-shm을 만든다 —
 * 원래 없던 것만 닫은 뒤 지운다 (업데이트 직전 원본 옆의 -wal은 그 원본의 일부라 남긴다)
 */
function withReadOnlyBackup<T>(path: string, read: (database: Database.Database) => T): T {
  const created = [`${path}-wal`, `${path}-shm`].filter((sidecar) => !existsSync(sidecar))
  let database: Database.Database | undefined
  try {
    database = new Database(path, { readonly: true, fileMustExist: true })
    return read(database)
  } finally {
    database?.close()
    for (const sidecar of created) rmSync(sidecar, { force: true })
  }
}

/** 이 앱이 열 수 있는 스키마인지 — 0은 빈 파일, 지금보다 높으면 더 새 버전 앱이 쓴 DB */
function isSupportedVersion(version: number): boolean {
  return version >= 1 && version <= migrations.length
}

function readBackup(file: BackupFile): { schemaVersion: number; counts: WorkspaceCounts } | null {
  try {
    return withReadOnlyBackup(file.path, (database) => {
      const schemaVersion = database.pragma('user_version', { simple: true }) as number
      if (!isSupportedVersion(schemaVersion)) return null
      return { schemaVersion, counts: countWorkspace(database) }
    })
  } catch {
    // 손상됐거나 SQLite 파일이 아니다 — 복원할 수 없으니 목록에서 뺀다
    return null
  }
}

interface ScannedBackup {
  backup: RecoverableBackup
  key: string
}

function scanBackups(current: WorkspaceCounts): ScannedBackup[] {
  const currentTotal = totalWorkspaceCount(current)
  const scanned: ScannedBackup[] = []
  for (const file of backupFiles()) {
    const read = readBackup(file)
    if (!read) continue
    const total = totalWorkspaceCount(read.counts)
    // 빈 백업은 되돌려도 얻는 것이 없다
    if (total === 0) continue
    scanned.push({
      key: file.key,
      backup: {
        id: file.id,
        kind: file.kind,
        createdAt: file.createdAt,
        schemaVersion: read.schemaVersion,
        counts: read.counts,
        hasMoreThanCurrent: total > currentTotal
      }
    })
  }
  return scanned.sort((a, b) => b.backup.createdAt - a.backup.createdAt)
}

export function listRecoverableBackups(): {
  items: RecoverableBackup[]
  current: WorkspaceCounts
} {
  const current = countWorkspace(getDb())
  return { items: scanBackups(current).map((entry) => entry.backup), current }
}

/**
 * 지금 작업 공간이 비었고 데이터가 남은 백업이 있으면 가장 최근 것을 알린다.
 * 비어 있지 않으면 백업을 열지 않는다 — 평소 시작에는 테이블 몇 개를 세는 비용뿐이다
 */
export function findRecoveryNotice(): RecoverableBackup | null {
  removeRestoreTemps()
  const current = countWorkspace(getDb())
  if (totalWorkspaceCount(current) > 0) return null
  const [newest] = scanBackups(current)
  if (!newest || getSetting(DISMISSED_NOTICE_KEY) === newest.key) return null
  return newest.backup
}

export function dismissRecoveryNotice(id: string): void {
  const file = backupFiles().find((entry) => entry.id === id)
  if (file) setSetting(DISMISSED_NOTICE_KEY, file.key)
}

const RESTORE_TEMP_PREFIX = '.restore-'

/** 복원 도중 종료돼 데이터 폴더에 남은 DB 크기만 한 임시 파일 정리 */
function removeRestoreTemps(): void {
  const dbPath = getDbPath()
  const prefix = `${basename(dbPath)}${RESTORE_TEMP_PREFIX}`
  for (const name of listNames(dirname(dbPath))) {
    if (!name.startsWith(prefix) || !(name.endsWith('.tmp') || name.endsWith('.tmp-journal')))
      continue
    try {
      rmSync(join(dirname(dbPath), name), { force: true })
    } catch {
      // 다른 프로그램이 잡고 있으면 다음 기회에 — 이름이 매번 달라 새 복원과 겹치지 않는다
    }
  }
}

/**
 * 고른 백업으로 nais3.db를 바꾼다. 성공하면 DB가 닫힌 채로 돌아온다 — 호출한 쪽이 앱을 다시 시작한다.
 * 실패하면 지금 DB를 그대로 둔 채 열어 놓고 오류를 던진다.
 *
 * 1. 렌더러가 보낸 id는 경로로 쓰지 않고 백업 목록에서 다시 찾는다
 * 2. 백업을 읽기 전용으로 열어 데이터 폴더 안 임시 파일로 VACUUM INTO — 백업 원본은 바뀌지 않는다
 * 3. 지금 DB를 backups/pre-restore/에 남긴다 (실패하면 아무것도 바꾸지 않는다)
 * 4. 지금 DB를 체크포인트하고 닫은 뒤 -wal/-shm을 지우고 임시 파일을 nais3.db 자리에 바꿔 단다.
 *    남은 -wal은 새 DB에 엉뚱하게 적용되므로 반드시 먼저 지운다
 *
 * 백업이 더 낮은 스키마면 다음 시작에서 평소 업데이트처럼 백업을 남기고 마이그레이션한다.
 */
export function restoreRecoverableBackup(id: string): void {
  const file = backupFiles().find((entry) => entry.id === id)
  if (!file) throw new Error(t('ui.recoveryBackupMissing'))
  const dbPath = getDbPath()
  removeRestoreTemps()
  const replacement = `${dbPath}${RESTORE_TEMP_PREFIX}${randomUUID()}.tmp`
  try {
    withReadOnlyBackup(file.path, (database) => {
      const version = database.pragma('user_version', { simple: true }) as number
      if (!isSupportedVersion(version)) throw new Error(t('ui.recoveryBackupUnsupported'))
      database.prepare('VACUUM INTO ?').run(replacement)
    })
    snapshotBeforeRestore()
    replaceDatabase(replacement, dbPath)
  } finally {
    rmSync(replacement, { force: true })
  }
}

function replaceDatabase(replacement: string, dbPath: string): void {
  getDb().pragma('wal_checkpoint(TRUNCATE)')
  closeDb()
  try {
    const wal = `${dbPath}-wal`
    // 깨끗이 닫혔으면 -wal은 지워졌거나 비어 있다. 내용이 남았다면 이 DB의 마지막 쓰기라 지우지 않는다
    if (existsSync(wal) && statSync(wal).size > 0) throw new Error(t('ui.recoveryDatabaseBusy'))
    rmSync(wal, { force: true })
    rmSync(`${dbPath}-shm`, { force: true })
    renameSync(replacement, dbPath)
  } catch (error) {
    // 바꿔 달기 전이면 원래 파일 그대로다 — 다시 열어 앱을 계속 쓸 수 있게 한다
    initDb()
    throw error
  }
}

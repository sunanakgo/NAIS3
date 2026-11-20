import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from 'fs'
import { basename, join } from 'path'
import { migrations } from './migrations'

// electron에 의존하지 않는다 — 메인 스레드(initDb)와 마이그레이션 워커(migrate.worker.ts)가 같이 쓴다

export interface MigrationWorkerData {
  path: string
  backupDir: string
  upgradeBackupDir: string
}

/** 워커는 DB를 연 직후 opened를, 끝나면 done 또는 error를 보낸다 */
export type MigrationWorkerMessage =
  // 언어 값은 검증 전 그대로 — i18n 카탈로그를 워커 번들에 넣지 않는다
  | { type: 'opened'; pending: boolean; uiLanguage: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }

export function openDatabase(path: string, options?: Database.Options): Database.Database {
  const db = new Database(path, options)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

/** 백업·마이그레이션이 남은 기존 DB인지. 새 DB(버전 0)는 백업이 없어 금방 끝난다 */
export function hasPendingUpgrade(db: Database.Database): boolean {
  const version = db.pragma('user_version', { simple: true }) as number
  return version > 0 && version < migrations.length
}

/** 저장된 UI 언어 (없으면 undefined). settings 테이블이 없는 아주 오래된 DB도 있다 */
export function readUiLanguage(db: Database.Database): unknown {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ui_language'").get() as
      { value: unknown } | undefined
    return row?.value
  } catch {
    return undefined
  }
}

/**
 * 남은 마이그레이션 적용.
 *
 * 안전장치 (NAIS2 세이브 유실 문제의 근본 대책):
 * - 마이그레이션 필요 시 실행 전 원본 파일 복사본(upgradeBackupDir/schema-v{N}/, 지우지 않음)과
 *   스냅샷(backupDir/pre-migration-v{N}.db) 자동 생성 — 둘 중 하나라도 실패하면 마이그레이션하지 않는다
 * - 각 마이그레이션은 개별 트랜잭션: 실패하면 해당 버전 이전 상태로 남고 앱은 에러 표면화
 */
export function migrate(db: Database.Database, backupDir: string, upgradeBackupDir: string): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const target = migrations.length
  assertSupportedVersion(current, target)
  // 마이그레이션이 필요 없는 실행에서도 정리한다 — 1.0.28 첫 실행을 강제 종료하며 쌓인 .tmp는
  // 이미 v20까지 올라간 DB 옆에 남아 있다
  removeSnapshotTemps(backupDir)
  removeUpgradeCopyTemps(upgradeBackupDir)
  if (current === target) return

  if (current > 0) {
    // 원본 복사가 먼저 — 스냅샷은 SQLite가 다시 써서 만든 사본이라, 손상된 페이지가 있으면
    // 실패하거나 원본과 달라질 수 있다
    copyOriginalFiles(db, upgradeBackupDir, current)
    backupBeforeMigration(db, backupDir, current)
  }
  // 버전은 쓰기 잠금(IMMEDIATE)을 잡은 뒤 다시 읽는다 — 같은 DB를 연 다른 프로세스가 먼저
  // 적용한 마이그레이션을 또 실행해 "index ... already exists"로 실패하지 않도록
  const migrateNext = db.transaction((): boolean => {
    const v = db.pragma('user_version', { simple: true }) as number
    // 그사이 다른 프로세스가 더 새 버전으로 올렸을 수도 있다 — 첫 확인만으로는 막지 못한다
    assertSupportedVersion(v, target)
    if (v === target) return false
    migrations[v](db)
    db.pragma(`user_version = ${v + 1}`)
    return true
  })
  while (migrateNext.immediate()) {
    /* 한 버전씩 개별 트랜잭션으로 적용 */
  }
}

function assertSupportedVersion(version: number, target: number): void {
  // 다운그레이드된 앱이 미래 버전 DB를 여는 상황 — 조용히 진행하면 데이터가 깨진다
  if (version > target) {
    throw new Error(
      `DB version ${version} is newer than app supports (${target}). ` +
        'NAIS3를 최신 버전으로 업데이트하세요.'
    )
  }
}

function backupBeforeMigration(
  db: Database.Database,
  backupDir: string,
  fromVersion: number
): void {
  mkdirSync(backupDir, { recursive: true })
  writeSnapshot(db, join(backupDir, `pre-migration-v${fromVersion}.db`))
  pruneBackups(backupDir, 10)
}

/**
 * 이전 버전 앱이 남긴 DB 파일(과 체크포인트되지 않은 WAL)을 바이트 그대로 upgradeBackupDir/schema-v{N}/에
 * 복사한다. 이 연결은 아직 아무것도 쓰지 않았고 다른 실행은 single-instance 잠금으로 막혀 있어 파일이
 * 복사 도중 바뀌지 않는다. 여기는 정리(prune)하지 않는다 — 업데이트 뒤 데이터가 사라졌을 때
 * 사용자가 직접 되돌릴 수 있는 원본이다.
 *
 * 같은 버전의 복사본이 이미 있으면 그대로 둔다: 업그레이드가 중단돼 다시 시작할 때마다 큰 DB를 또
 * 복사하지 않고, 처음 남긴 원본을 덮어쓰지 않는다. DB 파일은 임시 이름으로 복사한 뒤 바꿔 달아,
 * 복사 도중 종료돼도 반쪽짜리 nais3.db가 완성된 복사본으로 남지 않는다.
 */
function copyOriginalFiles(db: Database.Database, upgradeBackupDir: string, version: number): void {
  const folder = join(upgradeBackupDir, `schema-v${version}`)
  const name = basename(db.name)
  const destination = join(folder, name)
  if (existsSync(destination)) return
  mkdirSync(folder, { recursive: true })
  // WAL을 먼저 — DB 파일이 생겨야 완성된 복사본이다. 중단된 이전 시도의 WAL은 버린다
  const wal = `${db.name}-wal`
  const walCopy = `${destination}-wal`
  rmSync(walCopy, { force: true })
  if (existsSync(wal) && statSync(wal).size > 0) copyOpenFile(wal, walCopy)
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    copyOpenFile(db.name, temporary)
    renameSync(temporary, destination)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/**
 * 이 프로세스가 열어 둔 DB 파일도 복사하고, 마이그레이션이 커밋되기 전에 디스크에 내려 둔다.
 * copyFileSync는 Windows에서 CopyFile을 쓰는데, 다른 핸들이 쓰기 권한으로 연 파일은 공유 위반으로
 * 거부될 수 있다 — fs.openSync는 읽기·쓰기·삭제 공유를 모두 열어 둔다
 */
function copyOpenFile(source: string, destination: string): void {
  const input = openSync(source, 'r')
  try {
    const output = openSync(destination, 'w')
    try {
      const buffer = Buffer.allocUnsafe(4 * 1024 * 1024)
      let length: number
      while ((length = readSync(input, buffer, 0, buffer.length, null)) > 0) {
        for (let offset = 0; offset < length;)
          offset += writeSync(output, buffer, offset, length - offset)
      }
      fsyncSync(output)
    } finally {
      closeSync(output)
    }
  } finally {
    closeSync(input)
  }
}

/** Include committed WAL pages and replace an older backup only after the snapshot succeeds. */
export function writeSnapshot(db: Database.Database, destination: string): void {
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    db.prepare('VACUUM INTO ?').run(temporary)
    renameSync(temporary, destination)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/**
 * 스냅샷 도중 강제 종료되면 DB 크기만 한 .tmp(와 그 -journal)가 남는다 — 실행마다 쌓여
 * 디스크를 채우지 않게 정리
 */
export function removeSnapshotTemps(backupDir: string): void {
  if (!existsSync(backupDir)) return
  for (const f of readdirSync(backupDir)) {
    if (f.endsWith('.tmp') || f.endsWith('.tmp-journal'))
      rmSync(join(backupDir, f), { force: true })
  }
}

/** 원본 복사 도중 종료돼 schema-v{N}/ 안에 남은 임시 파일 정리 */
function removeUpgradeCopyTemps(upgradeBackupDir: string): void {
  if (!existsSync(upgradeBackupDir)) return
  for (const entry of readdirSync(upgradeBackupDir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeSnapshotTemps(join(upgradeBackupDir, entry.name))
  }
}

export function pruneBackups(backupDir: string, keep: number): void {
  const files = readdirSync(backupDir)
    .filter((f) => f.endsWith('.db'))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    rmSync(join(backupDir, f))
  }
}

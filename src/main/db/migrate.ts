import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { migrations } from './migrations'

// electron에 의존하지 않는다 — 메인 스레드(initDb)와 마이그레이션 워커(migrate.worker.ts)가 같이 쓴다

export interface MigrationWorkerData {
  path: string
  backupDir: string
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

/**
 * 남은 마이그레이션 적용.
 *
 * 안전장치 (NAIS2 세이브 유실 문제의 근본 대책):
 * - 마이그레이션 필요 시 실행 전 파일 백업 자동 생성 (pre-migration-v{N}.db)
 * - 각 마이그레이션은 개별 트랜잭션: 실패하면 해당 버전 이전 상태로 남고 앱은 에러 표면화
 */
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

export function migrate(db: Database.Database, backupDir: string): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const target = migrations.length
  assertSupportedVersion(current, target)
  // 마이그레이션이 필요 없는 실행에서도 정리한다 — 1.0.28 첫 실행을 강제 종료하며 쌓인 .tmp는
  // 이미 v20까지 올라간 DB 옆에 남아 있다
  removeSnapshotTemps(backupDir)
  if (current === target) return

  if (current > 0) {
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
function removeSnapshotTemps(backupDir: string): void {
  if (!existsSync(backupDir)) return
  for (const f of readdirSync(backupDir)) {
    if (f.endsWith('.tmp') || f.endsWith('.tmp-journal'))
      rmSync(join(backupDir, f), { force: true })
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

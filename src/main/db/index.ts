import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { isLang, type Lang } from '../../shared/i18n'
import {
  migrate,
  openDatabase,
  pruneBackups,
  writeSnapshot,
  type MigrationWorkerData,
  type MigrationWorkerMessage
} from './migrate'
import { migrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized — call initDb() first')
  return db
}

export function getDbPath(): string {
  return join(app.getPath('userData'), 'nais3.db')
}

function getBackupDir(): string {
  return join(app.getPath('userData'), 'backups')
}

/**
 * DB 열기 + 마이그레이션 (migrate.ts).
 *
 * WAL 모드: 크래시 시에도 커밋된 데이터 보존
 */
export function initDb(): { version: number; path: string; isNewDatabase: boolean } {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const path = getDbPath()
  // Capture this before SQLite creates the file. An empty settings table does not
  // mean a new installation: older workspaces may already contain user data.
  const isNewDatabase = !existsSync(path)

  db = openDatabase(path)
  migrate(db, getBackupDir())

  return { version: migrations.length, path, isNewDatabase }
}

export interface WorkspaceInfo {
  language: Lang
  /** 백업·마이그레이션이 남았는지 (진행 창 표시용) */
  pending: boolean
}

/**
 * 남은 마이그레이션을 워커 스레드에서 적용한다. 큰 워크스페이스의 백업·인덱스 생성은 몇 분 걸리는데,
 * 메인 스레드가 그동안 막히면 다시 실행한 쪽의 single-instance 확인에 답하지 못하고
 * 20초 뒤 이 프로세스가 강제 종료된다 — 업그레이드가 실행할 때마다 처음부터 다시 시작된다.
 * DB를 여는 것도 워커에서 한다: 메인 스레드 연결은 닫을 때 큰 WAL을 체크포인트할 수 있다.
 *
 * onOpened는 워커가 DB를 열자마자 그 DB의 언어·남은 업그레이드 여부로 불린다.
 * 마이그레이션 실패는 그 오류로 reject. 워커를 아예 돌리지 못했으면 false —
 * 그때는 initDb가 이전처럼 메인 스레드에서 마이그레이션한다. DB 파일이 없으면 워커 없이 true.
 */
export function migrateInWorker(
  workerFile: string,
  onOpened?: (info: WorkspaceInfo) => void
): Promise<boolean> {
  const workerData: MigrationWorkerData = { path: getDbPath(), backupDir: getBackupDir() }
  // 새 설치 — initDb가 만들고 마이그레이션한다 (백업이 없어 금방 끝난다)
  if (!existsSync(workerData.path)) return Promise.resolve(true)
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(workerFile, { workerData })
    } catch (error) {
      console.error('DB migration worker failed:', error)
      resolve(false)
      return
    }
    worker.on('message', (message: MigrationWorkerMessage) => {
      if (message.type === 'opened') {
        // 언어 설정이 없는 기존 설치는 한국어 — resolveInitialLanguage와 같은 규칙
        const language = isLang(message.uiLanguage) ? message.uiLanguage : 'ko'
        onOpened?.({ language, pending: message.pending })
      } else if (message.type === 'done') resolve(true)
      else reject(new Error(message.message))
    })
    worker.once('error', (error) => {
      console.error('DB migration worker failed:', error)
      resolve(false)
    })
    // 결과를 보내기 전에 끝난 경우만 해당 — 이미 정해진 Promise는 바뀌지 않는다
    worker.once('exit', () => resolve(false))
  })
}

/** 주기 백업용: 압축 정리된 스냅샷을 원자적으로 생성 */
export function backupNow(): string {
  const backupDir = getBackupDir()
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(backupDir, `auto-${stamp}.db`)
  writeSnapshot(getDb(), dest)
  pruneBackups(backupDir, 10)
  return dest
}

export function closeDb(): void {
  db?.close()
  db = null
}

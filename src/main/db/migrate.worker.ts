import { parentPort, workerData } from 'worker_threads'
import {
  hasPendingUpgrade,
  migrate,
  openDatabase,
  readUiLanguage,
  type MigrationWorkerData,
  type MigrationWorkerMessage
} from './migrate'

const port = parentPort
if (!port) throw new Error('DB migration worker requires a parent port')
const send = (message: MigrationWorkerMessage): void => port.postMessage(message)

const { path, backupDir } = workerData as MigrationWorkerData
try {
  // 이미 있는 DB만 연다 — 여기서 새로 만들면 initDb가 새 설치를 기존 설치로 판정한다
  const db = openDatabase(path, { fileMustExist: true })
  try {
    send({ type: 'opened', pending: hasPendingUpgrade(db), uiLanguage: readUiLanguage(db) })
    migrate(db, backupDir)
  } finally {
    // 마지막 연결이라 닫을 때 WAL 체크포인트도 여기(워커)에서 일어난다
    db.close()
  }
  send({ type: 'done' })
} catch (error) {
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
}

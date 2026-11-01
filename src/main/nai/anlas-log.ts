import { getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { anlasUsageFromSnapshots } from '../../shared/anlas-guard'

/**
 * Anlas 잔액 스냅샷 로그.
 * 사용량 = 기간 내 연속 스냅샷 간 "감소분"의 합 (충전/구매로 늘어난 구간은 무시).
 * 여러 계정의 잔액이 한 로그에 섞이므로, 계정이 바뀐 첫 행은 settings에 경계로 남겨
 * 계정 간 잔액 차이를 사용량으로 세지 않는다 (하루 상한이 잘못 걸리지 않게).
 */

const ACCOUNT_KEY = 'anlas_log_account'
const BREAKS_KEY = 'anlas_log_breaks'
const MAX_BREAKS = 500

/** accountId를 모르면(구 호출) 경계 없이 기록한다 */
export function logBalance(balance: number, accountId?: string): void {
  const db = getDb()
  const switched = accountId !== undefined && getSetting(ACCOUNT_KEY) !== accountId
  if (switched) setSetting(ACCOUNT_KEY, accountId)
  const last = db.prepare('SELECT balance FROM anlas_log ORDER BY id DESC LIMIT 1').get() as
    { balance: number } | undefined
  if (last?.balance === balance) return // 변화 없으면 기록 생략
  const { lastInsertRowid } = db.prepare('INSERT INTO anlas_log (balance) VALUES (?)').run(balance)
  if (switched && last) {
    const breaks = [...accountBreaks(), Number(lastInsertRowid)].slice(-MAX_BREAKS)
    setSetting(BREAKS_KEY, JSON.stringify(breaks))
  }
}

function accountBreaks(): Set<number> {
  try {
    const parsed: unknown = JSON.parse(getSetting(BREAKS_KEY) ?? '[]')
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : []
    )
  } catch {
    return new Set()
  }
}

function usageSince(sinceIsoUtc: string): number {
  const rows = getDb()
    .prepare(
      // 기간 직전 마지막 스냅샷 1개를 포함해야 기간 경계의 감소분을 놓치지 않는다
      `SELECT id, balance FROM anlas_log
       WHERE id >= COALESCE((SELECT MAX(id) FROM anlas_log WHERE created_at < ?), 0)
       ORDER BY id`
    )
    .all(sinceIsoUtc) as { id: number; balance: number }[]
  return anlasUsageFromSnapshots(rows, accountBreaks())
}

function utcIso(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export function anlasUsage(): { today: number; week: number } {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  return {
    today: usageSince(utcIso(startOfToday)),
    week: usageSince(utcIso(weekAgo))
  }
}

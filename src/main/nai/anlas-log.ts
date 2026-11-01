import type Database from 'better-sqlite3'
import type { AnlasUsageSummary } from '../../shared/types'
import { getDb } from '../db'

/**
 * Anlas 잔액 스냅샷 로그 (계정별).
 *
 * 사용량 = 같은 계정의 연속 스냅샷 간 "감소분"의 합 (충전/구매로 늘어난 구간은 무시).
 * 다른 계정의 스냅샷끼리는 절대 비교하지 않는다 — 5000 Anlas 계정에서 1000 Anlas 계정으로
 * 전환(수동·자동)해도 사용량은 0이다.
 *
 * 레거시 행(v21 이전, account_id IS NULL)은 어느 계정 것인지 알 수 없어 집계에서 통째로 제외한다.
 * 계정이 섞인 시계열에서는 "연속 NULL 행"끼리의 감소분도 계정 전환일 수 있으므로, 과대 집계를
 * 막는 가장 보수적인 규칙을 택했다. 그 대가로 업데이트 직후 최대 7일간은 이전 사용량이 빠진다.
 *
 * 생성별 before/after 소모량은 따로 기록하지 않는다: before 잔액을 얻으려면 매 생성 전에
 * 잔액 API를 한 번 더 호출해야 하고(계정 라우터는 V5 자동 전환 때만 조회), 같은 계정 안의
 * 연속 스냅샷 차이는 그 계정에서 일어난 소모를 빠짐없이 담는다(생성 후 조회가 실패하거나
 * 늦어져도 다음 스냅샷에서 합산된다). 다만 라우터가 이미 조회한 생성 전 잔액은 스냅샷으로
 * 남긴다 — 자동 전환된 계정의 첫 스냅샷이 생성 후 잔액이면 그 생성의 소모량이 빠지기 때문이다.
 */

export function logBalance(
  balance: number,
  accountId: string,
  db: Database.Database = getDb()
): void {
  const last = db
    .prepare('SELECT balance FROM anlas_log WHERE account_id = ? ORDER BY id DESC LIMIT 1')
    .get(accountId) as { balance: number } | undefined
  if (last?.balance === balance) return // 이 계정의 잔액 변화 없으면 기록 생략
  db.prepare('INSERT INTO anlas_log (balance, account_id) VALUES (?, ?)').run(balance, accountId)
}

export interface UsageSince {
  total: number
  byAccount: Record<string, number>
}

export function usageSince(sinceIsoUtc: string, db: Database.Database = getDb()): UsageSince {
  const rows = db
    .prepare(
      // 계정마다 기간 직전 마지막 스냅샷 1개를 포함해야 기간 경계의 감소분을 놓치지 않는다
      `SELECT account_id, balance FROM anlas_log
       WHERE account_id IS NOT NULL
         AND (created_at >= ?
           OR id IN (SELECT MAX(id) FROM anlas_log
                     WHERE account_id IS NOT NULL AND created_at < ?
                     GROUP BY account_id))
       ORDER BY id`
    )
    .all(sinceIsoUtc, sinceIsoUtc) as { account_id: string; balance: number }[]
  const previous = new Map<string, number>()
  const byAccount: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    const before = previous.get(row.account_id)
    previous.set(row.account_id, row.balance)
    byAccount[row.account_id] ??= 0
    if (before === undefined) continue
    const drop = before - row.balance
    if (drop > 0) {
      byAccount[row.account_id] += drop
      total += drop
    }
  }
  return { total, byAccount }
}

export function utcIso(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export function anlasUsage(now = new Date(), db: Database.Database = getDb()): AnlasUsageSummary {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  const today = usageSince(utcIso(startOfToday), db)
  const week = usageSince(utcIso(weekAgo), db)
  const byAccount: AnlasUsageSummary['byAccount'] = {}
  for (const id of new Set([...Object.keys(today.byAccount), ...Object.keys(week.byAccount)]))
    byAccount[id] = { today: today.byAccount[id] ?? 0, week: week.byAccount[id] ?? 0 }
  return { today: today.total, week: week.total, byAccount }
}

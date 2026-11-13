import { getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { anlasUsageFromSnapshots } from '../../shared/anlas-guard'

/**
 * Anlas 잔액 스냅샷 로그.
 * 사용량 = 기간 내 연속 스냅샷 간 "감소분"의 합 (충전/구매로 늘어난 구간은 무시).
 * 여러 계정의 잔액이 한 로그에 섞이므로, 계정이 바뀐 첫 행은 settings에 경계로 남겨
 * 계정 간 잔액 차이를 사용량으로 세지 않는다 (하루 상한이 잘못 걸리지 않게).
 *
 * 기간 직전 스냅샷(기준점)은 기간 시작 직전 BASELINE_GRACE_MS 안에 찍힌 것만 쓴다.
 * 그보다 오래된 기준점과의 차이는 앱이 꺼져 있던 동안(웹·다른 기기) 쓴 양일 수 있어
 * 언제 썼는지 알 수 없으므로 오늘 사용량에 넣지 않는다. 대신 그날 처음 받은 잔액은
 * 직전과 같아도 기록해 오늘의 기준점으로 삼는다 (가드는 판정 전에 잔액을 먼저 기록한다).
 */

const ACCOUNT_KEY = 'anlas_log_account'
const BREAKS_KEY = 'anlas_log_breaks'
const MAX_BREAKS = 500
/** 자정 직전에 시작해 자정 뒤에 끝난 생성까지는 이어서 센다 */
const BASELINE_GRACE_MS = 5 * 60 * 1000

/** accountId를 모르면(구 호출) 경계 없이 기록한다 */
export function logBalance(balance: number, accountId?: string): void {
  const db = getDb()
  const switched = accountId !== undefined && getSetting(ACCOUNT_KEY) !== accountId
  if (switched) setSetting(ACCOUNT_KEY, accountId)
  const now = new Date()
  const last = db
    .prepare('SELECT balance, created_at AS createdAt FROM anlas_log ORDER BY id DESC LIMIT 1')
    .get() as { balance: number; createdAt: string } | undefined
  // 변화 없으면 기록 생략 — 단 오늘 첫 스냅샷은 오늘의 기준점이라 남긴다
  if (last?.balance === balance && last.createdAt >= utcIso(startOfDay(now))) return
  // created_at도 JS 시계로 넣어 기간 경계(utcIso) 비교와 같은 시계를 쓴다
  const { lastInsertRowid } = db
    .prepare('INSERT INTO anlas_log (balance, created_at) VALUES (?, ?)')
    .run(balance, utcIso(now))
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

function usageSince(since: Date): number {
  const sinceIso = utcIso(since)
  const graceIso = utcIso(new Date(since.getTime() - BASELINE_GRACE_MS))
  const rows = getDb()
    .prepare(
      // 기간 직전 마지막 스냅샷 1개를 포함해야 기간 경계의 감소분을 놓치지 않는다.
      // 다만 유예 시간보다 오래된 기준점은 빼서 앱 밖에서 쓴 양을 기간에 넣지 않는다
      `SELECT id, balance FROM anlas_log
       WHERE created_at >= ?
          OR id = (SELECT MAX(id) FROM anlas_log WHERE created_at < ? AND created_at >= ?)
       ORDER BY id`
    )
    .all(sinceIso, sinceIso, graceIso) as { id: number; balance: number }[]
  return anlasUsageFromSnapshots(rows, accountBreaks())
}

function utcIso(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function anlasUsage(): { today: number; week: number } {
  const now = new Date()
  return {
    today: usageSince(startOfDay(now)),
    week: usageSince(new Date(now.getTime() - 7 * 24 * 3600 * 1000))
  }
}

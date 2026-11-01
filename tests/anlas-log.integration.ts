import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import { migrations } from '../src/main/db/migrations'
import { anlasUsage, logBalance, usageSince } from '../src/main/nai/anlas-log'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'en' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const V21 = 21

function migrate(db: Database.Database, upTo: number): void {
  for (let version = 0; version < upTo; version++)
    db.transaction(() => {
      migrations[version](db)
      db.pragma(`user_version = ${version + 1}`)
    })()
}

function insert(
  db: Database.Database,
  balance: number,
  accountId: string | null,
  createdAt: string
): void {
  db.prepare('INSERT INTO anlas_log (balance, account_id, created_at) VALUES (?, ?, ?)').run(
    balance,
    accountId,
    createdAt
  )
}

describe('migration v21: anlas_log.account_id', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nais3-anlas-'))
    environment.directory = root
  })
  afterEach(() => {
    closeDb()
    rmSync(root, { recursive: true, force: true })
  })

  it('is the latest migration', () => {
    expect(migrations.length).toBe(V21)
  })

  it('upgrades an existing v20 database, keeping old rows as unattributed', () => {
    const old = new Database(join(root, 'nais3.db'))
    migrate(old, V21 - 1)
    expect(old.pragma('user_version', { simple: true })).toBe(20)
    old.exec(`
      INSERT INTO anlas_log (id, balance, created_at) VALUES (1, 5000, '2026-01-01 00:00:00');
      INSERT INTO anlas_log (id, balance, created_at) VALUES (2, 1000, '2026-01-01 00:01:00');
    `)
    old.close()

    const initialized = initDb()
    expect(initialized.version).toBe(V21)
    const db = getDb()
    expect(db.pragma('user_version', { simple: true })).toBe(V21)
    expect(
      db.prepare('SELECT id, balance, account_id, created_at FROM anlas_log ORDER BY id').all()
    ).toEqual([
      { id: 1, balance: 5000, account_id: null, created_at: '2026-01-01 00:00:00' },
      { id: 2, balance: 1000, account_id: null, created_at: '2026-01-01 00:01:00' }
    ])
    const indexes = db.prepare("PRAGMA index_list('anlas_log')").all() as { name: string }[]
    expect(indexes.map((index) => index.name)).toContain('idx_anlas_log_account_created')

    // 새 행은 계정 id와 함께 기록되고, 레거시 5000→1000은 사용량으로 치지 않는다
    logBalance(900, 'acc-a')
    expect(db.prepare('SELECT account_id FROM anlas_log WHERE id = 3').get()).toEqual({
      account_id: 'acc-a'
    })
    expect(usageSince('2000-01-01 00:00:00').total).toBe(0)
  })
})

describe('usageSince', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, migrations.length)
  })
  afterEach(() => db.close())

  it('counts switching between accounts with different balances as 0 spent', () => {
    insert(db, 5000, 'a', '2026-03-01 10:00:00')
    insert(db, 1000, 'b', '2026-03-01 10:01:00') // 수동 전환
    insert(db, 5000, 'a', '2026-03-01 10:02:00') // 되돌아옴
    insert(db, 1000, 'b', '2026-03-01 10:03:00') // 자동 전환
    expect(usageSince('2026-03-01 00:00:00', db)).toEqual({ total: 0, byAccount: { a: 0, b: 0 } })
  })

  it('sums real drops within one account, even when other accounts are interleaved', () => {
    insert(db, 5000, 'a', '2026-03-01 10:00:00')
    insert(db, 4980, 'a', '2026-03-01 10:01:00') // -20
    insert(db, 1000, 'b', '2026-03-01 10:02:00')
    insert(db, 990, 'b', '2026-03-01 10:03:00') // -10
    insert(db, 4960, 'a', '2026-03-01 10:04:00') // -20 (a의 직전 4980 기준)
    insert(db, 6000, 'a', '2026-03-01 10:05:00') // 충전 — 무시
    insert(db, 5995, 'a', '2026-03-01 10:06:00') // -5
    expect(usageSince('2026-03-01 00:00:00', db)).toEqual({
      total: 55,
      byAccount: { a: 45, b: 10 }
    })
  })

  it("includes each account's last snapshot before the window as the baseline", () => {
    insert(db, 5000, 'a', '2026-03-01 09:00:00')
    insert(db, 1000, 'b', '2026-03-01 09:30:00')
    insert(db, 4990, 'a', '2026-03-01 10:00:00') // -10, 경계 넘어
    insert(db, 950, 'b', '2026-03-01 10:30:00') // -50, 경계 넘어
    expect(usageSince('2026-03-01 09:45:00', db)).toEqual({
      total: 60,
      byAccount: { a: 10, b: 50 }
    })
  })

  it('ignores legacy rows without an account id entirely', () => {
    insert(db, 5000, null, '2026-03-01 10:00:00')
    insert(db, 4900, null, '2026-03-01 10:01:00') // 레거시끼리의 감소 — 계정 전환일 수 있어 제외
    insert(db, 1000, null, '2026-03-01 10:02:00')
    insert(db, 800, 'a', '2026-03-01 10:03:00') // 레거시 → 계정 행: 기준 없음
    insert(db, 790, 'a', '2026-03-01 10:04:00') // -10
    expect(usageSince('2026-03-01 00:00:00', db)).toEqual({ total: 10, byAccount: { a: 10 } })
  })

  it('logBalance skips unchanged balances per account, not across accounts', () => {
    logBalance(5000, 'a', db)
    logBalance(1000, 'b', db)
    logBalance(5000, 'a', db) // a의 직전 값과 같음 → 생략
    logBalance(1000, 'b', db) // b의 직전 값과 같음 → 생략
    logBalance(4990, 'a', db)
    expect(db.prepare('SELECT balance, account_id FROM anlas_log ORDER BY id').all()).toEqual([
      { balance: 5000, account_id: 'a' },
      { balance: 1000, account_id: 'b' },
      { balance: 4990, account_id: 'a' }
    ])
  })

  it("counts the first generation on a rotated account from the router's pre-generation balance", () => {
    logBalance(5000, 'a', db)
    logBalance(1000, 'b', db) // 자동 전환: 라우터가 조회한 생성 전 잔액
    logBalance(995, 'b', db) // 생성 후 잔액
    expect(usageSince('2000-01-01 00:00:00', db)).toEqual({
      total: 5,
      byAccount: { a: 0, b: 5 }
    })
  })

  it('anlasUsage reports today/week totals and per-account breakdown', () => {
    const now = new Date(2026, 2, 10, 12, 0, 0) // 로컬 2026-03-10 12:00
    const iso = (date: Date): string => date.toISOString().slice(0, 19).replace('T', ' ')
    const at = (days: number, hours: number): string =>
      iso(new Date(2026, 2, 10 - days, hours, 0, 0))
    insert(db, 5000, 'a', at(3, 9))
    insert(db, 4900, 'a', at(3, 10)) // -100, 이번 주
    insert(db, 1000, 'b', at(0, 9))
    insert(db, 4890, 'a', at(0, 10)) // -10, 오늘
    insert(db, 980, 'b', at(0, 11)) // -20, 오늘
    expect(anlasUsage(now, db)).toEqual({
      today: 30,
      week: 130,
      byAccount: { a: { today: 10, week: 110 }, b: { today: 20, week: 20 } }
    })
  })
})

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import { anlasUsage, logBalance } from '../src/main/nai/anlas-log'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'en-US' },
  BrowserWindow: {},
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

/** 로컬 시각 기준 (하루 경계가 로컬 자정이라) */
function at(day: number, hour: number, minute = 0): void {
  vi.setSystemTime(new Date(2026, 10, day, hour, minute))
}

function rowCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM anlas_log').get() as { n: number }).n
}

describe('Anlas 잔액 로그 사용량', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nais3-anlas-log-'))
    environment.directory = root
    vi.useFakeTimers({ toFake: ['Date'] })
    initDb()
  })
  afterEach(() => {
    closeDb()
    vi.useRealTimers()
    rmSync(root, { recursive: true, force: true })
  })

  it('앱이 꺼져 있던 동안 앱 밖에서 쓴 양은 오늘 사용량에 넣지 않는다', () => {
    at(10, 20)
    logBalance(1000, 'a')
    // 며칠 뒤 앱을 켜니 웹에서 300을 써서 잔액이 줄어 있다
    at(13, 9)
    logBalance(700, 'a')
    expect(anlasUsage().today).toBe(0)
    at(13, 10)
    logBalance(680, 'a')
    expect(anlasUsage().today).toBe(20)
  })

  it('그날 처음 받은 잔액은 같아도 기록해 오늘의 기준점으로 삼는다', () => {
    at(10, 20)
    logBalance(1000, 'a')
    at(11, 9)
    logBalance(1000, 'a')
    expect(rowCount()).toBe(2)
    // 같은 날 같은 잔액은 다시 남기지 않는다
    logBalance(1000, 'a')
    expect(rowCount()).toBe(2)
    at(11, 9, 1)
    logBalance(980, 'a')
    expect(anlasUsage().today).toBe(20)
  })

  it('자정 직전에 받은 기준점은 이어서 센다', () => {
    at(10, 23, 59)
    logBalance(1000, 'a')
    at(11, 0, 1)
    logBalance(980, 'a')
    expect(anlasUsage().today).toBe(20)
  })

  it('다른 계정 미리보기 뒤에 늦게 온 원래 계정 잔액도 실제 사용량을 센다', () => {
    at(11, 9)
    logBalance(1000, 'a')
    // 예약 전 확인이 자동 전환 후보 B의 잔액을 기록
    at(11, 9, 1)
    logBalance(300, 'b')
    // A로 보낸 생성이 끝난 뒤 A 잔액이 늦게 도착
    at(11, 9, 2)
    logBalance(980, 'a')
    expect(anlasUsage().today).toBe(20)
    // 계정 간 잔액 차이(700, 680)는 세지 않는다
    at(11, 9, 3)
    logBalance(290, 'b')
    expect(anlasUsage().today).toBe(30)
  })

  it('계정이 바뀐 행은 잔액이 우연히 같아도 경계로 남긴다', () => {
    at(11, 9)
    logBalance(1000, 'a')
    logBalance(1000, 'b')
    at(11, 9, 1)
    logBalance(990, 'b')
    logBalance(980, 'a')
    expect(anlasUsage().today).toBe(30)
  })

  it('어제 이후 처음 돌아온 계정의 차이는 오늘 사용량에 넣지 않는다', () => {
    at(10, 20)
    logBalance(1000, 'a')
    at(11, 9)
    logBalance(300, 'b')
    logBalance(700, 'a')
    expect(anlasUsage().today).toBe(0)
  })
})

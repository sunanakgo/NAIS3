import { describe, expect, it } from 'vitest'
import {
  anlasGuardSettingEntries,
  anlasUsageFromSnapshots,
  checkAnlasGuard,
  directorCharge,
  formatAnlasGuardBlock,
  generationCharge,
  normalizeDailyAnlasCap,
  readAnlasGuardSettings,
  UPSCALE_CHARGE,
  type AnlasGuardSettings
} from '../src/shared/anlas-guard'
import { translate } from '../src/shared/i18n'

const base = {
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  isOpus: true,
  batchCount: 1
}

const OFF: AnlasGuardSettings = { blockPaid: false, dailyCapEnabled: false, dailyCap: 100 }
const BLOCK_PAID: AnlasGuardSettings = { ...OFF, blockPaid: true }
const CAP_100: AnlasGuardSettings = { ...OFF, dailyCapEnabled: true }

describe('무료 범위 지킴이 설정', () => {
  it('저장값이 없으면 두 보호 모두 꺼져 있고 상한은 기본 100', () => {
    expect(readAnlasGuardSettings(() => null)).toEqual(OFF)
  })

  it("'1'일 때만 켜고 상한은 정수로 읽는다", () => {
    const stored: Record<string, string> = {
      anlas_guard_block_paid: '1',
      anlas_guard_daily_cap_enabled: '1',
      anlas_guard_daily_cap: '250'
    }
    expect(readAnlasGuardSettings((key) => stored[key])).toEqual({
      blockPaid: true,
      dailyCapEnabled: true,
      dailyCap: 250
    })
  })

  it('잘못된 상한은 기본값, 소수는 버림, 0은 그대로', () => {
    expect(normalizeDailyAnlasCap('12.7')).toBe(12)
    expect(normalizeDailyAnlasCap('0')).toBe(0)
    expect(normalizeDailyAnlasCap('-5')).toBe(100)
    expect(normalizeDailyAnlasCap('abc')).toBe(100)
    expect(normalizeDailyAnlasCap('')).toBe(100)
    expect(normalizeDailyAnlasCap(5_000_000)).toBe(1_000_000)
  })

  it('저장한 값을 다시 읽으면 같은 설정이 나온다', () => {
    const settings = { blockPaid: true, dailyCapEnabled: false, dailyCap: 40 }
    const stored = Object.fromEntries(anlasGuardSettingEntries(settings))
    expect(readAnlasGuardSettings((key) => stored[key])).toEqual(settings)
  })
})

describe('요청 비용과 무료가 아닌 이유', () => {
  it('Opus·1024² 이하·28스텝 이하는 무료', () => {
    expect(generationCharge(base)).toEqual({ cost: 0, reasons: [] })
  })

  it('해상도·스텝을 넘으면 Opus도 유료이고 넘은 조건을 모두 알린다', () => {
    expect(generationCharge({ ...base, width: 1536, height: 1536 }).reasons).toEqual(['resolution'])
    expect(generationCharge({ ...base, steps: 29 }).reasons).toEqual(['steps'])
    expect(generationCharge({ ...base, width: 1536, height: 1536, steps: 40 }).reasons).toEqual([
      'resolution',
      'steps'
    ])
  })

  it('Opus가 아니면 해상도와 무관하게 구독 사유만 남긴다', () => {
    expect(generationCharge({ ...base, isOpus: false })).toEqual({
      cost: 20,
      reasons: ['notOpus']
    })
    expect(generationCharge({ ...base, isOpus: false, width: 1536, height: 1536 }).reasons).toEqual(
      ['notOpus']
    )
    // 구독 조회 실패는 따로 알린다
    expect(generationCharge({ ...base, isOpus: false }, false).reasons).toEqual([
      'subscriptionUnknown'
    ])
  })

  it('V5는 게이지가 남았다고 확인된 경우만 무료', () => {
    const v5 = { ...base, model: 'nai-diffusion-5-curated' }
    expect(generationCharge(v5).reasons).toEqual(['opusUsage'])
    expect(generationCharge({ ...v5, opusUsageExhausted: true }).reasons).toEqual(['opusUsage'])
    expect(generationCharge({ ...v5, opusUsageExhausted: false })).toEqual({ cost: 0, reasons: [] })
  })

  it('캐릭터 레퍼런스·바이브 인코딩·바이브 5개 이상은 무료 생성에도 따로 붙는다', () => {
    expect(generationCharge({ ...base, charRefCount: 1 })).toEqual({
      cost: 5,
      reasons: ['characterReference']
    })
    expect(generationCharge({ ...base, unencodedVibes: 1 })).toEqual({
      cost: 2,
      reasons: ['vibeEncoding']
    })
    expect(generationCharge({ ...base, vibeCount: 5 })).toEqual({
      cost: 2,
      reasons: ['multiVibe']
    })
  })

  it('디렉터 툴은 Opus 정상 크기면 무료, 배경 제거는 항상 유료', () => {
    expect(directorCharge('lineart', 832, 1216, true)).toEqual({ cost: 0, reasons: [] })
    expect(directorCharge('bg-removal', 832, 1216, true)).toEqual({
      cost: 65,
      reasons: ['backgroundRemoval']
    })
    expect(directorCharge('lineart', 832, 1216, false).reasons).toEqual(['notOpus'])
    // 큰 입력은 3MP까지 줄여도 1024²를 넘어 유료
    expect(directorCharge('lineart', 2048, 2048, true).reasons).toEqual(['resolution'])
  })

  it('업스케일은 항상 1 Anlas', () => {
    expect(UPSCALE_CHARGE).toEqual({ cost: 1, reasons: ['upscale'] })
  })
})

describe('지킴이 판정', () => {
  const paid = generationCharge({ ...base, width: 1536, height: 1536 })
  const cref = generationCharge({ ...base, charRefCount: 1 })
  const free = generationCharge(base)

  it('둘 다 꺼져 있으면 막지 않는다', () => {
    expect(checkAnlasGuard(OFF, [paid], 10_000)).toBeNull()
  })

  it('무료 요청은 상한을 이미 넘었어도 보낸다', () => {
    expect(checkAnlasGuard({ ...CAP_100, dailyCap: 0 }, [free, free], 500)).toBeNull()
    expect(checkAnlasGuard(BLOCK_PAID, [free], 0)).toBeNull()
  })

  it('무료가 아니면 묶음 전체를 막고 유료 건수와 이유를 모은다', () => {
    expect(checkAnlasGuard(BLOCK_PAID, [free, paid, cref], 0)).toEqual({
      kind: 'paid',
      cost: paid.cost + cref.cost,
      reasons: ['resolution', 'characterReference'],
      paidCount: 2,
      total: 3
    })
  })

  it('오늘 사용량 + 이번 비용이 상한을 넘을 때만 막는다 (같으면 통과)', () => {
    const charge = { cost: 20, reasons: ['notOpus' as const] }
    expect(checkAnlasGuard(CAP_100, [charge], 80)).toBeNull()
    expect(checkAnlasGuard(CAP_100, [charge], 81)).toEqual({
      kind: 'dailyCap',
      cost: 20,
      spentToday: 81,
      cap: 100
    })
  })

  it('두 보호가 다 켜져 있으면 무료 아님 사유를 먼저 알린다', () => {
    const both = { ...CAP_100, blockPaid: true }
    expect(checkAnlasGuard(both, [paid], 1000)?.kind).toBe('paid')
  })

  it('이유와 설정 위치를 담은 문구를 만든다', () => {
    const single = formatAnlasGuardBlock(checkAnlasGuard(BLOCK_PAID, [cref], 0)!)
    expect(single).toContain('캐릭터 레퍼런스')
    expect(single).toContain('5 Anlas')
    expect(single).toContain('무료가 아니면 생성하지 않기')

    const en = (id: Parameters<typeof translate>[1], ...args: (string | number)[]): string =>
      translate('en', id, args)
    const batch = formatAnlasGuardBlock(checkAnlasGuard(BLOCK_PAID, [free, free, cref], 0)!, en)
    expect(batch).toContain('1 of 3 images is outside the free range: character reference')

    const cap = formatAnlasGuardBlock({ kind: 'dailyCap', cost: 20, spentToday: 81, cap: 100 })
    expect(cap).toContain('오늘 81 + 이번 20 > 상한 100')
  })
})

describe('하루 사용량 (잔액 스냅샷)', () => {
  it('감소분만 더하고 충전·구매로 늘어난 구간은 무시한다', () => {
    const rows = [
      { id: 1, balance: 1000 },
      { id: 2, balance: 980 },
      { id: 3, balance: 990 },
      { id: 4, balance: 950 }
    ]
    expect(anlasUsageFromSnapshots(rows)).toBe(60)
  })

  it('계정이 바뀐 첫 스냅샷과의 차이는 사용량으로 세지 않는다', () => {
    const rows = [
      { id: 1, balance: 1000 },
      { id: 2, balance: 980 },
      { id: 3, balance: 300 }, // 잔액이 적은 다른 계정으로 전환
      { id: 4, balance: 290 }
    ]
    expect(anlasUsageFromSnapshots(rows)).toBe(710)
    expect(anlasUsageFromSnapshots(rows, new Map([[3, 0]]))).toBe(30)
  })

  it('다른 계정을 거쳐 돌아온 계정은 그 계정 직전 잔액 대비 감소분을 센다', () => {
    const rows = [
      { id: 1, balance: 1000 }, // A
      { id: 2, balance: 300 }, // B 미리보기
      { id: 3, balance: 980 } // A로 돌아옴 — A의 직전 1000 대비 20
    ]
    expect(
      anlasUsageFromSnapshots(
        rows,
        new Map([
          [2, 0],
          [3, 20]
        ])
      )
    ).toBe(20)
  })
})

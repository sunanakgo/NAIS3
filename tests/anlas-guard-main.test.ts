import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaiAccountBalance } from '../src/main/nai/account-router'
import { translate } from '../src/shared/i18n'
import type { GenerationRequest } from '../src/shared/types'

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  vibes: [] as {
    id: number
    filePath: string
    strength: number
    infoExtracted: number
    encoded: string | null
    encodedIe: number | null
  }[],
  spentToday: 0,
  logged: [] as [number, string | undefined][],
  setActive: vi.fn(),
  fetchBalance: vi.fn()
}))
const accounts = [
  { id: 'a', label: 'A', token: 'token-a' },
  { id: 'b', label: 'B', token: 'token-b' }
]
vi.mock('../src/main/db/settings', () => ({
  getSetting: (key: string) => state.settings.get(key) ?? null,
  getNaiAccounts: () => accounts,
  getActiveNaiAccount: () => accounts[0],
  setActiveNaiAccount: state.setActive
}))
vi.mock('../src/main/i18n', () => ({
  t: (id: Parameters<typeof translate>[1], ...args: (string | number)[]) =>
    translate('ko', id, args)
}))
vi.mock('../src/main/refs/repo', () => ({
  enabledVibeRows: () => state.vibes,
  vibeRowsByIds: (ids: number[]) => state.vibes.filter((row) => ids.includes(row.id)),
  enabledCharRefRows: () => [],
  charRefRowsByIds: () => []
}))
vi.mock('../src/main/nai/anlas-log', () => ({
  anlasUsage: () => ({ today: state.spentToday, week: state.spentToday }),
  logBalance: (balance: number, accountId?: string) => state.logged.push([balance, accountId])
}))
vi.mock('../src/main/nai/client', () => ({
  fetchAnlasBalance: state.fetchBalance
}))

const { AnlasGuardError, anlasGuardBlockForQueue, enforceGenerationGuard } =
  await import('../src/main/nai/anlas-guard')

const OPUS: NaiAccountBalance = { anlas: 1000, tier: 'opus' }
const balances: Record<string, NaiAccountBalance> = {
  // 게이지를 다 쓴 활성 계정
  'token-a': {
    ...OPUS,
    usage: { percent: 0, isNegative: true, timeUntilNextPercent: 100 }
  },
  'token-b': {
    ...OPUS,
    anlas: 500,
    usage: { percent: 80, isNegative: false, timeUntilNextPercent: 100 }
  }
}

const FREE = {
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  seed: 1
} as GenerationRequest
const V5 = { ...FREE, model: 'nai-diffusion-5-curated' } as GenerationRequest

describe('보내기 직전 Anlas 가드 (메인 프로세스)', () => {
  beforeEach(() => {
    state.settings.clear()
    state.vibes = []
    state.spentToday = 0
    state.logged = []
    state.setActive.mockClear()
    state.fetchBalance.mockReset()
    state.fetchBalance.mockImplementation(async (token: string) => balances[token] ?? OPUS)
  })

  it('두 보호가 꺼져 있으면 잔액도 조회하지 않는다', async () => {
    await expect(enforceGenerationGuard({ ...FREE, steps: 40 }, accounts[0])).resolves.toBe(
      undefined
    )
    expect(await anlasGuardBlockForQueue([{ ...FREE, steps: 40 }])).toBeNull()
    expect(state.fetchBalance).not.toHaveBeenCalled()
  })

  it('무료 요청은 사용량 기록 없이 그대로 보낸다', async () => {
    state.settings.set('anlas_guard_block_paid', '1')
    await expect(enforceGenerationGuard(FREE, accounts[0], OPUS)).resolves.toBe(undefined)
    expect(state.fetchBalance).not.toHaveBeenCalled()
    expect(state.logged).toEqual([])
  })

  it('유료 요청은 큐를 멈추는 AnlasGuardError로 막는다', async () => {
    state.settings.set('anlas_guard_block_paid', '1')
    const error = await enforceGenerationGuard({ ...FREE, steps: 40 }, accounts[0], OPUS).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(AnlasGuardError)
    expect((error as InstanceType<typeof AnlasGuardError>).haltQueue).toBe(true)
    expect((error as Error).message).toContain('스텝 28 초과')
    // 큐는 메시지에 abort가 들어 있으면 사용자 취소로 본다
    expect((error as Error).message).not.toMatch(/abort/i)
  })

  it('V5 인페인트는 실제로 보내는 4.5 인페인트 모델 기준이라 게이지 없이도 무료', async () => {
    state.settings.set('anlas_guard_block_paid', '1')
    const inpaint = {
      ...V5,
      source: { imageBase64: 'x', maskBase64: 'm', strength: 1, noise: 0 }
    }
    await expect(enforceGenerationGuard(inpaint, accounts[0], OPUS)).resolves.toBe(undefined)
    await expect(enforceGenerationGuard(V5, accounts[0], OPUS)).rejects.toThrow(
      'V5 게이지 소진 또는 확인 실패'
    )
  })

  it('예약 전 확인은 한 묶음에서 같은 바이브 인코딩을 한 번만 센다', async () => {
    state.settings.set('anlas_guard_daily_cap_enabled', '1')
    state.settings.set('anlas_guard_daily_cap', '1')
    state.vibes = [
      { id: 7, filePath: '/v.png', strength: 0.6, infoExtracted: 1, encoded: null, encodedIe: null }
    ]
    const message = await anlasGuardBlockForQueue([FREE, FREE, FREE])
    expect(message).toContain('오늘 0 + 이번 2 > 상한 1')
    // 판정 직전에 받은 잔액을 그 계정 것으로 기록한다
    expect(state.logged).toEqual([[1000, 'a']])
  })

  it('자동 전환이 고를 계정의 잔액으로 판정하고 활성 계정은 바꾸지 않는다', async () => {
    state.settings.set('anlas_guard_block_paid', '1')
    expect(await anlasGuardBlockForQueue([V5])).toBeNull()
    expect(state.fetchBalance).toHaveBeenCalledWith('token-b')
    expect(state.setActive).not.toHaveBeenCalled()

    // 자동 전환을 끄면 게이지가 바닥난 지금 계정으로 보내므로 막는다
    state.settings.set('nai_auto_switch', '0')
    expect(await anlasGuardBlockForQueue([V5])).toContain('V5 게이지 소진 또는 확인 실패')
  })
})

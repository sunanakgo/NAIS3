import {
  directorAugmentCost,
  directorAugmentEstimateInput,
  estimateAnlas,
  opusFreeMisses,
  UPSCALE_ANLAS_COST,
  type AnlasEstimateInput,
  type OpusFreeMiss
} from './anlas'
import { translate, type MessageId } from './i18n'
import type { DirectorMethod } from './types'

/**
 * 무료 범위 지킴이 — "무료가 아니면 생성하지 않기"와 "하루 Anlas 상한".
 * 실제 차단은 메인 프로세스가 요청을 보내기 직전에 하고, 렌더러는 같은 판정으로 미리 안내만 한다.
 */

export const ANLAS_GUARD_KEYS = {
  blockPaid: 'anlas_guard_block_paid',
  dailyCapEnabled: 'anlas_guard_daily_cap_enabled',
  dailyCap: 'anlas_guard_daily_cap'
} as const

export const DEFAULT_DAILY_ANLAS_CAP = 100
const MAX_DAILY_ANLAS_CAP = 1_000_000

export interface AnlasGuardSettings {
  blockPaid: boolean
  dailyCapEnabled: boolean
  /** 로컬 자정부터 쓸 수 있는 Anlas (0 = 유료 요청 전부 차단) */
  dailyCap: number
}

/** 빈 값·잘못된 값은 기본 상한, 소수는 버림 */
export function normalizeDailyAnlasCap(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return DEFAULT_DAILY_ANLAS_CAP
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_ANLAS_CAP
  return Math.min(Math.floor(n), MAX_DAILY_ANLAS_CAP)
}

/** 두 보호 모두 기본 꺼짐 — '1'일 때만 켠다 */
export function readAnlasGuardSettings(
  get: (key: string) => string | null | undefined
): AnlasGuardSettings {
  return {
    blockPaid: get(ANLAS_GUARD_KEYS.blockPaid) === '1',
    dailyCapEnabled: get(ANLAS_GUARD_KEYS.dailyCapEnabled) === '1',
    dailyCap: normalizeDailyAnlasCap(get(ANLAS_GUARD_KEYS.dailyCap))
  }
}

export function anlasGuardSettingEntries(settings: AnlasGuardSettings): [string, string][] {
  return [
    [ANLAS_GUARD_KEYS.blockPaid, settings.blockPaid ? '1' : '0'],
    [ANLAS_GUARD_KEYS.dailyCapEnabled, settings.dailyCapEnabled ? '1' : '0'],
    [ANLAS_GUARD_KEYS.dailyCap, String(normalizeDailyAnlasCap(settings.dailyCap))]
  ]
}

export function anlasGuardEnabled(settings: AnlasGuardSettings): boolean {
  return settings.blockPaid || settings.dailyCapEnabled
}

/** 무료가 아닌 이유 — 사용자에게 무엇을 바꾸면 되는지 알려 주는 단위 */
export type AnlasPaidReason =
  | OpusFreeMiss
  | 'subscriptionUnknown'
  | 'characterReference'
  | 'vibeEncoding'
  | 'multiVibe'
  | 'backgroundRemoval'
  | 'upscale'

/** 요청 1건이 쓸 것으로 추정한 Anlas와 그 이유 */
export interface AnlasCharge {
  cost: number
  reasons: AnlasPaidReason[]
}

const FREE_CHARGE: AnlasCharge = { cost: 0, reasons: [] }

export const UPSCALE_CHARGE: AnlasCharge = { cost: UPSCALE_ANLAS_COST, reasons: ['upscale'] }

/** Opus가 아니면 해상도·스텝을 줄여도 무료가 되지 않으니 구독 사유만 남긴다 */
function freeMissReasons(input: AnlasEstimateInput, tierKnown: boolean): AnlasPaidReason[] {
  const misses = opusFreeMisses(input)
  if (misses.includes('notOpus')) return [tierKnown ? 'notOpus' : 'subscriptionUnknown']
  return misses
}

/** 생성 요청 1건(1장)의 비용과 사유. tierKnown=false면 구독 조회 실패로 Opus가 아니라고 본 것 */
export function generationCharge(input: AnlasEstimateInput, tierKnown = true): AnlasCharge {
  const estimate = estimateAnlas(input)
  if (estimate.free) return FREE_CHARGE
  const reasons: AnlasPaidReason[] = []
  if (estimate.generation > 0) reasons.push(...freeMissReasons(input, tierKnown))
  if (estimate.charRef > 0) reasons.push('characterReference')
  if (estimate.vibeEncoding > 0) reasons.push('vibeEncoding')
  if (estimate.vibeGeneration > 0) reasons.push('multiVibe')
  return { cost: estimate.total, reasons }
}

export function directorCharge(
  method: DirectorMethod,
  width: number,
  height: number,
  isOpus: boolean,
  tierKnown = true
): AnlasCharge {
  const cost = directorAugmentCost(method, width, height, isOpus)
  if (cost === 0) return FREE_CHARGE
  if (method === 'bg-removal') return { cost, reasons: ['backgroundRemoval'] }
  return {
    cost,
    reasons: freeMissReasons(directorAugmentEstimateInput(method, width, height, isOpus), tierKnown)
  }
}

export type AnlasGuardBlock =
  | {
      kind: 'paid'
      cost: number
      reasons: AnlasPaidReason[]
      /** 막은 묶음 중 유료 요청 수 / 전체 요청 수 */
      paidCount: number
      total: number
    }
  | { kind: 'dailyCap'; cost: number; spentToday: number; cap: number }

/**
 * 요청 묶음(1건 이상)을 보내도 되는지. 막아야 하면 이유를, 보내도 되면 null.
 * 무료 묶음은 상한과 무관하게 통과한다.
 */
export function checkAnlasGuard(
  settings: AnlasGuardSettings,
  charges: readonly AnlasCharge[],
  spentToday: number
): AnlasGuardBlock | null {
  const cost = charges.reduce((sum, charge) => sum + charge.cost, 0)
  if (cost <= 0) return null
  if (settings.blockPaid) {
    const paid = charges.filter((charge) => charge.cost > 0)
    return {
      kind: 'paid',
      cost,
      reasons: [...new Set(paid.flatMap((charge) => charge.reasons))],
      paidCount: paid.length,
      total: charges.length
    }
  }
  if (settings.dailyCapEnabled && spentToday + cost > settings.dailyCap) {
    return { kind: 'dailyCap', cost, spentToday, cap: settings.dailyCap }
  }
  return null
}

type Translate = (id: MessageId, ...args: (string | number)[]) => string

const koTranslate: Translate = (id, ...args) => translate('ko', id, args)

const PAID_REASON_MESSAGES: Record<AnlasPaidReason, MessageId> = {
  notOpus: 'ui.anlasPaidReasonNotOpus',
  subscriptionUnknown: 'ui.anlasPaidReasonSubscriptionUnknown',
  opusUsage: 'ui.anlasPaidReasonOpusUsage',
  resolution: 'ui.anlasPaidReasonResolution',
  steps: 'ui.anlasPaidReasonSteps',
  characterReference: 'ui.anlasPaidReasonCharacterReference',
  vibeEncoding: 'ui.anlasPaidReasonVibeEncoding',
  multiVibe: 'ui.anlasPaidReasonMultiVibe',
  backgroundRemoval: 'ui.anlasPaidReasonBackgroundRemoval',
  upscale: 'ui.anlasPaidReasonUpscale'
}

export function formatAnlasPaidReasons(
  reasons: readonly AnlasPaidReason[],
  tr: Translate = koTranslate
): string {
  return reasons.map((reason) => tr(PAID_REASON_MESSAGES[reason])).join(', ')
}

export function formatAnlasGuardBlock(block: AnlasGuardBlock, tr: Translate = koTranslate): string {
  if (block.kind === 'dailyCap') {
    return tr('ui.anlasGuardBlockedDailyCap', block.spentToday, block.cost, block.cap)
  }
  const reasons = formatAnlasPaidReasons(block.reasons, tr)
  return block.total > 1
    ? tr('ui.anlasGuardBlockedPaidBatch', block.total, block.paidCount, reasons, block.cost)
    : tr('ui.anlasGuardBlockedPaid', reasons, block.cost)
}

/**
 * 잔액 스냅샷으로 쓴 Anlas를 센다 — 연속 스냅샷 사이 감소분의 합 (충전·구매로 늘어난 구간은 무시).
 * breaks에 든 행은 다른 계정으로 바뀐 첫 스냅샷이라, 그 직전과의 차이는 사용량이 아니다.
 */
export function anlasUsageFromSnapshots(
  rows: readonly { id: number; balance: number }[],
  breaks: ReadonlySet<number> = new Set()
): number {
  let used = 0
  for (let i = 1; i < rows.length; i++) {
    if (breaks.has(rows[i].id)) continue
    const drop = rows[i - 1].balance - rows[i].balance
    if (drop > 0) used += drop
  }
  return used
}

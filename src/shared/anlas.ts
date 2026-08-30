import type { DirectorMethod, OpusUsageStatus } from './types'
import { format } from './i18n'

export function displayOpusUsagePercent(usage: OpusUsageStatus): number {
  return usage.isNegative ? 0 : Math.max(0, usage.percent)
}

export function opusUsagePercentSegments(usage: OpusUsageStatus): number[] {
  const percent = displayOpusUsagePercent(usage)
  const fullSegments = Math.floor(percent / 100)
  const remainder = percent % 100

  if (fullSegments === 0) return [remainder]
  return [...Array.from({ length: fullSegments }, () => 100), ...(remainder > 0 ? [remainder] : [])]
}

/**
 * Anlas 비용 추정 — NAI 웹 번들의 실제 비용 함수를 이식 (2026-07-05 _app 번들에서 추출).
 *
 * 확인된 사실:
 * - V4/4.5 계열 비용: ceil(2.951823174884865e-6·px + 5.753298233447344e-7·px·steps)
 *   (SMEA 미사용 기준 — V4.5는 SMEA 없음)
 * - i2i/인페인트: ceil(비용 × strength), 최소 2
 * - 무료 조건(eX): "캐릭터 레퍼런스 없음" && px ≤ 1024² && steps ≤ 28, Opus 구독 시
 *   요청당 1장 차감 — NAIS3는 배치를 요청 N개(각 1장)로 쪼개므로 조건 충족 시 배치 전체 무료
 * - 프롬프트 길이는 비용에 영향 없음 (번들 전수 확인 — 관련 항 자체가 없다)
 * - 바이브 인코딩: encode-vibe 1회당 2 Anlas, 인코딩 캐시 재사용 시 0 (NAIS2에서 검증)
 * - 참고: 구형 업스케일러는 해상도별 0~7 Anlas였지만 V5 Curated 업스케일러는 고정 1 Anlas
 */

export interface AnlasEstimateInput {
  /** Generation model. V5 paid generations cost 1.5× V4.5. */
  model?: string
  width: number
  height: number
  steps: number
  /** i2i/인페인트 강도 (t2i는 1) */
  strength?: number
  /** 활성 캐릭터 레퍼런스 수 — 장당 CHARREF_COST씩 별도 부과 */
  charRefCount?: number
  isOpus: boolean
  /** NAIS3 배치 = 요청 N개 × 1장 */
  batchCount: number
  /** 이번 생성에서 새로 인코딩해야 하는 바이브 수 (캐시된 것 제외) */
  unencodedVibes?: number
  /** 활성 바이브 수 — V4 이상은 4개 초과분마다 장당 2 Anlas */
  vibeCount?: number
  /** V5 Opus rechargeable allowance is empty (`subscription.usage.isNegative`). */
  opusUsageExhausted?: boolean
}

export interface AnlasEstimate {
  /** 장당 생성 비용 (무료 적용 전) */
  perImage: number
  /** 생성 비용 합계 (무료 적용 후) */
  generation: number
  /** 캐릭터 레퍼런스 사용료 (장당·레퍼당) */
  charRef: number
  /** 바이브 인코딩 비용 (1회성, 캐시되면 이후 0) */
  vibeEncoding: number
  /** V4 이상에서 바이브 4개 초과분의 장당 추가 비용 */
  vibeGeneration: number
  total: number
  free: boolean
  /** V5 generation consumes the rechargeable allowance instead of Anlas. */
  usesOpusUsage: boolean
}

/** 생성 요청과 비용 배지가 동일한 source strength 기본값을 쓰게 한다. */
export function effectiveGenerationStrength(
  hasSource: boolean,
  hasMask: boolean,
  configured?: number
): number {
  return hasSource ? (configured ?? (hasMask ? 1 : 0.7)) : 1
}

export function formatAnlasEstimate(
  estimate: AnlasEstimate,
  batchCount = 1,
  // 공유 모듈은 i18n 런타임을 못 가져오므로 호출자가 t를 주입한다 (기본값 = 한국어 원문)
  tr: (key: string, ...args: (string | number)[]) => string = (key, ...args) => format(key, args)
): string {
  if (estimate.usesOpusUsage) {
    return batchCount > 1
      ? tr('Opus V5 충전 게이지에서 차감 — 중간에 고갈되면 후속 이미지는 Anlas 사용')
      : tr('Opus V5 충전 게이지에서 차감')
  }
  if (estimate.free) return tr('무료 생성 (Opus · 1024² 이하 · 28스텝 이하)')

  const parts = [
    estimate.generation > 0 ? tr('생성 {0}', estimate.generation) : '',
    estimate.charRef > 0 ? tr('레퍼런스 {0}', estimate.charRef) : '',
    estimate.vibeEncoding > 0 ? tr('바이브 인코딩 {0}', estimate.vibeEncoding) : '',
    estimate.vibeGeneration > 0 ? tr('다중 바이브 {0}', estimate.vibeGeneration) : ''
  ].filter(Boolean)
  return `${tr('예상 {0} Anlas', estimate.total)}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

const VIBE_ENCODE_COST = 2
/**
 * 캐릭터 레퍼런스 사용료 (장당·레퍼당) — 실측 기반 추정.
 * 검증 사례: Opus·1024²·28스텝·캐릭레퍼 1 → 장당 5 차감 (생성 자체는 무료 유지).
 * 과거 번들 분석의 "캐릭레퍼 = 무료 조건 파기"는 실측과 불일치해 폐기.
 * 레퍼 수·해상도에 따른 변동 여부는 미확정 — 추가 실측 시 갱신.
 */
const CHARREF_COST = 5

/** V5 Curated 전용 업스케일러는 입력 크기·구독 등급과 무관하게 고정 1 Anlas. */
export const UPSCALE_ANLAS_COST = 1

/**
 * augment-image 디렉터 툴 비용.
 *
 * NAI 웹은 입력을 1MP 이상(최대 3MP)으로 정규화한 뒤 28-step 이미지 비용을 계산한다.
 * 일반 툴은 Opus 무료 조건이 적용되지만 배경 제거는 예외이며 `기본 비용 × 3 + 5`다.
 * 832×1216 실측: 일반 툴 0, 배경 제거 65 Anlas.
 */
export function directorAugmentCost(
  method: DirectorMethod,
  width: number,
  height: number,
  isOpus: boolean
): number {
  const normalized = normalizeDirectorDimensions(width, height)
  const estimate = estimateAnlas({
    width: normalized.width,
    height: normalized.height,
    steps: 28,
    isOpus: method === 'bg-removal' ? false : isOpus,
    batchCount: 1
  })
  return method === 'bg-removal' ? estimate.perImage * 3 + 5 : estimate.generation
}

function normalizeDirectorDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }

  let w = width
  let h = height
  const maxPixels = 3_145_728
  const minPixels = 1_048_576

  if (w * h > maxPixels) {
    const ratio = Math.sqrt(maxPixels / (w * h))
    w = Math.floor(w * ratio)
    h = Math.floor(h * ratio)
  }
  if (w * h < minPixels) {
    const ratio = Math.sqrt(minPixels / (w * h))
    w = Math.floor(w * ratio)
    h = Math.floor(h * ratio)
  }
  return { width: w, height: h }
}

export function estimateAnlas(input: AnlasEstimateInput): AnlasEstimate {
  const px = Math.max(input.width * input.height, 65536)
  const strength = input.strength ?? 1

  let base = Math.ceil(2.951823174884865e-6 * px + 5.753298233447344e-7 * px * input.steps)
  const isV5 = input.model?.startsWith('nai-diffusion-5-') ?? false
  if (isV5) base *= 1.5
  const perImage = Math.max(Math.ceil(base * strength), 2)

  // 캐릭레퍼는 무료 조건을 깨지 않는다 (실측) — 대신 아래에서 별도 사용료 부과
  const freeEligible =
    px <= 1048576 &&
    input.steps <= 28 &&
    input.isOpus &&
    (!isV5 || input.opusUsageExhausted === false)

  const generation = freeEligible ? 0 : perImage * input.batchCount
  const charRef = (input.charRefCount ?? 0) * CHARREF_COST * input.batchCount
  const vibeEncoding = (input.unencodedVibes ?? 0) * VIBE_ENCODE_COST
  const supportsMultivibeSurcharge =
    input.model?.startsWith('nai-diffusion-4-') || input.model?.startsWith('nai-diffusion-5-')
  const vibeGeneration = supportsMultivibeSurcharge
    ? Math.max((input.vibeCount ?? 0) - 4, 0) * 2 * input.batchCount
    : 0
  const total = generation + charRef + vibeEncoding + vibeGeneration

  return {
    perImage,
    generation,
    charRef,
    vibeEncoding,
    vibeGeneration,
    total,
    free: total === 0,
    usesOpusUsage: isV5 && freeEligible
  }
}

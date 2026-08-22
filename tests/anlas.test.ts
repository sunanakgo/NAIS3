import { describe, expect, it } from 'vitest'
import {
  directorAugmentCost,
  directorToolCost,
  displayOpusUsagePercent,
  effectiveGenerationStrength,
  estimateAnlas,
  formatAnlasEstimate,
  opusUsagePercentSegments
} from '../src/shared/anlas'

const base = {
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  charRefCount: 0,
  isOpus: true,
  batchCount: 1
}

describe('Anlas 추정 (NAI 웹 공식 이식)', () => {
  it('V5 Usage 퍼센트는 부스트 값을 유지하고 소진 상태만 0%로 표시한다', () => {
    expect(
      displayOpusUsagePercent({ percent: 100, isNegative: false, timeUntilNextPercent: 0 })
    ).toBe(100)
    expect(
      displayOpusUsagePercent({ percent: 120, isNegative: false, timeUntilNextPercent: 0 })
    ).toBe(120)
    expect(
      displayOpusUsagePercent({ percent: -30, isNegative: false, timeUntilNextPercent: 0 })
    ).toBe(0)
    expect(
      displayOpusUsagePercent({ percent: 35, isNegative: true, timeUntilNextPercent: 0 })
    ).toBe(0)
  })

  it('V5 Usage 막대는 100% 단위 구간으로 나눈다', () => {
    expect(
      opusUsagePercentSegments({ percent: 70, isNegative: false, timeUntilNextPercent: 0 })
    ).toEqual([70])
    expect(
      opusUsagePercentSegments({ percent: 130, isNegative: false, timeUntilNextPercent: 0 })
    ).toEqual([100, 30])
    expect(
      opusUsagePercentSegments({ percent: 230, isNegative: false, timeUntilNextPercent: 0 })
    ).toEqual([100, 100, 30])
    expect(
      opusUsagePercentSegments({ percent: 200, isNegative: false, timeUntilNextPercent: 0 })
    ).toEqual([100, 100])
  })

  it('기본 해상도 28스텝 = 장당 20 Anlas (커뮤니티 공지값과 일치)', () => {
    expect(estimateAnlas({ ...base, isOpus: false }).perImage).toBe(20)
  })

  it('V5 유료 비용은 같은 조건 V4.5의 1.5배를 올림한다', () => {
    const r = estimateAnlas({ ...base, model: 'nai-diffusion-5-full', isOpus: false })
    expect(r.perImage).toBe(30)
  })

  it('V5 Opus는 usage 게이지가 고갈되면 정상 크기도 Anlas를 쓴다', () => {
    const r = estimateAnlas({
      ...base,
      model: 'nai-diffusion-5-curated',
      opusUsageExhausted: true
    })
    expect(r.free).toBe(false)
    expect(r.generation).toBe(30)
  })

  it('V5 usage 상태를 알 수 없으면 안전하게 Anlas 비용을 표시한다', () => {
    const r = estimateAnlas({ ...base, model: 'nai-diffusion-5-curated' })
    expect(r.usesOpusUsage).toBe(false)
    expect(r.generation).toBe(30)
  })

  it('V5 Opus는 usage 게이지가 남아 있으면 Anlas 대신 게이지를 쓴다', () => {
    const r = estimateAnlas({
      ...base,
      model: 'nai-diffusion-5-curated',
      opusUsageExhausted: false
    })
    expect(r.generation).toBe(0)
    expect(r.usesOpusUsage).toBe(true)
  })

  it('V5 Full i2i·인페인트도 Opus usage 게이지를 사용하고 Anlas는 쓰지 않는다', () => {
    const i2i = estimateAnlas({
      ...base,
      model: 'nai-diffusion-5-full',
      steps: 23,
      strength: 0.7,
      opusUsageExhausted: false
    })
    const inpaint = estimateAnlas({
      ...base,
      model: 'nai-diffusion-5-full-inpainting',
      steps: 23,
      strength: 1,
      opusUsageExhausted: false
    })
    expect(i2i.perImage).toBe(18)
    expect(inpaint.perImage).toBe(26)
    expect(i2i.generation).toBe(0)
    expect(inpaint.generation).toBe(0)
    expect(i2i.usesOpusUsage).toBe(true)
    expect(inpaint.usesOpusUsage).toBe(true)
  })

  it('V4.5 Opus i2i·인페인트도 정상 해상도와 28스텝 이하에서 무료다', () => {
    const r = estimateAnlas({ ...base, strength: 1 })
    expect(r.perImage).toBe(20)
    expect(r.generation).toBe(0)
    expect(r.free).toBe(true)
  })

  it('Opus + 무료 조건이면 배치 전체 무료 (NAIS3는 요청당 1장)', () => {
    const r = estimateAnlas({ ...base, batchCount: 10 })
    expect(r.generation).toBe(0)
    expect(r.free).toBe(true)
  })

  it('1024² 초과 해상도는 Opus도 과금', () => {
    const r = estimateAnlas({ ...base, width: 1024, height: 1536 })
    expect(r.free).toBe(false)
    expect(r.perImage).toBe(30)
    expect(r.generation).toBe(30)
  })

  it('29스텝부터는 Opus도 과금', () => {
    expect(estimateAnlas({ ...base, steps: 29 }).free).toBe(false)
  })

  it('캐릭터 레퍼런스: 무료 유지 + 장당·레퍼당 5 (실측: Opus·1024²·28스텝·레퍼1 = 5)', () => {
    const r = estimateAnlas({ ...base, width: 1024, height: 1024, charRefCount: 1 })
    expect(r.generation).toBe(0) // 생성 자체는 Opus 무료 유지
    expect(r.charRef).toBe(5)
    expect(r.total).toBe(5)
  })

  it('캐릭터 레퍼런스 사용료는 배치 수에 비례', () => {
    expect(estimateAnlas({ ...base, charRefCount: 1, batchCount: 3 }).total).toBe(15)
  })

  it('비용 안내는 무료 생성에 붙는 레퍼런스 비용까지 포함한 총액을 표시한다', () => {
    const r = estimateAnlas({ ...base, charRefCount: 1 })
    expect(formatAnlasEstimate(r)).toBe('예상 5 Anlas (레퍼런스 5)')
  })

  it('V5 게이지 배치는 중간 고갈 시 후속 이미지가 Anlas를 쓸 수 있음을 알린다', () => {
    const r = estimateAnlas({
      ...base,
      model: 'nai-diffusion-5-curated',
      opusUsageExhausted: false,
      batchCount: 5
    })
    expect(formatAnlasEstimate(r, 5)).toContain('중간에 고갈되면 후속 이미지는 Anlas 사용')
  })

  it('i2i strength는 비용을 비례 감소 (최소 2)', () => {
    const r = estimateAnlas({ ...base, isOpus: false, strength: 0.5 })
    expect(r.perImage).toBe(10)
    expect(estimateAnlas({ ...base, isOpus: false, strength: 0.01 }).perImage).toBe(2)
  })

  it('미설정 strength는 i2i 0.7, 인페인트 1로 계산한다', () => {
    expect(effectiveGenerationStrength(true, false, undefined)).toBe(0.7)
    expect(effectiveGenerationStrength(true, true, undefined)).toBe(1)
    expect(effectiveGenerationStrength(true, true, 0.45)).toBe(0.45)
    expect(effectiveGenerationStrength(false, false, undefined)).toBe(1)
  })

  it('미인코딩 바이브는 개당 2 Anlas (무료 생성이어도 과금)', () => {
    const r = estimateAnlas({ ...base, unencodedVibes: 2 })
    expect(r.vibeEncoding).toBe(4)
    expect(r.total).toBe(4)
    expect(r.free).toBe(false)
  })

  it('V4 이상은 바이브 4개 초과분마다 장당 2 Anlas를 추가한다', () => {
    const r = estimateAnlas({ ...base, vibeCount: 6, batchCount: 3 })
    expect(r.vibeGeneration).toBe(12)
    expect(r.total).toBe(12)
    expect(r.free).toBe(false)
  })

  it('배치는 장당 비용 × 개수', () => {
    expect(estimateAnlas({ ...base, isOpus: false, batchCount: 3 }).generation).toBe(60)
  })

  it('Opus의 1MP 이하 일반 디렉터 툴은 무료', () => {
    for (const method of [
      'lineart',
      'sketch',
      'colorize',
      'emotion',
      'declutter',
      'declutter-keep-bubbles'
    ] as const) {
      expect(directorAugmentCost(method, 832, 1216, true)).toBe(0)
    }
  })

  it('배경 제거는 기본 디렉터 비용 × 3 + 5로 계산', () => {
    expect(directorAugmentCost('bg-removal', 832, 1216, true)).toBe(65)
    // 작은 입력도 공식 웹처럼 약 1MP로 정규화한 뒤 계산한다.
    expect(directorAugmentCost('bg-removal', 512, 512, true)).toBe(65)
  })

  it('업스케일은 기존 픽셀 버킷 요금을 유지', () => {
    expect(directorToolCost(832, 1216, true)).toBe(7)
    expect(directorToolCost(768, 1024, true)).toBe(5)
  })
})

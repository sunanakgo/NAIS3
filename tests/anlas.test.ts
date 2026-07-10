import { describe, expect, it } from 'vitest'
import { directorAugmentCost, directorToolCost, estimateAnlas } from '../src/shared/anlas'

const base = {
  width: 832,
  height: 1216,
  steps: 28,
  charRefCount: 0,
  isOpus: true,
  batchCount: 1
}

describe('Anlas 추정 (NAI 웹 공식 이식)', () => {
  it('기본 해상도 28스텝 = 장당 20 Anlas (커뮤니티 공지값과 일치)', () => {
    expect(estimateAnlas({ ...base, isOpus: false }).perImage).toBe(20)
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

  it('i2i strength는 비용을 비례 감소 (최소 2)', () => {
    const r = estimateAnlas({ ...base, isOpus: false, strength: 0.5 })
    expect(r.perImage).toBe(10)
    expect(estimateAnlas({ ...base, isOpus: false, strength: 0.01 }).perImage).toBe(2)
  })

  it('미인코딩 바이브는 개당 2 Anlas (무료 생성이어도 과금)', () => {
    const r = estimateAnlas({ ...base, unencodedVibes: 2 })
    expect(r.vibeEncoding).toBe(4)
    expect(r.total).toBe(4)
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

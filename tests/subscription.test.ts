import { describe, expect, it } from 'vitest'
import { parseSubscriptionResponse } from '../src/main/nai/client'

describe('V5 Opus usage 응답', () => {
  it('subscription 응답의 충전 게이지와 Anlas를 함께 정규화한다', () => {
    expect(
      parseSubscriptionResponse({
        tier: 3,
        trainingStepsLeft: { fixedTrainingStepsLeft: 9000, purchasedTrainingSteps: 500 },
        usage: { percent: 42, isNegative: false, timeUntilNextPercent: 6048 }
      })
    ).toEqual({
      tier: 'opus',
      anlasFixed: 9000,
      anlasPurchased: 500,
      usage: { percent: 42, isNegative: false, timeUntilNextPercent: 6048 }
    })
  })

  it('usage가 없는 이전 응답도 정상 처리한다', () => {
    expect(parseSubscriptionResponse({ tier: 1 }).usage).toBeUndefined()
  })

  it('부스트로 100%를 넘긴 usage도 상한 없이 전달한다', () => {
    const usage = { percent: 230, isNegative: false, timeUntilNextPercent: 6048 }
    expect(parseSubscriptionResponse({ tier: 3, usage }).usage).toEqual(usage)
  })

  it('잘못된 usage 값은 UI에 전달하지 않는다', () => {
    expect(
      parseSubscriptionResponse({
        tier: 3,
        usage: { percent: 120, isNegative: false, timeUntilNextPercent: -1 }
      }).usage
    ).toBeUndefined()
  })
})

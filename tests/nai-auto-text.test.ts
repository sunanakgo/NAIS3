import { describe, expect, it } from 'vitest'
import { applyAutoText } from '../src/shared/nai-auto-text'

describe('NovelAI V5 Auto Text', () => {
  it('한글 인용문을 teXt 블록으로 반복한다', () => {
    expect(applyAutoText('"텍스트"')).toBe('"텍스트", teXt: 텍스트')
    expect(applyAutoText('간판에 "안녕하세요"라고 쓰여 있음')).toBe(
      '간판에 "안녕하세요"라고 쓰여 있음, teXt: 안녕하세요'
    )
  })

  it('스마트 따옴표와 여러 문구를 빈 줄로 구분한다', () => {
    expect(applyAutoText("“첫째”, 「둘째」, 'third'")).toBe(
      "“첫째”, 「둘째」, 'third', teXt: 첫째\n\n둘째\n\nthird"
    )
  })

  it('단어 안의 apostrophe는 인용문으로 취급하지 않는다', () => {
    expect(applyAutoText("don't render this")).toBe("don't render this")
  })

  it('명시적인 Text 블록이 있으면 자동 변환하지 않는다', () => {
    expect(applyAutoText('sign, Text: 직접 지정')).toBe('sign, Text: 직접 지정')
    expect(applyAutoText('sign', [{ prompt: 'Text: 캐릭터 지정' }])).toBe('sign')
  })

  it('캐릭터 프롬프트의 인용문도 메인 Text 블록에 포함한다', () => {
    expect(
      applyAutoText('two people', [
        { prompt: 'saying "왼쪽"', center: { x: 0.1, y: 0.5 } },
        { prompt: 'saying "오른쪽"', center: { x: 0.9, y: 0.5 } }
      ])
    ).toBe('two people, teXt: 왼쪽\n\n오른쪽')
  })

  it('좌표를 사용할 때 캐릭터 문구를 화면 읽기 순서로 정렬한다', () => {
    expect(
      applyAutoText(
        'comic',
        [
          { prompt: '"오른쪽"', center: { x: 0.9, y: 0.1 } },
          { prompt: '"아래"', center: { x: 0.5, y: 0.8 } },
          { prompt: '"왼쪽"', center: { x: 0.1, y: 0.1 } }
        ],
        true
      )
    ).toBe('comic, teXt: 왼쪽\n\n오른쪽\n\n아래')
  })

  it('첫 프롬프트 구역에만 Text 블록을 넣고 나머지 구역은 보존한다', () => {
    expect(applyAutoText('base "문구"|character|background')).toBe(
      'base "문구", teXt: 문구|character|background'
    )
  })
})

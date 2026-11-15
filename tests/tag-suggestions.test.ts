import { beforeEach, describe, expect, it } from 'vitest'
import {
  cachedTagSuggestions,
  clearTagSuggestionCache,
  rememberTagSuggestions
} from '../src/renderer/src/lib/tag-suggestions'

const tag = (name: string, count: number) => ({ tag: name, count, type: 'general' })

describe('태그 자동완성 렌더러 캐시', () => {
  beforeEach(() => clearTagSuggestionCache())

  it('처음 보는 검색어는 메인에 물어보게 한다', () => {
    expect(cachedTagSuggestions('long', 8)).toBeNull()
  })

  it('같은 검색어는 정규화해 캐시에서 바로 돌려준다', () => {
    const items = [tag('long hair', 10)]
    rememberTagSuggestions('long', 8, items)
    expect(cachedTagSuggestions(' LONG ', 8)).toBe(items)
    expect(cachedTagSuggestions('long', 4)).toBeNull()
  })

  it('두 글자 미만은 빈 결과', () => {
    expect(cachedTagSuggestions('l', 8)).toEqual([])
  })

  it('이전 결과가 전부였다면 이어 타이핑한 검색어를 그 안에서 걸러 만든다', () => {
    rememberTagSuggestions('ha', 8, [
      tag('hat', 50),
      tag('hair', 40),
      tag('long hair', 90),
      tag('chair', 30)
    ])
    expect(cachedTagSuggestions('hai', 8)?.map((t) => t.tag)).toEqual([
      'hair',
      'long hair',
      'chair'
    ])
    // 전부 결과에서 접두어였던 항목이 더 긴 검색어에선 부분 일치가 되는 경우도 계층을 다시 나눈다
    rememberTagSuggestions('lo', 8, [tag('lo lo long', 5), tag('long', 9), tag('slow', 3)])
    expect(cachedTagSuggestions('lon', 8)?.map((t) => t.tag)).toEqual(['long', 'lo lo long'])
  })

  it('limit을 꽉 채운 결과는 뒤에 더 있을 수 있어 걸러 쓰지 않는다', () => {
    rememberTagSuggestions('ha', 2, [tag('hat', 50), tag('hair', 40)])
    expect(cachedTagSuggestions('hai', 2)).toBeNull()
  })
})

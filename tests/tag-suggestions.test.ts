import { beforeEach, describe, expect, it } from 'vitest'
import {
  cachedTagSuggestions,
  clearTagSuggestionCache,
  rememberTagSuggestions
} from '../src/renderer/src/lib/tag-suggestions'
import type { TagEntry } from '../src/shared/tag-search'

const tag = (name: string, count: number, rank: number): TagEntry => ({
  tag: name,
  count,
  type: 'general',
  rank
})

describe('태그 자동완성 렌더러 캐시', () => {
  beforeEach(() => clearTagSuggestionCache())

  it('처음 보는 검색어는 메인에 물어보게 한다', () => {
    expect(cachedTagSuggestions('long', 8)).toBeNull()
  })

  it('같은 검색어는 정규화해 캐시에서 바로 돌려준다', () => {
    const items = [tag('long hair', 10, 0)]
    rememberTagSuggestions('long', 8, items)
    expect(cachedTagSuggestions(' LONG ', 8)).toBe(items)
    expect(cachedTagSuggestions('long', 4)).toBeNull()
  })

  it('두 글자 미만은 빈 결과', () => {
    expect(cachedTagSuggestions('l', 8)).toEqual([])
  })

  it('이전 결과가 전부였다면 이어 타이핑한 검색어를 그 안에서 걸러 만든다', () => {
    rememberTagSuggestions('ha', 8, [
      tag('hat', 50, 1),
      tag('hair', 40, 2),
      tag('long hair', 90, 0),
      tag('chair', 30, 3)
    ])
    expect(cachedTagSuggestions('hai', 8)?.map((t) => t.tag)).toEqual([
      'hair',
      'long hair',
      'chair'
    ])
    // 전부 결과에서 접두어였던 항목이 더 긴 검색어에선 부분 일치가 되는 경우도 계층을 다시 나눈다
    rememberTagSuggestions('lo', 8, [tag('lo lo long', 5, 1), tag('long', 9, 0), tag('slow', 3, 2)])
    expect(cachedTagSuggestions('lon', 8)?.map((t) => t.tag)).toEqual(['long', 'lo lo long'])
  })

  it('걸러 만든 결과도 count 동률의 원래 순위를 지킨다', () => {
    // 이전 검색의 접두어 목록과 부분 일치 목록이 섞일 때, count만으로 세우면 동률 순서가 뒤집힌다
    rememberTagSuggestions('qualia', 8, [
      tag('qualia (quaquaqualia)', 21, 7),
      tag('jack the ripper (memory of qualia) (fate)', 21, 3)
    ])
    expect(cachedTagSuggestions('qualia)', 8)?.map((t) => t.tag)).toEqual([
      'jack the ripper (memory of qualia) (fate)',
      'qualia (quaquaqualia)'
    ])
  })

  it('limit을 꽉 채운 결과는 뒤에 더 있을 수 있어 걸러 쓰지 않는다', () => {
    rememberTagSuggestions('ha', 2, [tag('hat', 50, 0), tag('hair', 40, 1)])
    expect(cachedTagSuggestions('hai', 2)).toBeNull()
  })
})

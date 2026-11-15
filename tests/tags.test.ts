import { describe, expect, it } from 'vitest'
import { buildTagIndex, createTagSearcher, type RawTag } from '../src/shared/tag-search'

const RAW: RawTag[] = [
  { value: 'long hair', count: 400, type: 'general' },
  { value: 'very long hair', count: 1_000, type: 'general' },
  { value: 'long sleeves', count: 500, type: 'general' },
  { value: 'blonde hair', count: 300, type: 'general' },
  { value: 'longshot', count: 200, type: 'artist' }
]

function searcher(raw: RawTag[] = RAW) {
  return createTagSearcher(buildTagIndex(raw))
}

describe('태그 자동완성', () => {
  it('두 글자 미만의 검색어에는 결과를 반환하지 않는다', () => {
    const s = searcher()
    expect(s.search('l')).toEqual([])
    expect(s.search(' _ ')).toEqual([])
  })

  it('대소문자와 밑줄을 정규화해 검색한다', () => {
    expect(
      searcher()
        .search(' LONG_HAIR ')
        .map((tag) => tag.tag)
    ).toEqual(['long hair', 'very long hair'])
  })

  it('더 인기 있는 부분 일치보다 접두어 일치를 먼저 반환한다', () => {
    expect(
      searcher()
        .search('long')
        .map((tag) => tag.tag)
    ).toEqual(['long sleeves', 'long hair', 'longshot', 'very long hair'])
  })

  it('요청한 결과 개수를 넘기지 않는다', () => {
    expect(
      searcher()
        .search('long', 2)
        .map((tag) => tag.tag)
    ).toEqual(['long sleeves', 'long hair'])
  })

  it('이름·개수·종류를 그대로 돌려준다', () => {
    expect(searcher().search('longs')).toEqual([{ tag: 'longshot', count: 200, type: 'artist' }])
  })

  it('이어 타이핑·지우기·limit 변경 중에도 전체 스캔과 같은 결과를 낸다', () => {
    // 인기순 스캔 캐시가 결과를 바꾸지 않는지, 단순 전체 스캔 구현과 대조한다
    const words = ['ab', 'abc', 'bcd', 'xab', 'abx', 'cab', 'a b', 'b a', 'zz', 'zab', 'abab']
    const raw: RawTag[] = []
    for (let i = 0; i < 400; i++) {
      const value = `${words[i % words.length]}${i % 7 === 0 ? '' : ` ${words[(i * 3) % words.length]}`}${i}`
      raw.push({ value, count: (i * 37) % 101, type: i % 5 === 0 ? 'artist' : 'general' })
    }
    const sorted = raw
      .map((t) => ({ tag: t.value, count: t.count, type: t.type }))
      .sort((a, b) => b.count - a.count)
    const reference = (q: string, limit: number) => {
      if (q.length < 2) return []
      const prefix = sorted.filter((t) => t.tag.startsWith(q))
      const rest = sorted.filter((t) => !t.tag.startsWith(q) && t.tag.includes(q))
      return [...prefix, ...rest].slice(0, limit)
    }

    const s = searcher(raw)
    const queries = [
      'ab',
      'abc',
      'abc ',
      'abc b',
      'abc',
      'ab',
      'b ',
      'b a',
      'b ab',
      'zz',
      'zab',
      'ab'
    ]
    for (const limit of [3, 8, 50]) {
      for (const q of queries) expect(s.search(q, limit)).toEqual(reference(q.trim(), limit))
    }
  })
})

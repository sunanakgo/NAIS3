import { clampTagLimit, normalizeTagQuery, type TagEntry } from '@shared/tag-search'

/**
 * 태그 자동완성 결과의 렌더러 쪽 캐시 (모든 프롬프트 에디터 공용).
 *
 * - 같은 검색어(지웠다 다시 치기, 다른 에디터에서 같은 태그)는 IPC·디바운스 없이 즉시 표시
 * - 이전 검색어의 결과가 limit개 미만이었다면 그게 일치 항목 "전부"이므로, 이어 타이핑한
 *   더 긴 검색어의 결과는 그 안에서 걸러 만들 수 있다 — 드문 태그를 칠 때 IPC가 사라진다
 */

const CACHE_SIZE = 200

const cache = new Map<string, TagEntry[]>()

function cacheKey(query: string, limit: number): string {
  return `${limit}\u0000${query}`
}

function store(key: string, items: TagEntry[]): void {
  cache.delete(key)
  cache.set(key, items)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
}

/** 이전의 "전부" 결과에서 q 결과를 만든다 — 접두어 일치(인기순) → 부분 일치(인기순) */
function narrow(items: TagEntry[], q: string): TagEntry[] {
  const prefix: TagEntry[] = []
  const rest: TagEntry[] = []
  for (const item of items) {
    if (item.tag.startsWith(q)) prefix.push(item)
    else if (item.tag.includes(q)) rest.push(item)
  }
  // 두 원본 목록(이전 검색어의 접두어/부분 일치)이 섞이므로 순위로 다시 세운다.
  // count만으로 세우면 동률의 순서가 직접 검색과 달라진다
  const byRank = (a: TagEntry, b: TagEntry): number => a.rank - b.rank
  return [...prefix.sort(byRank), ...rest.sort(byRank)]
}

/** 캐시만으로 답할 수 있으면 결과를, 아니면 null (메인에 물어봐야 함) */
export function cachedTagSuggestions(query: string, limit?: number): TagEntry[] | null {
  const q = normalizeTagQuery(query)
  if (q.length < 2) return []
  const max = clampTagLimit(limit)
  const key = cacheKey(q, max)

  const exact = cache.get(key)
  if (exact) {
    store(key, exact)
    return exact
  }

  for (let len = q.length - 1; len >= 2; len--) {
    const prev = cache.get(cacheKey(q.slice(0, len), max))
    if (!prev) continue
    // limit개를 꽉 채운 결과는 뒤에 더 있을 수 있어 못 쓴다. 더 짧은 검색어도 마찬가지(상위 집합)
    if (prev.length >= max) return null
    const items = narrow(prev, q)
    store(key, items)
    return items
  }
  return null
}

export function rememberTagSuggestions(
  query: string,
  limit: number | undefined,
  items: TagEntry[]
): void {
  const q = normalizeTagQuery(query)
  if (q.length < 2) return
  store(cacheKey(q, clampTagLimit(limit)), items)
}

/** 테스트용 */
export function clearTagSuggestionCache(): void {
  cache.clear()
}

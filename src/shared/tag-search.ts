/**
 * 단부루 태그 자동완성 검색 코어 (electron/fs 비의존 — 메인 워커·dev 게이트웨이·렌더러 캐시 공용).
 *
 * 검색 결과 규칙: 접두어 일치(인기순) → 그 외 부분 일치(인기순), 합쳐서 limit개.
 *
 * 성능 설계 (32만 건 기준):
 * - id = 인기 순위. 태그 이름은 배열 하나, count·type은 typed array로 압축 보관
 *   (객체 32만 개 대신 → 메모리·GC 부담 감소)
 * - 접두어: 이름 사전순 id 배열에서 이분 탐색으로 범위를 잡고, 범위 안의 상위 limit개만 고른다
 * - 부분 일치: 인기순 스캔 + 조기 종료. 스캔이 어디까지 갔는지와 그때까지의 일치 목록을
 *   캐시해 두고, 검색어가 이어 타이핑으로 길어지면(`lon` → `long`) 앞 결과를 걸러낸 뒤
 *   남은 구간만 이어서 스캔한다 — 드문 검색어도 글자마다 전체를 다시 훑지 않는다.
 */

export interface TagEntry {
  tag: string
  count: number
  type: string
  /** 인기 순위(0 = 최다). count 동률의 순서까지 확정한다 — 렌더러 캐시가 원본 순서를 재현할 때 쓴다 */
  rank: number
}

export interface RawTag {
  value: string
  count: number
  type: string
}

export interface TagIndex {
  /** 인기순(count 내림차순) 태그 이름. 배열 위치가 곧 id */
  names: string[]
  counts: Float64Array
  types: Uint8Array
  typeNames: string[]
  /** 이름 사전순으로 정렬한 id — 접두어 이분 탐색용 */
  byName: Uint32Array
}

export const MAX_TAG_LIMIT = 50
export const DEFAULT_TAG_LIMIT = 8

/**
 * 검색어 정규화 — 대소문자 무시, 밑줄은 공백(단부루 표기 → NAI 프롬프트 표기).
 * 밑줄에서 온 공백은 다듬지 않는다: `cow_`는 "cow 뒤에 단어가 이어짐"이라는 뜻이라
 * `cowboy shot`이 아니라 `cow print`를 찾아야 한다.
 */
export function normalizeTagQuery(query: string): string {
  return query.trim().toLowerCase().replace(/_/g, ' ')
}

export function clampTagLimit(limit: number | undefined): number {
  const value = Math.floor(Number(limit))
  if (!Number.isFinite(value) || value < 1) return DEFAULT_TAG_LIMIT
  return Math.min(MAX_TAG_LIMIT, value)
}

export function buildTagIndex(raw: RawTag[]): TagIndex {
  // 안정 정렬: 동률이면 원본 순서 유지 (기존 동작과 동일)
  const sorted = raw
    .map((t) => ({ tag: String(t.value).toLowerCase(), count: Number(t.count) || 0, type: t.type }))
    .sort((a, b) => b.count - a.count)

  const n = sorted.length
  const names = new Array<string>(n)
  const counts = new Float64Array(n)
  const types = new Uint8Array(n)
  const typeNames: string[] = []
  const typeIds = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const t = sorted[i]
    names[i] = t.tag
    counts[i] = t.count
    let typeId = typeIds.get(t.type)
    if (typeId === undefined) {
      typeId = typeNames.length
      typeIds.set(t.type, typeId)
      typeNames.push(t.type)
    }
    types[i] = typeId
  }

  const byName = new Uint32Array(n)
  for (let i = 0; i < n; i++) byName[i] = i
  // 코드 유닛 비교 — startsWith와 같은 기준이어야 이분 탐색 범위가 정확하다
  byName.sort((a, b) => (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : a - b))

  return { names, counts, types, typeNames, byName }
}

/** byName에서 q 이상인 첫 위치 */
function lowerBound(index: TagIndex, q: string): number {
  const { byName, names } = index
  let lo = 0
  let hi = byName.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (names[byName[mid]] < q) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 접두어 일치 중 인기 상위 limit개의 id (인기순) */
function prefixIds(index: TagIndex, q: string, limit: number): number[] {
  const { byName, names } = index
  const top: number[] = [] // 오름차순 유지 (id 작을수록 인기)
  for (let i = lowerBound(index, q); i < byName.length; i++) {
    const id = byName[i]
    if (!names[id].startsWith(q)) break
    if (top.length === limit && id > top[limit - 1]) continue
    let at = top.length
    while (at > 0 && top[at - 1] > id) at--
    top.splice(at, 0, id)
    if (top.length > limit) top.pop()
  }
  return top
}

interface ScanState {
  /** [0, scanned) 구간을 훑었다 */
  scanned: number
  /** 그 구간에서 검색어를 포함하는 모든 id (오름차순) */
  matches: number[]
}

const SCAN_CACHE_SIZE = 32

export interface TagSearcher {
  search(query: string, limit?: number): TagEntry[]
}

export function createTagSearcher(index: TagIndex): TagSearcher {
  // 최근 검색어별 스캔 상태 (Map 삽입 순서 = LRU)
  const scans = new Map<string, ScanState>()

  function remember(q: string, state: ScanState): void {
    scans.delete(q)
    scans.set(q, state)
    if (scans.size > SCAN_CACHE_SIZE) scans.delete(scans.keys().next().value as string)
  }

  /** q를 포함하는 가장 긴 이전 검색어의 스캔 상태를 q 기준으로 걸러 시작점으로 삼는다 */
  function startingState(q: string): ScanState {
    const exact = scans.get(q)
    if (exact) return { scanned: exact.scanned, matches: exact.matches.slice() }
    for (let len = q.length - 1; len >= 2; len--) {
      const prev = scans.get(q.slice(0, len))
      if (!prev) continue
      const { names } = index
      return { scanned: prev.scanned, matches: prev.matches.filter((id) => names[id].includes(q)) }
    }
    return { scanned: 0, matches: [] }
  }

  function substringIds(q: string, need: number): number[] {
    const { names } = index
    const state = startingState(q)
    const isOther = (id: number): boolean => !names[id].startsWith(q)
    let found = 0
    for (const id of state.matches) if (isOther(id)) found++

    // 이미 구간 안에서 충분하면 스캔 생략, 아니면 이어서 스캔
    const n = names.length
    let i = state.scanned
    while (found < need && i < n) {
      if (names[i].includes(q)) {
        state.matches.push(i)
        if (isOther(i)) found++
      }
      i++
    }
    state.scanned = i
    remember(q, state)

    const result: number[] = []
    for (const id of state.matches) {
      if (result.length >= need) break
      if (isOther(id)) result.push(id)
    }
    return result
  }

  function entry(id: number): TagEntry {
    return {
      tag: index.names[id],
      count: index.counts[id],
      type: index.typeNames[index.types[id]],
      rank: id
    }
  }

  return {
    search(query, limit) {
      const q = normalizeTagQuery(query)
      if (q.length < 2) return []
      const max = clampTagLimit(limit)
      const prefix = prefixIds(index, q, max)
      const rest = prefix.length < max ? substringIds(q, max - prefix.length) : []
      return [...prefix, ...rest].map(entry)
    }
  }
}

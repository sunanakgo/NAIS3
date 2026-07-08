/**
 * 조각 프롬프트/와일드카드 처리기 — NAIS2 fragment-processor.ts 이식.
 *
 * 지원 문법 (NAIS2와 동일):
 * 1. <이름> / <폴더/이름> — 조각에서 랜덤 줄 선택 (선택된 줄은 재귀 치환)
 * 2. <*이름> — 순차 선택 (배치 생성용, 경로별 카운터)
 * 3. <a|b|c> — 인라인 랜덤
 * 4. (a, b/c, d) — 괄호 와일드카드 (옵션에 쉼표 포함 가능)
 * 5. a/b/c — 쉼표 구분 태그 안의 단순 슬래시 (공백·URL 제외)
 *
 * NAIS2와 다른 점: 재귀 깊이 가드(10) 추가 — 자기 참조 조각의 무한 루프 방지.
 */

export interface FragmentSource {
  /** path("폴더/이름" 또는 "이름")로 조각 줄 목록 조회. 없으면 null */
  getLines: (path: string) => string[] | null
}

const MAX_DEPTH = 10
const sequentialCounters = new Map<string, number>()

export function resetSequentialCounters(): void {
  sequentialCounters.clear()
}

function normalizePath(path: string): string {
  return path.trim().toLowerCase()
}

function processFileWildcards(
  prompt: string,
  source: FragmentSource,
  rng: () => number,
  depth: number
): string {
  if (depth > MAX_DEPTH) return prompt
  const filePattern = /<([^<>]+)>/g

  return prompt.replace(filePattern, (match, content: string) => {
    const trimmed = content.trim()

    // 인라인 와일드카드: <a|b|c>
    if (trimmed.includes('|')) {
      const options = trimmed
        .split('|')
        .map((o) => o.trim())
        .filter((o) => o.length > 0)
      if (options.length === 0) return match
      return options[Math.floor(rng() * options.length)]
    }

    // 순차 모드: <*이름>
    const isSequential = trimmed.startsWith('*')
    const path = normalizePath(isSequential ? trimmed.slice(1) : trimmed)
    if (!path) return match

    const lines = source.getLines(path)
    if (!lines || lines.length === 0) return match // 조각 없으면 원본 유지 (NAIS2 동일)

    let line: string
    if (isSequential) {
      const index = sequentialCounters.get(path) ?? 0
      line = lines[index % lines.length]
      sequentialCounters.set(path, index + 1)
    } else {
      line = lines[Math.floor(rng() * lines.length)]
    }

    // 선택된 줄 안의 중첩 조각 재귀 치환
    return processFileWildcards(line, source, rng, depth + 1)
  })
}

/** (a, b/c, d) — 괄호 안에 슬래시가 있으면 옵션 세트 중 하나 선택 */
function processParenthesisWildcards(prompt: string, rng: () => number): string {
  const parenPattern = /\(([^()]+\/[^()]+)\)/g
  return prompt.replace(parenPattern, (_match, content: string) => {
    const options = content
      .split('/')
      .map((o) => o.trim())
      .filter((o) => o.length > 0)
    if (options.length <= 1) return content
    return options[Math.floor(rng() * options.length)]
  })
}

/** 쉼표 구분 태그 안의 a/b/c (공백 없음, URL 아님). 줄 단위로 처리해 개행을 보존한다 */
function processSimpleWildcards(prompt: string, rng: () => number): string {
  // ⚠️ 전체를 split(',')→join(', ')하면 trim이 개행을 삼켜 프롬프트가 한 줄로 붕괴한다
  //    (주석(#) 범위가 전체로 번져 빈 프롬프트가 전송되던 버그의 원인)
  return prompt
    .split('\n')
    .map((line) =>
      line
        .split(',')
        .map((tag) => {
          const trimmed = tag.trim()
          if (
            trimmed.includes('/') &&
            !trimmed.startsWith('http') &&
            !trimmed.includes('://') &&
            !trimmed.includes(' ')
          ) {
            const options = trimmed
              .split('/')
              .map((o) => o.trim())
              .filter((o) => o.length > 0)
            if (options.length > 1) return options[Math.floor(rng() * options.length)]
          }
          return trimmed
        })
        .join(', ')
    )
    .join('\n')
}

export function processWildcards(
  prompt: string,
  source: FragmentSource,
  rng: () => number = Math.random
): string {
  if (!prompt) return prompt
  let result = processFileWildcards(prompt, source, rng, 0)
  result = processParenthesisWildcards(result, rng)
  result = processSimpleWildcards(result, rng)
  return result
}

/**
 * NAI 가중치 문법 파서 — 프롬프트 에디터의 배경 하이라이트용.
 *
 * 실제 NAI 문법 (실캡처 fixture에서 확인):
 * - {...}  : 중첩당 ×1.05
 * - [...]  : 중첩당 ÷1.05
 * - N::...:: : 수치 가중치 (예: "1.0::mature women::", "-3:: artist collaboration ::")
 *   음수도 가능. 내부의 중괄호는 곱으로 누적된다.
 */

export interface WeightSegment {
  start: number
  end: number
  weight: number
}

const STEP = 1.05
const NUMERIC_OPEN = /^(-?\d+(?:\.\d+)?)::/

export function parseWeights(text: string): WeightSegment[] {
  const segments: WeightSegment[] = []
  let braces = 0
  let brackets = 0
  const numeric: number[] = []

  const effective = (): number => {
    const base = numeric.length > 0 ? numeric[numeric.length - 1] : 1
    return base * Math.pow(STEP, braces) * Math.pow(STEP, -brackets)
  }

  let segStart = 0
  let segWeight = effective()
  const boundary = (pos: number): void => {
    const w = effective()
    if (w === segWeight) return
    if (pos > segStart) segments.push({ start: segStart, end: pos, weight: segWeight })
    segStart = pos
    segWeight = w
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{') {
      braces++
      boundary(i) // 여는 괄호는 안쪽 가중치에 포함
      i++
    } else if (ch === '}') {
      if (braces > 0) braces--
      boundary(i + 1) // 닫는 괄호까지 안쪽 가중치
      i++
    } else if (ch === '[') {
      brackets++
      boundary(i)
      i++
    } else if (ch === ']') {
      if (brackets > 0) brackets--
      boundary(i + 1)
      i++
    } else if (text.startsWith('::', i) && numeric.length > 0) {
      numeric.pop()
      boundary(i + 2)
      i += 2
    } else {
      const m = NUMERIC_OPEN.exec(text.slice(i))
      if (m) {
        numeric.push(Number(m[1]))
        boundary(i)
        i += m[0].length
      } else {
        i++
      }
    }
  }
  if (text.length > segStart) segments.push({ start: segStart, end: text.length, weight: segWeight })
  return segments
}

/**
 * 가중치 → 하이라이트 배경. 1.0은 투명(null).
 * 강조(>1) = 붉은색, 약화(<1)·음수 = 파란색. 강도는 1.05 스텝 수 비례.
 */
export function weightBackground(weight: number): string | null {
  if (weight === 1) return null
  if (weight <= 0) return 'rgba(96, 145, 235, 0.45)'
  const steps = Math.abs(Math.log(weight) / Math.log(STEP))
  const alpha = Math.min(0.1 + steps * 0.09, 0.48)
  return weight > 1
    ? `rgba(233, 94, 80, ${alpha.toFixed(3)})`
    : `rgba(96, 145, 235, ${alpha.toFixed(3)})`
}

/** 조각 구문 <...> 하이라이트 (NAIS2의 녹색 계승) */
const FRAGMENT_BG = 'rgba(92, 190, 125, 0.3)'

/** 주석 줄(#로 시작) — 전송에서 제외됨을 회색 배경으로 표시 */
const COMMENT_BG = 'rgba(128, 128, 136, 0.28)'

/** #로 시작하는 줄 전체의 [시작, 끝) 구간 (removeComments와 동일 규칙 — 줄 중간 #는 태그) */
function commentSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) {
      spans.push({ start: offset, end: offset + line.length })
    }
    offset += line.length + 1 // '\n'
  }
  return spans
}

export interface HighlightRange {
  start: number
  end: number
  bg: string | null
}

/** 가중치 + 조각 + 주석을 합친 최종 하이라이트 구간. 주석 > 조각 > 가중치 순으로 우선 */
export function highlightRanges(text: string): HighlightRange[] {
  const fragments = [...text.matchAll(/<[^<>\n]+>/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length
  }))
  const inFragment = (pos: number): boolean =>
    fragments.some((f) => f.start <= pos && pos < f.end)

  const comments = commentSpans(text)
  const inComment = (pos: number): boolean =>
    comments.some((c) => c.start <= pos && pos < c.end)

  // 경계점: 가중치 세그먼트 + 조각 + 주석 경계
  const bounds = new Set<number>([0, text.length])
  const weights = parseWeights(text)
  for (const s of weights) {
    bounds.add(s.start)
    bounds.add(s.end)
  }
  for (const f of fragments) {
    bounds.add(f.start)
    bounds.add(f.end)
  }
  for (const c of comments) {
    bounds.add(c.start)
    bounds.add(c.end)
  }
  const sorted = [...bounds].sort((a, b) => a - b)

  const ranges: HighlightRange[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]
    const end = sorted[i + 1]
    const bg = inComment(start)
      ? COMMENT_BG
      : inFragment(start)
        ? FRAGMENT_BG
        : weightBackground(weights.find((s) => s.start <= start && start < s.end)?.weight ?? 1)
    // 같은 배경이면 직전 구간에 병합
    const prev = ranges[ranges.length - 1]
    if (prev && prev.bg === bg) prev.end = end
    else ranges.push({ start, end, bg })
  }
  return ranges
}

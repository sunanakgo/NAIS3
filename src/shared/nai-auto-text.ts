const MAX_PROMPT_SECTIONS = 6
const SECTION_SEPARATOR = '|'
const ESCAPED_SECTION_SEPARATOR = '||'
const ESCAPED_SINGLE_SENTINEL = '\u{103B9}'
const ESCAPED_DOUBLE_SENTINEL = '\u{12137}'

const TEXT_MARKER = /(?:^|\s|[,.:[\]{}\n、。])text:(?!:)/i
const AUTO_TEXT_MARKER = 'teXt:'

const QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  '“': '”',
  '「': '」',
  "'": "'",
  '‘': '’'
}

const JAPANESE_CHARACTERS =
  /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/gu

export interface AutoTextCharacterPrompt {
  prompt: string
  enabled?: boolean
  center?: { x: number; y: number }
}

/** NovelAI 웹과 동일하게 `|` 프롬프트 구역을 나누되 `||...||` 안의 `|`는 보존한다. */
function splitPromptSections(prompt: string): string[] {
  const protectedPrompt = prompt
    .split(ESCAPED_SECTION_SEPARATOR)
    .map((part, index) =>
      index % 2 === 1 ? part.split(SECTION_SEPARATOR).join(ESCAPED_SINGLE_SENTINEL) : part
    )
    .join(ESCAPED_DOUBLE_SENTINEL)
  const sections = protectedPrompt.split(SECTION_SEPARATOR)
  const limited = sections.slice(0, MAX_PROMPT_SECTIONS - 1)
  if (sections.length > MAX_PROMPT_SECTIONS - 1) {
    limited.push(sections.slice(MAX_PROMPT_SECTIONS - 1).join(SECTION_SEPARATOR))
  }
  return limited.map((section) =>
    section
      .replaceAll(ESCAPED_SINGLE_SENTINEL, SECTION_SEPARATOR)
      .replaceAll(ESCAPED_DOUBLE_SENTINEL, ESCAPED_SECTION_SEPARATOR)
  )
}

function isLetterOrNumber(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}

function isQuoteBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s,.]/.test(char)
}

function extractQuotedText(prompt: string): string[] {
  const found: string[] = []
  let cursor = 0
  while (cursor < prompt.length) {
    const opening = prompt[cursor]
    const closing = QUOTE_PAIRS[opening]
    if (closing === undefined || (opening === "'" && !isQuoteBoundary(prompt[cursor - 1]))) {
      cursor++
      continue
    }

    const apostropheLike = closing === "'" || closing === '’'
    let end = cursor + 1
    while (
      end < prompt.length &&
      (prompt[end] !== closing || (apostropheLike && isLetterOrNumber(prompt[end + 1])))
    ) {
      end++
    }
    if (end >= prompt.length) {
      cursor++
      continue
    }

    const text = prompt.slice(cursor + 1, end).trim()
    if (text) found.push(text)
    cursor = end + 1
  }
  return found
}

function splitRows<T extends { center: { x: number; y: number } }>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  const totalY = items[items.length - 1].center.y - items[0].center.y
  let splitAt = 1
  let largestGap = -1
  for (let index = 1; index < items.length; index++) {
    const gap = items[index].center.y - items[index - 1].center.y
    if (gap > largestGap) {
      largestGap = gap
      splitAt = index
    }
  }
  if (totalY <= 0.15 && largestGap <= 0.1) return [items]
  return [...splitRows(items.slice(0, splitAt)), ...splitRows(items.slice(splitAt))]
}

function charactersInReadingOrder(
  characters: (AutoTextCharacterPrompt & { center: { x: number; y: number } })[]
): AutoTextCharacterPrompt[] {
  return splitRows([...characters].sort((a, b) => a.center.y - b.center.y)).flatMap((row) =>
    row.sort((a, b) => a.center.x - b.center.x)
  )
}

function isMostlyJapanese(text: string): boolean {
  const count = text.match(JAPANESE_CHARACTERS)?.length ?? 0
  return count > 0 && count / text.length > 0.3
}

function autoTextEntries(
  basePrompt: string,
  characters: AutoTextCharacterPrompt[],
  useCoords: boolean
): string[] {
  const enabled = characters.filter((character) => character.enabled !== false && character.prompt)
  const ordered = useCoords
    ? charactersInReadingOrder(
        enabled.map((character) => ({
          ...character,
          center: character.center ?? { x: 0.5, y: 0.5 }
        }))
      )
    : enabled
  const groups = [
    extractQuotedText(basePrompt),
    ...ordered.map((item) => extractQuotedText(item.prompt))
  ]
  if (isMostlyJapanese(groups.flat().join(''))) {
    for (const group of groups) group.reverse()
  }
  return groups.flat()
}

/**
 * V5 웹의 Auto Text 동작: 따옴표 속 문구를 찾아 첫 프롬프트 구역 끝에 `teXt:`로 반복한다.
 * 명시적인 `Text:`가 이미 있으면 사용자의 순서와 내용을 그대로 존중한다.
 */
export function applyAutoText(
  prompt: string,
  characters: AutoTextCharacterPrompt[] = [],
  useCoords = false
): string {
  const enabled = characters.filter((character) => character.enabled !== false && character.prompt)
  if (TEXT_MARKER.test(prompt) || enabled.some((character) => TEXT_MARKER.test(character.prompt))) {
    return prompt
  }

  const sections = splitPromptSections(prompt)
  const entries = autoTextEntries(sections[0] ?? '', enabled, useCoords)
  if (entries.length === 0) return prompt

  const textBlock = `${AUTO_TEXT_MARKER} ${entries.join('\n\n')}`
  const base = (sections[0] ?? '').replace(/[\s,]+$/, '')
  sections[0] = base ? `${base}, ${textBlock}` : textBlock
  return sections.join(SECTION_SEPARATOR)
}

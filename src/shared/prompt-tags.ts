const STRIKE = '\u0336'
interface Range {
  start: number
  end: number
}
interface Group extends Range {
  openEnd: number
  closeStart: number
}
interface Tag extends Range {
  disabled: boolean
  parts: Range[]
}
interface Syntax {
  boundaries: Set<number>
  groups: Group[]
  protected: Set<number>
  references: Range[]
  syntaxMarkers: Set<number>
}

export function maskPromptComments(text: string): string {
  return text.replace(/^[ \t]*#[^\r\n]*/gm, (line) => ' '.repeat(line.length))
}

/** Read syntax without state markers, retaining exact stored offsets. */
function syntaxOf(text: string): Syntax {
  const masked = maskPromptComments(text)
  let plain = ''
  const offsets: number[] = []
  for (let i = 0; i < masked.length; i++)
    if (masked[i] !== STRIKE) {
      plain += masked[i]
      offsets.push(i)
    }
  const start = (i: number): number => offsets[i] ?? text.length
  const end = (i: number): number => {
    let pos = i > 0 ? offsets[i - 1] + 1 : 0
    while (text[pos] === STRIKE) pos++
    return pos
  }
  const groups: Group[] = [],
    references: Range[] = [],
    protectedIndices = new Set<number>()
  const syntaxMarkers = new Set<number>()
  const boundaries = new Set<number>()
  const boundary = (a: number, b: number): void => {
    boundaries.add(start(a))
    boundaries.add(end(b))
  }
  const protect = (a: number, b: number): void => {
    for (let i = start(a); i < end(b); i++) {
      protectedIndices.add(i)
      if (text[i] === STRIKE) syntaxMarkers.add(i)
    }
  }
  const stack: { start: number; openEnd: number; close: string }[] = []
  const numeric = /-?\d+(?:\.\d+)?::/y
  for (let i = 0; i < plain.length;) {
    if (plain[i] === '<') {
      const match = /^<[^<>\n]+>/.exec(plain.slice(i))
      if (match) {
        const to = i + match[0].length
        protect(i, to)
        references.push({ start: start(i), end: end(to) })
        i = to
        continue
      }
    }
    numeric.lastIndex = i
    const open = numeric.exec(plain)
    if (open) {
      const to = i + open[0].length
      boundary(i, to)
      protect(i, to)
      stack.push({ start: i, openEnd: to, close: '::' })
      i = to
      continue
    }
    const top = stack[stack.length - 1]
    if (top && plain.startsWith(top.close, i)) {
      const to = i + top.close.length
      if (top.close === '::') boundary(i, to)
      protect(i, to)
      stack.pop()
      groups.push({
        start: start(top.start),
        openEnd: end(top.openEnd),
        closeStart: start(i),
        end: end(to)
      })
      i = to
      continue
    }
    if ('{}[]'.includes(plain[i])) {
      protect(i, i + 1)
      if (plain[i] === '{' || plain[i] === '[')
        stack.push({ start: i, openEnd: i + 1, close: plain[i] === '{' ? '}' : ']' })
    } else if (plain.startsWith('::', i)) {
      boundary(i, i + 2)
      protect(i, i + 2)
      i += 2
      continue
    }
    i++
  }
  for (const match of text.matchAll(/^[ \t]*#[^\r\n]*/gm))
    for (let i = match.index!; i < match.index! + match[0].length; i++) protectedIndices.add(i)
  return { groups, protected: protectedIndices, references, syntaxMarkers, boundaries }
}

function tagsOf(text: string, syntax: Syntax): Tag[] {
  const masked = maskPromptComments(text),
    tags: Tag[] = []
  // Numeric weight delimiters also separate tags. Comments and fragment syntax do not.
  const cuts = [...syntax.boundaries].sort((a, b) => a - b)
  const segments: Range[] = []
  let cutIndex = 0
  for (const match of masked.matchAll(/[^,]+/g)) {
    let start = match.index!
    const end = start + match[0].length
    while (cutIndex < cuts.length && cuts[cutIndex] <= start) cutIndex++
    while (cutIndex < cuts.length && cuts[cutIndex] < end) {
      const cut = cuts[cutIndex++]
      segments.push({ start, end: cut })
      start = cut
    }
    segments.push({ start, end })
  }
  for (const { start: a, end: b } of segments) {
    let first = -1,
      last = -1
    for (let i = a; i < b; i++)
      if (!syntax.protected.has(i) && !/\s/.test(text[i]) && text[i] !== STRIKE) {
        if (first < 0) first = i
        last = i
      }
    if (first < 0) continue
    let finish = last + 1
    while (text[finish] === STRIKE && !syntax.protected.has(finish)) finish++
    const parts: Range[] = []
    for (let i = first; i < finish;) {
      if (syntax.protected.has(i)) {
        i++
        continue
      }
      const from = i++
      while (i < finish && !syntax.protected.has(i)) i++
      parts.push({ start: from, end: i })
    }
    tags.push({
      start: first,
      end: finish,
      parts,
      disabled: parts.some((p) => text.slice(p.start, p.end).includes(STRIKE))
    })
  }
  return tags
}

export function promptTags(text: string): Tag[] {
  return tagsOf(text, syntaxOf(text))
}

export function promptTagChange(
  text: string,
  start: number,
  end: number
): { value: string; mapPosition: (position: number) => number } {
  const syntax = syntaxOf(text)
  const tagParts = tagsOf(text, syntax).flatMap((tag) => tag.parts)
  const orphanMarkers = new Set<number>()
  for (let i = 0, part = 0; i < text.length; i++) {
    while (part < tagParts.length && tagParts[part].end <= i) part++
    if (
      text[i] === STRIKE &&
      !syntax.protected.has(i) &&
      !(part < tagParts.length && tagParts[part].start <= i)
    )
      orphanMarkers.add(i)
  }
  let enabling = false
  for (let i = start; i < end; i++)
    if (text[i] === STRIKE && !syntax.protected.has(i)) {
      enabling = true
      break
    }
  const changes: { position: number; delta: number }[] = []
  let replacement = '',
    offset = 0
  for (const char of text) {
    const protectedChar = syntax.protected.has(offset)
    const inTag = offset >= start && offset < end
    if (
      char === STRIKE &&
      (syntax.syntaxMarkers.has(offset) ||
        orphanMarkers.has(offset) ||
        (inTag && enabling && !protectedChar))
    )
      changes.push({ position: offset + 1, delta: -1 })
    else {
      replacement += char
      if (
        inTag &&
        !enabling &&
        !protectedChar &&
        char !== STRIKE &&
        char !== '\n' &&
        char !== '\r'
      ) {
        replacement += STRIKE
        changes.push({ position: offset + char.length, delta: 1 })
      }
    }
    offset += char.length
  }
  return {
    value: replacement,
    mapPosition: (position) =>
      position +
      changes.reduce((delta, change) => delta + (position >= change.position ? change.delta : 0), 0)
  }
}

export function togglePromptTag(text: string, start: number, end: number): string {
  return promptTagChange(text, start, end).value
}

function disabledGroupsOf(tags: Tag[], syntax: Syntax): Group[] {
  return syntax.groups.filter((group) => {
    if (syntax.references.some((ref) => ref.start < group.closeStart && ref.end > group.openEnd))
      return false
    const inside = tags.filter((tag) =>
      tag.parts.some((p) => p.start < group.closeStart && p.end > group.openEnd)
    )
    return inside.length > 0 && inside.every((tag) => tag.disabled)
  })
}

export function disabledWeightGroups(text: string): Group[] {
  const syntax = syntaxOf(text)
  return disabledGroupsOf(tagsOf(text, syntax), syntax)
}

function removeRanges(text: string, ranges: Range[]): string {
  let result = '',
    cursor = 0
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.end <= cursor) continue
    result += text.slice(cursor, Math.max(cursor, range.start))
    cursor = range.end
  }
  return result + text.slice(cursor)
}

export function stripDisabledTags(text: string): string {
  const syntax = syntaxOf(text),
    tags = tagsOf(text, syntax),
    disabled = tags.filter((t) => t.disabled)
  if (!disabled.length)
    return removeRanges(
      text,
      [...syntax.syntaxMarkers].map((start) => ({ start, end: start + 1 }))
    )
  const ranges = disabled.flatMap((t) => t.parts)
  for (const group of disabledGroupsOf(tags, syntax))
    ranges.push(
      { start: group.start, end: group.openEnd },
      { start: group.closeStart, end: group.end }
    )
  // Remove only content: a weight may cross several comma segments.
  // Discard comments before separator cleanup, just as in generation.
  let result = removeRanges(maskPromptComments(text), ranges).replaceAll(STRIKE, '')
  const trims: Range[] = []
  for (const group of syntaxOf(result).groups) {
    const inner = result.slice(group.openEnd, group.closeStart)
    const leading = /^(?:\s*,)+\s*/.exec(inner),
      trailing = /(?:,\s*)+$/.exec(inner)
    if (leading) trims.push({ start: group.openEnd, end: group.openEnd + leading[0].length })
    if (trailing) trims.push({ start: group.openEnd + trailing.index, end: group.closeStart })
  }
  result = removeRanges(result, trims)
  return result
    .replace(/,(\s*,)+/g, ',')
    .replace(/(^\s*,\s*|,\s*$)/g, '')
    .trim()
}

export function analyzePromptTags(text: string): { tags: Tag[]; disabledGroups: Group[] } {
  const syntax = syntaxOf(text),
    tags = tagsOf(text, syntax)
  return { tags, disabledGroups: disabledGroupsOf(tags, syntax) }
}

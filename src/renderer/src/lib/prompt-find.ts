/** Search visible text while returning offsets in the textarea's stored text. */
export function promptSearchHits(value: string, query: string): { start: number; end: number }[] {
  const needle = query.replaceAll('\u0336', '').toLowerCase()
  if (!needle) return []
  let plain = '',
    offset = 0
  const starts: number[] = [],
    ends: number[] = []
  for (const char of value) {
    if (char !== '\u0336') {
      const folded = char.toLowerCase()
      let end = offset + char.length
      while (value[end] === '\u0336') end++
      plain += folded
      for (let i = 0; i < folded.length; i++) {
        starts.push(offset)
        ends.push(end)
      }
    }
    offset += char.length
  }
  const hits: { start: number; end: number }[] = []
  for (let i = plain.indexOf(needle); i !== -1; i = plain.indexOf(needle, i + needle.length))
    hits.push({ start: starts[i], end: ends[i + needle.length - 1] })
  return hits
}

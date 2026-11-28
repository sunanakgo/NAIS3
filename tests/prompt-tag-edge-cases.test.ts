import { expect, it } from 'vitest'
import { parseWeights } from '../src/renderer/src/lib/prompt-weights'
import { promptTags, togglePromptTag, stripDisabledTags } from '../src/shared/prompt-tags'

const fixtures = [
  '1.5::a, b, c::, d',
  '1.5::{a, b, c}::, d',
  '{{a}, b, [c]}, d',
  '1.5::a 1.2::detail::, b, c::, d',
  'a 1.5::detail, b, c::, d',
  '1.5::a:: detail, b, c',
  '1.5::a, 1.2::b:: detail, c::, d',
  '1.5::a, b:: 1.2::detail, c::, d',
  '1.5::{a}, [b], {{c}}::, d',
  '1.5::a,\n# keep, comment\nb, c::, d',
  '-2::한글 😀, other, last::, outside'
]

it.each(fixtures)(
  'keeps syntax and subsequent tags intact through every toggle: %s',
  (original) => {
    const count = promptTags(original).length
    for (let index = 0; index < count; index++) {
      const tag = promptTags(original)[index]
      const off = togglePromptTag(original, tag.start, tag.end)
      expect(promptTags(off).length).toBe(count)
      const current = promptTags(off)[index]
      expect(togglePromptTag(off, current.start, current.end)).toBe(original)
      const syntax = (s: string): RegExpMatchArray | null =>
        s.match(/-?\d+(?:\.\d+)?::|::|[{}[\]]/g)
      expect(syntax(off)).toEqual(syntax(original))
      expect(stripDisabledTags(off)).not.toContain('\u0336')
      for (let j = 0; j < count; j++)
        if (j !== index) {
          const other = promptTags(original)[j]
          const raw = original.slice(other.start, other.end)
          expect(stripDisabledTags(off)).toContain(raw)
        }
    }
  }
)

it.each(fixtures)(
  'preserves every active word and its weight for all on/off combinations: %s',
  (original) => {
    const tags = promptTags(original)
    const words = [...original.matchAll(/[A-Za-z]+/g)].filter(
      (m) => !original.slice(0, m.index).split('\n').at(-1)?.includes('#')
    )
    const weightAt = (text: string, pos: number): number =>
      parseWeights(text).find((s) => s.start <= pos && s.end > pos)?.weight ?? 1
    for (let mask = 0; mask < 1 << tags.length; mask++) {
      let text = original
      for (let i = 0; i < tags.length; i++)
        if (mask & (1 << i)) {
          const tag = promptTags(text)[i]
          text = togglePromptTag(text, tag.start, tag.end)
          expect(promptTags(text)).toHaveLength(tags.length)
        }
      const outgoing = stripDisabledTags(text)
      for (const word of words) {
        const owner = tags.findIndex((t) =>
          t.parts.some((p) => p.start <= word.index! && p.end > word.index!)
        )
        if (owner < 0) continue
        const match = new RegExp('\\b' + word[0] + '\\b').exec(outgoing)
        if (mask & (1 << owner))
          expect(match, `${mask}: disabled ${word[0]} in ${outgoing}`).toBeNull()
        else {
          expect(match, `${mask}: missing ${word[0]} in ${outgoing}`).not.toBeNull()
          expect(weightAt(outgoing, match!.index)).toBeCloseTo(weightAt(original, word.index!), 8)
        }
      }
      for (let i = tags.length - 1; i >= 0; i--)
        if (mask & (1 << i)) {
          const tag = promptTags(text)[i]
          text = togglePromptTag(text, tag.start, tag.end)
        }
      expect(text).toBe(original)
    }
  }
)

it('preserves an untoggleable fragment and its weight when neighboring tags are disabled', () => {
  const original = '1.5::a, <folder/name>, b::, c'
  let text = original
  for (const i of [0, 1]) {
    const t = promptTags(text)[i]
    text = togglePromptTag(text, t.start, t.end)
  }
  expect(stripDisabledTags(text)).toBe('1.5::<folder/name>::, c')
})

it('repairs markers in weight syntax saved by older toggles without losing enabled siblings', () => {
  const text = 'blue eyes 1.5::detail, red hair, smile::, standing'
  const legacy = [...text.slice(0, 21)].map((c) => c + '\u0336').join('') + text.slice(21)
  const tag = promptTags(legacy)[0]
  expect(stripDisabledTags(legacy)).toBe('1.5::red hair, smile::, standing')
  let restored = togglePromptTag(legacy, tag.start, tag.end)
  expect(promptTags(restored)[1].disabled).toBe(true)
  const detail = promptTags(restored)[1]
  restored = togglePromptTag(restored, detail.start, detail.end)
  expect(restored).toBe(text)
})

it.each([
  'a, b, c',
  '0::a, b, c::',
  '-1.2::a, b, c::',
  '{{a, [b], c}}',
  '1.5::a, 2::b, c::::',
  'a,\r\n# notes, retained\r\nb, c',
  'a, a, a',
  '1.5::a, b, c',
  'a, b, c::'
])('restores exact stored text through repeated forward/backward toggles: %s', (original) => {
  let value = original
  const count = promptTags(original).length
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < count; i++) {
      const t = promptTags(value)[i]
      value = togglePromptTag(value, t.start, t.end)
    }
    for (let i = count - 1; i >= 0; i--) {
      const t = promptTags(value)[i]
      value = togglePromptTag(value, t.start, t.end)
    }
    expect(value).toBe(original)
  }
})

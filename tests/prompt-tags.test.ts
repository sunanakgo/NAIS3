import { expect, it } from 'vitest'
import { promptTags, stripDisabledTags, togglePromptTag } from '../src/shared/prompt-tags'
import { disabledWeightGroups } from '../src/shared/prompt-tags'
import { removeComments } from '../src/shared/nai-presets'

it('toggles one occurrence, preserves text and restores it exactly', () => {
  const text = 'blue eyes, blue eyes, 한글 태그'
  const tag = promptTags(text)[1]
  const off = togglePromptTag(text, tag.start, tag.end)
  expect(stripDisabledTags(off)).toBe('blue eyes, 한글 태그')
  const disabled = promptTags(off)[1]
  expect(togglePromptTag(off, disabled.start, disabled.end)).toBe(text)
})
it('keeps weighting delimiters and excludes comments and fragment paths', () => {
  const text = '1.5::{blue eyes}::, <folder/name>\n# comment'
  expect(promptTags(text).map((r) => text.slice(r.start, r.end))).toEqual(['blue eyes'])
  const tag = promptTags(text)[0]
  expect(removeComments(togglePromptTag(text, tag.start, tag.end))).toBe('<folder/name>')
})
it('handles unicode and whitespace without losing enabled text', () => {
  const text = '  한글 😀, red hair'
  const tag = promptTags(text)[0]
  const off = togglePromptTag(text, tag.start, tag.end)
  expect(stripDisabledTags(off)).toBe('red hair')
  const r = promptTags(off)[0]
  expect(togglePromptTag(off, r.start, r.end)).toBe(text)
})

it('keeps newlines and single colons inside tags', () => {
  const text = 'blue eyes\nred hair: detail, smile'
  expect(promptTags(text).map((t) => text.slice(t.start, t.end))).toEqual([
    'blue eyes\nred hair: detail',
    'smile'
  ])
})
it('splits at numeric weight openings and closings without a comma', () => {
  const text = 'long hair\n1.3::blue eyes, red ribbon:: outside'
  expect(promptTags(text).map((tag) => text.slice(tag.start, tag.end))).toEqual([
    'long hair',
    'blue eyes',
    'red ribbon',
    'outside'
  ])
  const blue = promptTags(text)[1]
  const off = togglePromptTag(text, blue.start, blue.end)
  expect(promptTags(off).map((tag) => tag.disabled)).toEqual([false, true, false, false])
  expect(stripDisabledTags(off)).toContain('long hair')
  expect(stripDisabledTags(off)).toContain('1.3::red ribbon:: outside')
})
it('disables a weight only when every child is off and restores it with one enabled child', () => {
  let text = '1.5::blue eyes, red hair::, smile'
  let tags = promptTags(text)
  text = togglePromptTag(text, tags[0].start, tags[0].end)
  expect(disabledWeightGroups(text)).toHaveLength(0)
  expect(stripDisabledTags(text)).toContain('1.5::')
  tags = promptTags(text)
  text = togglePromptTag(text, tags[1].start, tags[1].end)
  expect(disabledWeightGroups(text)).toHaveLength(1)
  expect(stripDisabledTags(text)).toBe('smile')
  tags = promptTags(text)
  text = togglePromptTag(text, tags[0].start, tags[0].end)
  expect(disabledWeightGroups(text)).toHaveLength(0)
  expect(stripDisabledTags(text)).toBe('1.5::blue eyes::, smile')
})
it('removes nested empty weight wrappers with all children off', () => {
  let text = '1.5::{blue eyes, red hair}::'
  for (let i = 0; i < 2; i++) {
    const t = promptTags(text)[i]
    text = togglePromptTag(text, t.start, t.end)
  }
  expect(stripDisabledTags(text)).toBe('')
})

it('masks whole comment lines before finding comma-delimited tags', () => {
  const text = '1girl, smile,\n# pose notes, not a tag\nstanding, outdoors'
  expect(promptTags(text).map((tag) => text.slice(tag.start, tag.end))).toEqual([
    '1girl',
    'smile',
    'standing',
    'outdoors'
  ])
})
it('does not add markers to a comment inside a multi-line tag', () => {
  const text = 'blue eyes\n  # keep this, comment\nred hair, smile'
  const tag = promptTags(text)[0]
  const off = togglePromptTag(text, tag.start, tag.end)
  expect(off).toContain('  # keep this, comment')
  expect(removeComments(off)).toBe('smile')
  const again = promptTags(off)[0]
  expect(togglePromptTag(off, again.start, again.end)).toBe(text)
})
it.each([0, 1, 2])('cleans separators when disabling occurrence %s', (index) => {
  const text = '1girl, blush, smile'
  const tag = promptTags(text)[index]
  expect(stripDisabledTags(togglePromptTag(text, tag.start, tag.end))).toBe(
    ['blush, smile', '1girl, smile', '1girl, blush'][index]
  )
})
it('does not treat numeric weights in comments as active syntax', () => {
  const text = '# 2::comment, ignored::\n1girl, smile'
  expect(promptTags(text).map((tag) => text.slice(tag.start, tag.end))).toEqual(['1girl', 'smile'])
})

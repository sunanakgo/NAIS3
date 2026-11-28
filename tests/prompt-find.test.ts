import { expect, it } from 'vitest'
import { promptSearchHits } from '../src/renderer/src/lib/prompt-find'
import { togglePromptTag } from '../src/shared/prompt-tags'
it('finds disabled and enabled occurrences using ordinary visible text', () => {
  const value = togglePromptTag('blue eyes, blue eyes', 0, 9)
  expect(promptSearchHits(value, 'BLUE EYES')).toEqual([
    { start: 0, end: 18 },
    { start: 20, end: 29 }
  ])
})
it('accepts a selection that includes stored markers', () => {
  const value = togglePromptTag('한글 😀', 0, 5)
  const hits = promptSearchHits(value, value)
  expect(hits).toEqual([{ start: 0, end: value.length }])
})
it('keeps source offsets when case folding expands a character', () => {
  expect(promptSearchHits('İ, smile', 'smile')).toEqual([{ start: 3, end: 8 }])
})
it.each(['', '\u0336'])('has no matches for an empty visible query: %s', (query) => {
  expect(promptSearchHits('text', query)).toEqual([])
})

// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import {
  promptArrowSelection,
  promptDeletionRange,
  installPromptCharacterEditing
} from '../src/renderer/src/lib/prompt-character-edit'

const mark = '\u2060'
it.each(['abc', '한글', '😀👍🏽', 'e\u0301', '👩‍👩‍👧‍👦', '\u1100\u1161'])(
  'deletes visible graphemes and all their markers in one step: %s',
  (plain) => {
    let value = [...plain].map((char) => char + mark).join('')
    const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(plain)]
    for (let i = segments.length - 1; i >= 0; i--) {
      const range = promptDeletionRange(value, value.length, value.length, true)!
      expect(value.slice(range.start, range.end).replaceAll(mark, '')).toBe(segments[i].segment)
      value = value.slice(0, range.start)
    }
    expect(value).toBe('')
  }
)
it('moves left/right and shift selection once per visible character', () => {
  const value = `a${mark}b${mark}`
  expect(promptArrowSelection(value, 0, 0, 'none', true, false)).toMatchObject({ start: 2, end: 2 })
  expect(promptArrowSelection(value, 4, 4, 'none', false, false)).toMatchObject({
    start: 2,
    end: 2
  })
  expect(promptArrowSelection(value, 0, 2, 'forward', true, true)).toEqual({
    start: 0,
    end: 4,
    direction: 'forward'
  })
  expect(promptArrowSelection(value, 0, 4, 'forward', false, true)).toEqual({
    start: 0,
    end: 2,
    direction: 'forward'
  })
  expect(promptArrowSelection(value, 2, 4, 'backward', false, true)).toEqual({
    start: 0,
    end: 4,
    direction: 'backward'
  })
})
it('expands deletion from within a marker pair and across partial selections', () => {
  const value = `a${mark}b${mark}, c`
  expect(promptDeletionRange(value, 1, 1, true)).toEqual({ start: 0, end: 2 })
  expect(promptDeletionRange(value, 1, 1, false)).toEqual({ start: 0, end: 2 })
  expect(promptDeletionRange(value, 0, 3, false)).toEqual({ start: 0, end: 4 })
  expect(promptDeletionRange(value, 6, 6, false)).toBeNull()
  expect(promptArrowSelection('normal', 2, 2, 'none', true, false)).toBeNull()
})
it('prepares native deletion without cancelling input, and leaves composition and modifiers alone', () => {
  const ta = document.createElement('textarea')
  ta.value = `a${mark}b${mark}`
  const dispose = installPromptCharacterEditing(ta)
  ta.setSelectionRange(4, 4)
  const composing = new InputEvent('beforeinput', {
    inputType: 'deleteContentBackward',
    isComposing: true
  })
  ta.dispatchEvent(composing)
  expect(ta.selectionStart).toBe(4)
  const deletion = new InputEvent('beforeinput', {
    inputType: 'deleteContentBackward',
    cancelable: true
  })
  ta.dispatchEvent(deletion)
  expect(deletion.defaultPrevented).toBe(false)
  expect([ta.selectionStart, ta.selectionEnd]).toEqual([2, 4])
  ta.setSelectionRange(4, 4)
  const word = new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, cancelable: true })
  ta.dispatchEvent(word)
  expect(word.defaultPrevented).toBe(false)
  dispose()
  ta.dispatchEvent(deletion)
  expect(ta.selectionStart).toBe(4)
})

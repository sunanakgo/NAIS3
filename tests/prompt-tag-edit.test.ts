// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { applyPromptTagToggle } from '../src/renderer/src/lib/prompt-tag-edit'
import { togglePromptTag } from '../src/shared/prompt-tags'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('maps a selection after a toggled tag and restores scroll and direction', async () => {
  const ta = document.createElement('textarea')
  document.body.append(ta)
  ta.value = 'blue eyes, red hair'
  ta.setSelectionRange(11, 19, 'backward')
  ta.scrollTop = 50
  const change = vi.fn()
  applyPromptTagToggle(ta, ta.value, 0, 9, change)
  expect(ta.value).toBe(togglePromptTag('blue eyes, red hair', 0, 9))
  expect([ta.selectionStart, ta.selectionEnd, ta.selectionDirection]).toEqual([20, 28, 'backward'])
  expect(ta.scrollTop).toBe(50)
  expect(change).toHaveBeenCalledWith(ta.value)
  applyPromptTagToggle(ta, ta.value, 0, 18, change)
  expect([ta.selectionStart, ta.selectionEnd]).toEqual([11, 19])
})

it('selects only the target before a native history insertion and never inserts twice', () => {
  const ta = document.createElement('textarea')
  document.body.append(ta)
  ta.value = 'blue eyes, red hair'
  const command = vi.fn((_name: string, _ui: boolean, text: string) => {
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([11, 19])
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end')
    return true
  })
  Object.defineProperty(document, 'execCommand', { value: command, configurable: true })
  try {
    applyPromptTagToggle(ta, ta.value, 11, 19, vi.fn())
    expect(command).toHaveBeenCalledTimes(1)
    expect(ta.value).toBe(togglePromptTag('blue eyes, red hair', 11, 19))
  } finally {
    Reflect.deleteProperty(document, 'execCommand')
  }
})

it('repairs legacy syntax markers and maps the caret before returning', () => {
  const ta = document.createElement('textarea')
  document.body.append(ta)
  const original = 'a 1.5::detail, other::, last'
  ta.value = [...original.slice(0, 13)].map((c) => c + '\u0336').join('') + original.slice(13)
  ta.setSelectionRange(ta.value.length, ta.value.length)
  applyPromptTagToggle(ta, ta.value, 0, 26, vi.fn())
  expect(ta.value).toBe(original)
  expect(ta.selectionStart).toBe(original.length)
  expect(ta.dataset.promptTagEdit).toBeUndefined()
})

import { promptTagChange } from '@shared/prompt-tags'
import { flushSync } from 'react-dom'

export function applyPromptTagToggle(
  ta: HTMLTextAreaElement,
  value: string,
  start: number,
  end: number,
  onValueChange: (value: string) => void
): void {
  const { value: next, mapPosition: map } = promptTagChange(value, start, end)
  let first = 0,
    oldTail = value.length,
    newTail = next.length
  while (first < oldTail && first < newTail && value[first] === next[first]) first++
  while (oldTail > first && newTail > first && value[oldTail - 1] === next[newTail - 1]) {
    oldTail--
    newTail--
  }
  const editStart = Math.min(start, first),
    editEnd = Math.max(end, oldTail)
  const displayed = ta.hasAttribute('data-prompt-input')
  const rawReplacement = next.slice(editStart, next.length - (value.length - editEnd))
  const replacement = displayed ? rawReplacement.replaceAll('\u0336', '\u2060') : rawReplacement
  const oldStart = ta.selectionStart,
    oldEnd = ta.selectionEnd,
    direction = ta.selectionDirection
  const scrollTop = ta.scrollTop,
    scrollLeft = ta.scrollLeft
  ta.focus({ preventScroll: true })
  ta.setSelectionRange(editStart, editEnd)
  // Chromium inserts this into the textarea's native undo history (including Ctrl+Z).
  ta.dataset.promptTagEdit = 'true'
  try {
    const inserted =
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, replacement)
    if (!inserted) ta.setRangeText(replacement, editStart, editEnd, 'end')
    flushSync(() => onValueChange(displayed ? ta.value.replaceAll('\u2060', '\u0336') : ta.value))
    ta.setSelectionRange(map(oldStart), map(oldEnd), direction)
    ta.scrollTop = scrollTop
    ta.scrollLeft = scrollLeft
    // Synchronize all presentation mirrors before the browser paints this edit.
    ta.dispatchEvent(new Event('scroll'))
  } finally {
    delete ta.dataset.promptTagEdit
  }
}

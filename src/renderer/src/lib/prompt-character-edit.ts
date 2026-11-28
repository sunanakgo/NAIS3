import { caretCoords } from './caret'

const markers = /[\u0336\u2060]/
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
interface Unit {
  start: number
  end: number
  marked: boolean
}

/** Group stored/display markers with their visible grapheme (including emoji and Jamo). */
function units(value: string): Unit[] {
  let visible = ''
  const positions: number[] = []
  for (let i = 0; i < value.length; i++)
    if (!markers.test(value[i])) {
      positions.push(i)
      visible += value[i]
    }
  const result: Unit[] = []
  for (const part of graphemes.segment(visible)) {
    const start = positions[part.index]
    const end = positions[part.index + part.segment.length] ?? value.length
    result.push({ start, end, marked: markers.test(value.slice(start, end)) })
  }
  return result
}

export function promptDeletionRange(
  value: string,
  start: number,
  end: number,
  backward: boolean
): { start: number; end: number } | null {
  const characters = units(value)
  const selected =
    start === end
      ? [
          backward
            ? characters.findLast((unit) => unit.start < start)
            : characters.find((unit) => unit.end > end)
        ].filter((unit): unit is Unit => !!unit)
      : characters.filter((unit) => unit.start < end && unit.end > start)
  if (!selected.some((unit) => unit.marked)) return null
  return { start: selected[0].start, end: selected[selected.length - 1].end }
}

export function promptArrowSelection(
  value: string,
  start: number,
  end: number,
  direction: string,
  right: boolean,
  shift: boolean
): { start: number; end: number; direction: 'forward' | 'backward' } | null {
  const characters = units(value)
  const head = direction === 'backward' ? start : end
  const anchor = direction === 'backward' ? end : start
  if (!shift && start !== end) {
    if (!characters.some((unit) => unit.marked && unit.start < end && unit.end > start)) return null
    const position = right ? end : start
    const unit = characters.find((unit) => unit.start < position && unit.end > position)
    const next = unit ? (right ? unit.end : unit.start) : position
    return { start: next, end: next, direction: 'forward' }
  }
  const unit = right
    ? characters.find((unit) => unit.end > head)
    : characters.findLast((unit) => unit.start < head)
  if (!unit?.marked) return null
  const next = right ? unit.end : unit.start
  return shift
    ? {
        start: Math.min(anchor, next),
        end: Math.max(anchor, next),
        direction: next < anchor ? 'backward' : 'forward'
      }
    : { start: next, end: next, direction: 'forward' }
}

/** Let Chromium perform deletion itself, retaining its native input/undo pipeline. */
export function installPromptCharacterEditing(textarea: HTMLTextAreaElement): () => void {
  const beforeInput = (event: InputEvent): void => {
    if (
      event.isComposing ||
      event.defaultPrevented ||
      !['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)
    )
      return
    const range = promptDeletionRange(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      event.inputType === 'deleteContentBackward'
    )
    if (range) textarea.setSelectionRange(range.start, range.end)
  }
  const keydown = (event: KeyboardEvent): void => {
    if (
      event.isComposing ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      !['ArrowLeft', 'ArrowRight'].includes(event.key)
    )
      return
    const selection = promptArrowSelection(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      textarea.selectionDirection,
      event.key === 'ArrowRight',
      event.shiftKey
    )
    if (!selection) return
    event.preventDefault()
    textarea.setSelectionRange(selection.start, selection.end, selection.direction)
    const caret = caretCoords(
      textarea,
      selection.direction === 'backward' ? selection.start : selection.end
    )
    const previousTop = textarea.scrollTop
    if (caret.top < textarea.scrollTop) textarea.scrollTop = caret.top
    else if (caret.top + caret.height > textarea.scrollTop + textarea.clientHeight)
      textarea.scrollTop = caret.top + caret.height - textarea.clientHeight
    if (textarea.scrollTop !== previousTop) textarea.dispatchEvent(new Event('scroll'))
  }
  textarea.addEventListener('beforeinput', beforeInput)
  textarea.addEventListener('keydown', keydown)
  return () => {
    textarea.removeEventListener('beforeinput', beforeInput)
    textarea.removeEventListener('keydown', keydown)
  }
}

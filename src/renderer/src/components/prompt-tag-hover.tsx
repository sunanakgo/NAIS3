import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { analyzePromptTags } from '@shared/prompt-tags'
import { flushSync } from 'react-dom'
import { useT } from '../lib/i18n'
import { applyPromptTagToggle } from '../lib/prompt-tag-edit'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem
} from './ui/context-menu'

function syncScroll(mirror: HTMLDivElement | null, textarea: HTMLTextAreaElement | null): void {
  if (!mirror || !textarea) return
  mirror.scrollTop = textarea.scrollTop
  mirror.scrollLeft = textarea.scrollLeft
}

export function PromptTagHover({
  value,
  onValueChange,
  textarea,
  typography,
  onToggleStart,
  children
}: {
  value: string
  onValueChange: (value: string) => void
  textarea: RefObject<HTMLTextAreaElement | null>
  typography: string
  onToggleStart?: () => void
  children?: ReactNode
}): React.JSX.Element {
  const t = useT()
  const mirror = useRef<HTMLDivElement>(null)
  const selectionMirror = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [selectionFocused, setSelectionFocused] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ start: number; end: number; disabled: boolean } | null>(null)
  const open = useRef(false)
  const pendingToggle = useRef<typeof menu>(null)
  const analysis = useMemo(() => analyzePromptTags(value), [value])
  const comments = useMemo(
    () =>
      [...value.matchAll(/^[ \t]*#[^\r\n]*/gm)].map((m) => ({
        start: m.index!,
        end: m.index! + m[0].length
      })),
    [value]
  )
  const display = (text: string): string => text.replaceAll('\u0336', '\u2060')
  useLayoutEffect(() => {
    syncScroll(mirror.current, textarea.current)
    syncScroll(selectionMirror.current, textarea.current)
  }, [textarea, value, selection])
  useEffect(() => {
    const ta = textarea.current
    if (!ta) return
    const sync = (): void => {
      syncScroll(mirror.current, ta)
      syncScroll(selectionMirror.current, ta)
    }
    const select = (): void =>
      setSelection((previous) =>
        previous.start === ta.selectionStart && previous.end === ta.selectionEnd
          ? previous
          : { start: ta.selectionStart, end: ta.selectionEnd }
      )
    document.addEventListener('selectionchange', select)
    ta.addEventListener('select', select)
    const focus = (): void => {
      setSelectionFocused(true)
      select()
    }
    const blur = (): void => setSelectionFocused(false)
    ta.addEventListener('focus', focus)
    ta.addEventListener('blur', blur)
    const observer = new ResizeObserver(sync)
    observer.observe(ta)
    const scroll = (): void => {
      sync()
      setHover(null)
    }
    ta.addEventListener('scroll', scroll)
    return () => {
      observer.disconnect()
      ta.removeEventListener('scroll', scroll)
      document.removeEventListener('selectionchange', select)
      ta.removeEventListener('select', select)
      ta.removeEventListener('focus', focus)
      ta.removeEventListener('blur', blur)
    }
  }, [textarea])
  const locate = (x: number, y: number): typeof menu => {
    for (const span of mirror.current?.querySelectorAll<HTMLElement>('[data-tag-start]') ?? []) {
      if (
        Array.from(span.getClientRects()).some(
          (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
        )
      ) {
        const start = Number(span.dataset.tagStart)
        return analysis.tags.find((tag) => tag.start === start) ?? null
      }
    }
    return null
  }
  const syntax = (start: number, end: number): ReactNode => {
    const points = new Set([start, end])
    for (const group of analysis.disabledGroups) {
      for (const point of [group.start, group.openEnd, group.closeStart, group.end])
        if (point > start && point < end) points.add(point)
    }
    for (const comment of comments)
      for (const point of [comment.start, comment.end])
        if (point > start && point < end) points.add(point)
    const sorted = [...points].sort((a, b) => a - b)
    return sorted.slice(0, -1).map((point, i) => (
      <span
        key={point}
        style={
          analysis.disabledGroups.some((g) => point >= g.start && point < g.end) &&
          !comments.some((c) => point >= c.start && point < c.end)
            ? {
                color: 'var(--prompt-tag-disabled-ink)',
                background: 'var(--prompt-tag-disabled-bg)',
                boxDecorationBreak: 'clone'
              }
            : undefined
        }
      >
        {display(value.slice(point, sorted[i + 1]))}
      </span>
    ))
  }
  const selectedText = (): ReactNode => {
    const disabled = [
      ...analysis.tags.filter((t) => t.disabled).flatMap((t) => t.parts),
      ...analysis.disabledGroups
    ]
    const points = new Set([0, value.length, selection.start, selection.end])
    for (const range of disabled) {
      points.add(range.start)
      points.add(range.end)
    }
    const sorted = [...points].filter((p) => p >= 0 && p <= value.length).sort((a, b) => a - b)
    return sorted.slice(0, -1).map((start, i) => (
      <span
        key={start}
        style={
          start >= selection.start && start < selection.end
            ? {
                color: disabled.some((r) => start >= r.start && start < r.end)
                  ? 'var(--prompt-tag-disabled-ink)'
                  : 'SelectedItemText'
              }
            : undefined
        }
      >
        {display(value.slice(start, sorted[i + 1]))}
      </span>
    ))
  }
  return (
    <ContextMenu
      onOpenChange={(isOpen) => {
        open.current = isOpen
        if (!isOpen) setMenu(null)
      }}
    >
      <div
        ref={mirror}
        aria-hidden
        data-prompt-tag-mirror
        className={typography + ' pointer-events-none absolute inset-0 overflow-hidden text-ink'}
      >
        {analysis.tags.map((tag, i) => (
          <span key={tag.start}>
            {syntax(i ? analysis.tags[i - 1].end : 0, tag.start)}
            <span>
              {tag.parts.map((part, index) => (
                <span key={part.start}>
                  {syntax(index ? tag.parts[index - 1].end : tag.start, part.start)}
                  <span
                    data-tag-start={tag.start}
                    data-tag-end={tag.end}
                    style={{
                      background: tag.disabled
                        ? 'var(--prompt-tag-disabled-bg)'
                        : hover === tag.start
                          ? 'var(--prompt-tag-hover-bg)'
                          : undefined,
                      color: tag.disabled ? 'var(--prompt-tag-disabled-ink)' : undefined,
                      boxDecorationBreak: 'clone'
                    }}
                  >
                    {display(value.slice(part.start, part.end))}
                  </span>
                </span>
              ))}
            </span>
          </span>
        ))}
        {syntax(
          analysis.tags.length ? analysis.tags[analysis.tags.length - 1].end : 0,
          value.length
        )}
        {value.endsWith('\n') && '\u200b'}
      </div>
      {selectionFocused && selection.end > selection.start && (
        <div
          ref={selectionMirror}
          aria-hidden
          data-prompt-selection-mirror
          className={
            typography +
            ' pointer-events-none absolute inset-0 z-[2] overflow-hidden text-transparent'
          }
        >
          {selectedText()}
          {value.endsWith('\n') && '\u200b'}
        </div>
      )}
      <ContextMenuTrigger asChild disabled={hover === null && menu === null}>
        <div
          className="contents"
          onMouseMove={(event) => {
            if (open.current) return
            const next = locate(event.clientX, event.clientY)?.start ?? null
            setHover((current) => (current === next ? current : next))
          }}
          onMouseLeave={() => {
            if (!open.current) setHover(null)
          }}
          onContextMenuCapture={(event) => {
            const target =
              event.clientX === 0 && event.clientY === 0
                ? (analysis.tags.find(
                    (tag) =>
                      textarea.current &&
                      tag.start <= textarea.current.selectionStart &&
                      tag.end >= textarea.current.selectionStart
                  ) ?? null)
                : locate(event.clientX, event.clientY)
            flushSync(() => {
              setMenu(target)
              setHover(target?.start ?? null)
            })
          }}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      {menu && (
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            requestAnimationFrame(() => {
              const ta = textarea.current
              const target = pendingToggle.current
              pendingToggle.current = null
              if (!ta) return
              ta.focus({ preventScroll: true })
              if (target) applyPromptTagToggle(ta, value, target.start, target.end, onValueChange)
            })
          }}
        >
          <ContextMenuItem
            onSelect={() => {
              onToggleStart?.()
              pendingToggle.current = menu
            }}
          >
            {t(menu.disabled ? 'ui.enablePromptTag' : 'ui.disablePromptTag')}
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}

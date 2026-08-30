import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'

/**
 * 예약 수 배지 — 클릭하면 입력창으로 바뀌어 수량을 직접 적을 수 있다 (+/- 연타 대체).
 * Enter/포커스 아웃 = 적용, Esc = 취소. 배지 모양(색·크기)은 호출부가 className/style로 준다.
 */
export function ReserveCount({
  value,
  className,
  style,
  title,
  inputClassName,
  onCommit
}: {
  value: number
  className?: string
  style?: React.CSSProperties
  title?: string
  /** 입력 상태에서만 쓰는 추가 클래스 (카드처럼 어두운 배경 위에선 글자색이 달라야 함) */
  inputClassName?: string
  onCommit: (count: number) => void
}): React.JSX.Element {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit(): void {
    setEditing(false)
    const n = Number(draft.trim())
    if (draft.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={cn(
          'w-10 rounded-full bg-paper px-1 text-center font-mono text-[12px] text-ink outline-none ring-1 ring-accent',
          inputClassName
        )}
        value={draft}
        inputMode="numeric"
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={commit}
      />
    )
  }

  return (
    <button
      className={cn('cursor-text', className)}
      style={style}
      title={title ? t('ui.valueClickToTypeAValue', title) : t('ui.clickToTypeAValue')}
      onClick={(e) => {
        e.stopPropagation()
        setDraft(String(value))
        setEditing(true)
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {value}
    </button>
  )
}

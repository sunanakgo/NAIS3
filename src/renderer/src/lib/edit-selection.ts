import { useEffect } from 'react'

/**
 * 편집 모드 다중 선택 (씬 카드 편집과 동일):
 * - 클릭 = 추가/해제 토글
 * - Shift+클릭 = 앵커(마지막 클릭)부터 구간 전체 선택
 * - Ctrl/Cmd+A = 전체 선택 (useSelectAllShortcut)
 */
export function applyClickSelection(
  prev: Set<number>,
  visibleIds: number[],
  id: number,
  e: { shiftKey: boolean },
  anchor: { current: number | null }
): Set<number> {
  if (e.shiftKey && anchor.current != null) {
    const from = visibleIds.indexOf(anchor.current)
    const to = visibleIds.indexOf(id)
    if (from !== -1 && to !== -1) {
      const next = new Set(prev)
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(visibleIds[i])
      return next // 앵커 유지 — 연속 쉬프트 클릭이 같은 기준점에서 범위를 다시 잡는다
    }
  }
  const next = new Set(prev)
  next.has(id) ? next.delete(id) : next.add(id)
  anchor.current = id
  return next
}

/** Ctrl/Cmd+A 전체 선택 — 입력 필드에 포커스가 있으면 무시 */
export function useSelectAllShortcut(active: boolean, onSelectAll: () => void): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      onSelectAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onSelectAll])
}

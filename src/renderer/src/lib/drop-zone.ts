import { useEffect } from 'react'

/**
 * 드롭존 dragOver 상태의 안전한 해제.
 * - dragleave는 자식 위를 지나도 발생하므로, relatedTarget이 컨테이너 밖일 때만 해제해야 한다
 * - ESC 취소·다른 곳 드롭은 dragleave가 안 올 수 있어 window dragend/drop에서도 해제한다
 */
export function isLeavingDropZone(e: React.DragEvent): boolean {
  return !e.currentTarget.contains(e.relatedTarget as Node | null)
}

export function useDragEndCleanup(clear: () => void): void {
  useEffect(() => {
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [clear])
}

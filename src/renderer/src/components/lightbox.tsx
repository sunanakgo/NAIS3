import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { imageUrl } from '../lib/constants'
import { addToLibrary } from '../stores/library-store'
import { ImageContextMenu } from './image-context-menu'

/** 이미지 전체 화면 뷰어 (씬 상세/히스토리 공용). filePaths 배열 + 현재 인덱스로 좌우 이동 */
export function Lightbox({
  filePaths,
  index,
  onIndex,
  onClose,
  allowLibraryAdd = true
}: {
  filePaths: string[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  /** L 단축키로 라이브러리 저장 — 라이브러리 자신의 뷰어에서는 끔 (중복 추가 방지) */
  allowLibraryAdd?: boolean
}): React.JSX.Element | null {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1))
      else if (e.key === 'ArrowRight') onIndex(Math.min(filePaths.length - 1, index + 1))
      else if (e.code === 'KeyL' && allowLibraryAdd && filePaths[index])
        void addToLibrary([filePaths[index]])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, filePaths, onIndex, onClose, allowLibraryAdd])

  // 휠로 이전/다음 — 배경 스크롤 차단을 위해 non-passive 네이티브 리스너.
  // 트랙패드 관성으로 여러 장 튀지 않게 누적 임계값 + 쿨다운 (상태는 ref로 재등록 간 유지).
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const wheelState = useRef({ accum: 0, lockUntil: 0 })
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const now = performance.now()
      const s = wheelState.current
      if (now < s.lockUntil) return
      s.accum += e.deltaY
      if (Math.abs(s.accum) < 50) return
      const dir = s.accum > 0 ? 1 : -1
      s.accum = 0
      s.lockUntil = now + 160
      onIndex(Math.min(filePaths.length - 1, Math.max(0, index + dir)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [index, filePaths.length, onIndex])

  if (index < 0 || index >= filePaths.length) return null
  const hasPrev = index > 0
  const hasNext = index < filePaths.length - 1

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      {hasPrev && (
        <button
          className="absolute left-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index - 1)
          }}
        >
          <ChevronLeft size={24} />
        </button>
      )}
      {/* 우클릭 메뉴 (저장/복사/메타데이터 등) — 확대 상태에서도 사용 가능 */}
      <ImageContextMenu filePath={filePaths[index]}>
        <img
          src={imageUrl(filePaths[index])}
          className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          alt=""
        />
      </ImageContextMenu>
      {hasNext && (
        <button
          className="absolute right-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index + 1)
          }}
        >
          <ChevronRight size={24} />
        </button>
      )}
      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 font-mono text-[12px] text-white">
        {index + 1} / {filePaths.length}
        {allowLibraryAdd && <span className="ml-2 opacity-60">휠 넘기기 · L 라이브러리 저장</span>}
      </span>
    </div>,
    document.body
  )
}

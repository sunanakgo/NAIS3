import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { useRef, type CSSProperties } from 'react'
import { cn } from '../lib/utils'

/** 드롭다운 목록용 세로 드래그 정렬 컨테이너 — onReorder에 새 id 순서 전달 */
export function SortableList<Id extends number | string>({
  ids,
  onReorder,
  children
}: {
  ids: Id[]
  onReorder: (ids: Id[]) => void
  children: React.ReactNode
}): React.JSX.Element {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const onDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.findIndex((id) => String(id) === String(active.id))
    const to = ids.findIndex((id) => String(id) === String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      // 목록 밖으로 못 끌고 나가게 — 세로만, 컨테이너 안에서만
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/**
 * 드래그 가능한 행 — 행 전체가 드래그 대상 (4px 이동해야 시작이라 클릭과 충돌 없음).
 * onTap: 드래그가 아니라 "탭"(거의 안 움직인 클릭)일 때 발화. dnd-kit가 native click을
 * 삼키는 경우가 있어, 네이티브 onClick 대신 이 콜백으로 선택을 처리한다 (B9 신뢰성).
 */
export function SortableRow({
  id,
  className,
  onTap,
  children
}: {
  id: number | string
  className?: string
  onTap?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const sortable = useSortable({ id })
  const downPos = useRef<{ x: number; y: number } | null>(null)
  const style: CSSProperties = {
    // x는 고정 — 세로 목록에서 가로로 튀어나가 가로 스크롤이 생기는 것 방지
    transform: sortable.transform ? `translate3d(0, ${sortable.transform.y}px, 0)` : undefined,
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.6 : undefined,
    zIndex: sortable.isDragging ? 10 : undefined,
    position: 'relative'
  }
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn('flex touch-none items-center', className)}
      {...sortable.attributes}
      {...sortable.listeners}
      // capture 단계에서 좌표 기록 (dnd 리스너보다 먼저, 덮어쓰지 않음)
      onPointerDownCapture={(e) => {
        downPos.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerUp={(e) => {
        const d = downPos.current
        downPos.current = null
        if (!onTap || !d || sortable.isDragging) return
        // 5px 미만 이동 = 탭. 내부 인터랙션 요소(버튼/인풋)에서 시작한 클릭은 제외
        if (Math.abs(e.clientX - d.x) > 5 || Math.abs(e.clientY - d.y) > 5) return
        if ((e.target as HTMLElement).closest('button,input,[data-no-tap]')) return
        onTap()
      }}
    >
      {children}
    </div>
  )
}

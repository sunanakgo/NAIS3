import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import type { CSSProperties } from 'react'
import { cn } from '../lib/utils'

/** 드롭다운 목록용 세로 드래그 정렬 컨테이너 — onReorder에 새 id 순서 전달 */
export function SortableList({
  ids,
  onReorder,
  children
}: {
  ids: number[]
  onReorder: (ids: number[]) => void
  children: React.ReactNode
}): React.JSX.Element {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const onDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.indexOf(Number(active.id))
    const to = ids.indexOf(Number(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/** 드래그 가능한 행 — 행 전체가 드래그 대상 (4px 이동해야 시작이라 클릭과 충돌 없음) */
export function SortableRow({
  id,
  className,
  children
}: {
  id: number
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const sortable = useSortable({ id })
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
    >
      {children}
    </div>
  )
}

import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  rectSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { ChevronDown, ChevronRight, Palette, Pencil, Plus, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type CSSProperties } from 'react'
import { FOLDER_COLORS, type ListFolder } from '@shared/types'
import { cn } from '../lib/utils'
import { DIVIDER_KEY, rowKey, type DisplayRow, type FolderListItem } from '../lib/folder-list'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/**
 * 캐릭터/조각 공용 폴더 리스트 뷰.
 * - 행 전체가 드래그 표면 (그립 없음). 펼친 카드·이름 편집 중·검색 중엔 드래그 비활성
 * - dnd 변환과 motion 높이 애니메이션을 "같은 요소"에 적용한다 —
 *   래퍼를 나누면 변환된 행이 overflow-hidden 래퍼에 클리핑되어 사라진다
 */

const EASE = [0.22, 1, 0.36, 1] as const

export interface FolderActions {
  rename: (id: number, name: string) => void
  toggleCollapse: (id: number) => void
  setColor: (id: number, color: string | null) => void
  remove: (id: number) => void
  addItem: (folderId: number) => void
}

/** dnd 변환. 리스트 모드는 y만(찌부 방지), 그리드 모드는 x·y 모두 */
function dndStyle(sortable: ReturnType<typeof useSortable>, grid: boolean): CSSProperties {
  const t = sortable.transform
  return {
    transform: t
      ? grid
        ? `translate3d(${Math.round(t.x)}px, ${Math.round(t.y)}px, 0)`
        : `translate3d(0, ${Math.round(t.y)}px, 0)`
      : undefined,
    transition: sortable.transition
  }
}

/** 그리드 모드 아이템 타일 (이미지 중심 레퍼런스용) */
function GridItem({
  id,
  disabled,
  children
}: {
  id: string
  disabled: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const sortable = useSortable({ id, disabled })
  return (
    <div
      ref={sortable.setNodeRef}
      style={dndStyle(sortable, true)}
      className={cn('touch-none', sortable.isDragging && 'z-20 opacity-70')}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      {children}
    </div>
  )
}

function FolderRow({
  folder,
  actions,
  count,
  searching
}: {
  folder: ListFolder
  actions: FolderActions
  count: number
  searching: boolean
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const sortable = useSortable({ id: `f-${folder.id}`, disabled: searching || editing })

  // 색이 지정되면 행 배경을 그 색으로 틴트 (surface-2 위에 얹음)
  const tintStyle = folder.color
    ? { backgroundColor: `color-mix(in srgb, ${folder.color} 26%, var(--surface-2))` }
    : undefined

  return (
    <div
      ref={sortable.setNodeRef}
      style={{ ...dndStyle(sortable, false), ...tintStyle }}
      className={cn(
        'group flex h-10 items-center gap-1.5 rounded-lg px-1.5',
        !folder.color && 'bg-surface-2',
        sortable.isDragging && 'relative z-20 opacity-75'
      )}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <button className="text-muted" onClick={() => actions.toggleCollapse(folder.id)}>
        {folder.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
      </button>
      {editing ? (
        <Input
          autoFocus
          className="h-7 w-0 flex-1 text-[13px]"
          defaultValue={folder.name}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            if (e.target.value.trim()) actions.rename(folder.id, e.target.value.trim())
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <button
          className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink"
          onClick={() => setEditing(true)}
          title="눌러서 이름 수정"
        >
          {folder.name}
          <span className="ml-1.5 font-mono text-[10.5px] font-normal text-faint">{count}</span>
        </button>
      )}
      {/* opacity로 숨김(display 아님) — 팝오버 열 때 트리거가 언마운트돼 앵커를 잃는 문제 방지 */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title="이 폴더에 추가"
          onClick={() => actions.addItem(folder.id)}
        >
          <Plus size={14} />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title="폴더 색상"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Palette size={13} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" onPointerDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1">
              <button
                className="grid size-6 place-items-center rounded-md border border-line text-faint hover:text-ink"
                title="색 없음"
                onClick={() => actions.setColor(folder.id, null)}
              >
                <X size={13} />
              </button>
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  className={cn(
                    'size-6 rounded-md border transition-transform hover:scale-110',
                    folder.color === c ? 'border-ink' : 'border-transparent'
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => actions.setColor(folder.id, c)}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="이름 수정" onClick={() => setEditing(true)}>
          <Pencil size={13} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 hover:text-danger"
          title="폴더 삭제 (항목은 미분류로)"
          onClick={() => actions.remove(folder.id)}
        >
          <Trash2 size={13} />
        </Button>
      </div>
    </div>
  )
}

/** 폴더 섹션 / 미분류 섹션 경계 — 드래그 불가, 드롭 대상(여기로 놓으면 미분류) */
function DividerRow(): React.JSX.Element {
  const sortable = useSortable({
    id: DIVIDER_KEY,
    disabled: { draggable: true, droppable: false }
  })
  return (
    <div
      ref={sortable.setNodeRef}
      style={dndStyle(sortable, false)}
      className="flex items-center gap-2 py-0.5"
    >
      <div className="h-px flex-1 bg-line" />
      <span className="text-[10.5px] text-faint">미분류</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  )
}

function ItemRow({
  id,
  disabled,
  indent,
  children
}: {
  id: string
  disabled: boolean
  indent: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const sortable = useSortable({ id, disabled })
  return (
    <motion.div
      ref={sortable.setNodeRef}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.16, ease: EASE }}
      style={dndStyle(sortable, false)}
      className={cn(
        'overflow-hidden',
        indent && 'ml-5',
        sortable.isDragging && 'relative z-20 opacity-75'
      )}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      {children}
    </motion.div>
  )
}

export function FolderListView<T extends FolderListItem>({
  rows,
  searching,
  expandedId,
  folderActions,
  onMove,
  renderHeader,
  renderExpanded,
  renderTile,
  columns,
  emptyText
}: {
  rows: DisplayRow<T>[]
  searching: boolean
  expandedId: number | null
  folderActions: FolderActions
  onMove: (activeKey: string, overKey: string) => void
  renderHeader?: (item: T) => React.ReactNode
  renderExpanded?: (item: T) => React.ReactNode
  /** 그리드 모드 — 지정 시 columns 그리드로 타일 렌더 (이미지 중심 레퍼런스용) */
  renderTile?: (item: T) => React.ReactNode
  columns?: number
  emptyText: string
}): React.JSX.Element {
  const grid = renderTile != null && columns != null
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  // 폴더 드래그 중엔 소속 카드를 임시로 접는다 — "따라오는지 애매한" UX 제거
  const [draggingFolderId, setDraggingFolderId] = useState<number | null>(null)

  const visible = rows.filter((r) => {
    if (r.type === 'folder' || r.type === 'divider') return true
    if (r.hidden) return false
    return draggingFolderId === null || r.item.folderId !== draggingFolderId
  })
  const counts = new Map<number, number>()
  for (const r of rows) {
    if (r.type === 'item' && r.item.folderId != null) {
      counts.set(r.item.folderId, (counts.get(r.item.folderId) ?? 0) + 1)
    }
  }

  function handleDragStart(e: DragStartEvent): void {
    const key = String(e.active.id)
    setDraggingFolderId(key.startsWith('f-') ? Number(key.slice(2)) : null)
  }

  function handleDragEnd(e: DragEndEvent): void {
    setDraggingFolderId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    onMove(String(active.id), String(over.id))
  }

  if (visible.length === 0) {
    return <p className="mt-8 text-center text-[12px] text-faint">{emptyText}</p>
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      // 그리드는 x·y 자유 이동, 리스트는 세로축 고정
      modifiers={grid ? [] : [restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragCancel={() => setDraggingFolderId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={visible.map(rowKey)}
        strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}
      >
        <div
          className={grid ? 'grid gap-1.5' : 'flex flex-col gap-1'}
          style={grid ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
        >
          <AnimatePresence initial={false}>
          {visible.map((row) =>
            row.type === 'divider' ? (
              // 폴더/미분류 경계 — 여기 아래로 드롭하면 폴더에서 빠짐
              <div key={DIVIDER_KEY} style={grid ? { gridColumn: '1 / -1' } : undefined}>
                <DividerRow />
              </div>
            ) : row.type === 'folder' ? (
              // 그리드에서 폴더 행은 전체 폭 차지
              <div key={rowKey(row)} style={grid ? { gridColumn: '1 / -1' } : undefined}>
                <FolderRow
                  folder={row.folder}
                  actions={folderActions}
                  count={counts.get(row.folder.id) ?? 0}
                  searching={searching}
                />
              </div>
            ) : grid ? (
              <GridItem key={rowKey(row)} id={rowKey(row)} disabled={searching}>
                {renderTile!(row.item)}
              </GridItem>
            ) : (
              <ItemRow
                key={rowKey(row)}
                id={rowKey(row)}
                disabled={searching || expandedId === row.item.id}
                indent={!searching && row.item.folderId != null}
              >
                {/* 카드 = paper(다크=블랙/라이트=화이트), 내부 박스는 surface-2(회색)로 한 단계 대비 */}
                <div className="rounded-lg border border-line bg-paper">
                  {renderHeader?.(row.item)}
                  <AnimatePresence initial={false}>
                    {expandedId === row.item.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: EASE }}
                        className="overflow-hidden"
                      >
                        {renderExpanded?.(row.item)}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </ItemRow>
            )
          )}
          </AnimatePresence>
        </div>
      </SortableContext>
    </DndContext>
  )
}

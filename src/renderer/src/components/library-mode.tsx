import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import {
  ArrowLeft,
  CheckSquare,
  ImagePlus,
  Layers,
  Library,
  Pencil,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Trash2,
  Ungroup,
  Upload
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LibraryImage, LibraryStack } from '@shared/types'
import { imageUrl } from '../lib/constants'
import { cn } from '../lib/utils'
import { askConfirm, askText } from '../stores/dialog-store'
import { useLibraryStore } from '../stores/library-store'
import { isLeavingDropZone, useDragEndCleanup } from '../lib/drop-zone'
import { DropOverlay } from './drop-overlay'
import { ImageContextMenu } from './image-context-menu'
import { Lightbox } from './lightbox'
import { Button } from './ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from './ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/**
 * 라이브러리 — 사용자가 직접 모아두는 큐레이션 컬렉션 (NAIS2 라이브러리 이식).
 * 씬 모드의 그리드/편집 모드/페이지네이션 패턴을 큐레이션용으로 축약.
 */

// 카드 비율은 해상도와 무관하게 고정 (씬 모드와 동일 — 혼합 해상도에서도 레이아웃 균일)
const CARD_ASPECT = { portrait: '832 / 1216', landscape: '1216 / 832', square: '1 / 1' } as const
type CardOrientation = keyof typeof CARD_ASPECT

function dndStyle(sortable: ReturnType<typeof useSortable>): CSSProperties {
  const t = sortable.transform
  return {
    transform: t ? `translate3d(${Math.round(t.x)}px, ${Math.round(t.y)}px, 0)` : undefined,
    transition: sortable.transition,
    // 드래그 중 원본은 자리만 차지 (커서는 DragOverlay 클론이 따라감)
    opacity: sortable.isDragging ? 0.35 : undefined
  }
}
export function LibraryMode(): React.JSX.Element {
  const stacks = useLibraryStore((s) => s.stacks)
  const images = useLibraryStore((s) => s.images)
  const total = useLibraryStore((s) => s.total)
  const loading = useLibraryStore((s) => s.loading)
  const loaded = useLibraryStore((s) => s.loaded)
  const currentStack = useLibraryStore((s) => s.currentStack)
  const columns = useLibraryStore((s) => s.columns)
  const cardOrientation = useLibraryStore((s) => s.cardOrientation)
  const setCardOrientation = useLibraryStore((s) => s.setCardOrientation)
  const editMode = useLibraryStore((s) => s.editMode)
  const selection = useLibraryStore((s) => s.selection)
  const load = useLibraryStore((s) => s.load)
  const openStack = useLibraryStore((s) => s.openStack)
  const setColumns = useLibraryStore((s) => s.setColumns)
  const setEditMode = useLibraryStore((s) => s.setEditMode)
  const toggleSelected = useLibraryStore((s) => s.toggleSelected)
  const rangeSelect = useLibraryStore((s) => s.rangeSelect)
  const selectAll = useLibraryStore((s) => s.selectAll)
  const clearSelection = useLibraryStore((s) => s.clearSelection)
  const importDialog = useLibraryStore((s) => s.importDialog)
  const importPaths = useLibraryStore((s) => s.importPaths)
  const importBase64 = useLibraryStore((s) => s.importBase64)
  const remove = useLibraryStore((s) => s.remove)
  const reorder = useLibraryStore((s) => s.reorder)
  const stackSelected = useLibraryStore((s) => s.stackSelected)
  const unstackSelected = useLibraryStore((s) => s.unstackSelected)
  const deleteStack = useLibraryStore((s) => s.deleteStack)
  const renameStack = useLibraryStore((s) => s.renameStack)

  const [dragOver, setDragOver] = useState(false)
  useDragEndCleanup(() => setDragOver(false))
  const [lightboxIdx, setLightboxIdx] = useState(-1)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // 드래그 재정렬 (5px 이동해야 시작 — 클릭과 구분). DragOverlay 클론 방식은 씬 그리드와 동일
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [dragImg, setDragImg] = useState<LibraryImage | null>(null)
  const onDragStart = (e: DragStartEvent): void => {
    setDragImg(images.find((i) => `img-${i.id}` === e.active.id) ?? null)
  }
  const onDragEnd = (e: DragEndEvent): void => {
    setDragImg(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const keys = images.map((i) => `img-${i.id}`)
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    void reorder(arrayMove(images, from, to).map((i) => i.id))
  }

  useEffect(() => {
    if (!loaded) void load(true)
  }, [loaded, load])

  // 무한 스크롤 — 바닥 근처 도달 시 다음 페이지 (씬 상세와 동일)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && images.length < total && !loading) void load(false)
      },
      { rootMargin: '800px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [images.length, total, loading, load])

  // ESC — 라이트박스가 열려 있으면 그쪽이 우선, 스택 안이면 루트로
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (lightboxIdx >= 0) return
      if (useLibraryStore.getState().currentStack) openStack(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIdx, openStack])

  async function confirmDelete(ids: number[]): Promise<void> {
    if (
      await askConfirm('이미지 삭제', {
        message: `${ids.length}장을 라이브러리에서 삭제합니다. 복사본 파일도 함께 지워집니다.`,
        confirmLabel: '삭제',
        danger: true
      })
    )
      void remove(ids)
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    // 히스토리 썸네일 등 내부 드래그
    const internalPath = e.dataTransfer.getData('nais/file-path')
    if (internalPath) {
      void importPaths([internalPath])
      return
    }
    // 외부 파일 — base64로 읽어 메인에 전달 (preview-pane과 동일 방식)
    const files = [...(e.dataTransfer.files ?? [])].filter((f) => f.type.startsWith('image/'))
    const read = (f: File): Promise<{ name: string; base64: string }> =>
      new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = (ev) =>
          resolve({ name: f.name, base64: (ev.target?.result as string) ?? '' })
        reader.readAsDataURL(f)
      })
    void Promise.all(files.map(read)).then((imgs) => importBase64(imgs))
  }

  const empty = loaded && !loading && images.length === 0 && stacks.length === 0 && !currentStack

  return (
    <div
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-surface transition-colors',
        dragOver ? 'border-accent' : 'border-line'
      )}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes('Files') ||
          e.dataTransfer.types.includes('nais/file-path')
        ) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (isLeavingDropZone(e)) setDragOver(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {/* 툴바 */}
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        {currentStack ? (
          <>
            <Button size="sm" variant="ghost" className="gap-1" onClick={() => openStack(null)}>
              <ArrowLeft size={15} /> 라이브러리
            </Button>
            <span className="text-[13.5px] font-semibold">{currentStack.name}</span>
            <button
              className="grid size-6 place-items-center rounded text-faint transition-colors hover:text-ink"
              title="스택 이름 변경"
              onClick={async () => {
                const name = await askText('스택 이름', currentStack.name)
                if (name) void renameStack(currentStack.id, name)
              }}
            >
              <Pencil size={12} />
            </button>
          </>
        ) : (
          <>
            <Library size={15} className="text-accent" />
            <span className="text-[13.5px] font-semibold">라이브러리</span>
          </>
        )}
        <span className="font-mono text-[11px] text-faint">{total}</span>
        <div className="flex-1" />

        {/* 카드 비율: 세로/가로/정사각 (씬 모드와 동일 순환) */}
        <IconBtn
          icon={
            cardOrientation === 'portrait' ? (
              <RectangleVertical size={16} />
            ) : cardOrientation === 'landscape' ? (
              <RectangleHorizontal size={16} />
            ) : (
              <Square size={16} />
            )
          }
          tip={
            cardOrientation === 'portrait'
              ? '세로 카드 (클릭: 가로)'
              : cardOrientation === 'landscape'
                ? '가로 카드 (클릭: 정사각)'
                : '정사각 카드 (클릭: 세로)'
          }
          onClick={() =>
            setCardOrientation(
              cardOrientation === 'portrait'
                ? 'landscape'
                : cardOrientation === 'landscape'
                  ? 'square'
                  : 'portrait'
            )
          }
        />
        {/* 열 수 (2~5) */}
        <div className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setColumns(n)}
              className={cn(
                'grid size-6 place-items-center rounded text-[11.5px] font-medium transition-colors',
                columns === n ? 'bg-paper text-ink shadow-sm' : 'text-faint hover:text-ink'
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <IconBtn
          icon={<CheckSquare size={16} />}
          tip="편집 모드 (다중 선택)"
          active={editMode}
          onClick={() => setEditMode(!editMode)}
        />
        <IconBtn
          icon={<Upload size={16} />}
          tip="이미지 추가"
          onClick={() => void importDialog()}
        />
      </div>

      {/* 그리드 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-faint">
            <ImagePlus size={44} strokeWidth={1.2} className="opacity-40" />
            <p className="text-[14px] font-medium">이미지를 추가하거나 드래그하세요</p>
            <p className="text-[12px] opacity-60">히스토리 썸네일을 끌어다 놓을 수도 있어요</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={onDragStart}
            onDragCancel={() => setDragImg(null)}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={images.map((i) => `img-${i.id}`)}
              strategy={rectSortingStrategy}
            >
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {!currentStack &&
                  stacks.map((stack) => (
                    <StackCard
                      key={`s-${stack.id}`}
                      stack={stack}
                      orientation={cardOrientation}
                      onOpen={() => openStack(stack)}
                      onRename={async () => {
                        const name = await askText('스택 이름', stack.name)
                        if (name) void renameStack(stack.id, name)
                      }}
                      onUnstack={async () => {
                        if (
                          await askConfirm('스택 해제', {
                            message: `"${stack.name}" 스택을 해제합니다. 이미지는 삭제되지 않고 미분류로 돌아갑니다.`,
                            confirmLabel: '해제'
                          })
                        )
                          void deleteStack(stack.id)
                      }}
                    />
                  ))}
                {images.map((img, i) => (
                  <ImageCard
                    key={img.id}
                    img={img}
                    orientation={cardOrientation}
                    checked={selection.has(img.id)}
                    editMode={editMode}
                    onClick={(e) =>
                      editMode
                        ? e.shiftKey
                          ? rangeSelect(img.id)
                          : toggleSelected(img.id)
                        : setLightboxIdx(i)
                    }
                    onDelete={() => void confirmDelete([img.id])}
                  />
                ))}
              </div>
            </SortableContext>
            {/* 드래그 중 커서를 따라가는 가벼운 클론 */}
            <DragOverlay dropAnimation={null}>
              {dragImg && (
                <div
                  className="overflow-hidden rounded-lg border border-accent bg-surface-2 shadow-xl"
                  style={{ aspectRatio: CARD_ASPECT[cardOrientation] }}
                >
                  <img
                    src={
                      dragImg.thumbnail
                        ? `data:image/webp;base64,${dragImg.thumbnail}`
                        : imageUrl(dragImg.filePath)
                    }
                    className="h-full w-full object-cover"
                    draggable={false}
                    alt=""
                  />
                </div>
              )}
            </DragOverlay>
            <div ref={sentinelRef} className="h-1" />
          </DndContext>
        )}
      </div>

      {/* 편집 모드 일괄 작업 바 */}
      {editMode && (
        <div className="flex items-center gap-2 border-t border-line bg-surface-2/60 px-3 py-2">
          <span className="text-[12.5px] text-muted">{selection.size}개 선택</span>
          <Button size="sm" variant="ghost" onClick={selectAll}>
            전체 선택
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            선택 해제
          </Button>
          <div className="flex-1" />
          {currentStack ? (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              disabled={selection.size === 0}
              onClick={() => void unstackSelected()}
            >
              <Ungroup size={13} /> 스택에서 빼기
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              disabled={selection.size < 2}
              onClick={async () => {
                const name = await askText('스택 이름', '', '예: 표지 후보')
                if (name) void stackSelected(name)
              }}
            >
              <Layers size={13} /> 스택 만들기
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-danger hover:text-danger"
            disabled={selection.size === 0}
            onClick={() => void confirmDelete([...selection])}
          >
            <Trash2 size={13} /> 삭제
          </Button>
        </div>
      )}

      <DropOverlay
        show={dragOver}
        icon={ImagePlus}
        label="여기 놓으면 라이브러리에 추가합니다"
        sub={currentStack ? `"${currentStack.name}" 스택에 추가` : '복사본으로 안전하게 보관'}
      />

      {lightboxIdx >= 0 && (
        <Lightbox
          filePaths={images.map((i) => i.filePath)}
          index={lightboxIdx}
          onIndex={setLightboxIdx}
          onClose={() => setLightboxIdx(-1)}
        />
      )}
    </div>
  )
}

// dnd-kit useSortable은 렌더 중 ref/listener props를 JSX에 전달하는 것이 공식 사용 패턴이다.
/* eslint-disable react-hooks/refs */
function ImageCard({
  img,
  orientation,
  checked,
  editMode,
  onClick,
  onDelete
}: {
  img: LibraryImage
  orientation: CardOrientation
  checked: boolean
  editMode: boolean
  onClick: (e: React.MouseEvent) => void
  onDelete: () => void
}): React.JSX.Element {
  const sortable = useSortable({ id: `img-${img.id}` })
  return (
    <ImageContextMenu filePath={img.filePath} onDelete={onDelete}>
      <div
        ref={sortable.setNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        className={cn(
          'group relative cursor-pointer touch-none overflow-hidden rounded-lg border bg-surface-2 transition',
          editMode && checked ? 'border-accent ring-2 ring-accent/40' : 'border-line'
        )}
        style={{ aspectRatio: CARD_ASPECT[orientation], ...dndStyle(sortable) }}
        title={img.name}
        onClick={onClick}
      >
        <img
          src={img.thumbnail ? `data:image/webp;base64,${img.thumbnail}` : imageUrl(img.filePath)}
          className="h-full w-full object-cover"
          draggable={false}
          loading="lazy"
          alt=""
        />
        {editMode && (
          <span
            className={cn(
              'absolute right-1.5 top-1.5 grid size-5 place-items-center rounded border-2 transition',
              checked ? 'border-accent bg-accent text-white' : 'border-white/80 bg-black/30'
            )}
          >
            {checked && <span className="text-[11px] leading-none">✓</span>}
          </span>
        )}
      </div>
    </ImageContextMenu>
  )
}
/* eslint-enable react-hooks/refs */

function StackCard({
  stack,
  orientation,
  onOpen,
  onRename,
  onUnstack
}: {
  stack: LibraryStack
  orientation: CardOrientation
  onOpen: () => void
  onRename: () => void
  onUnstack: () => void
}): React.JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group relative cursor-pointer overflow-hidden rounded-lg border border-line bg-surface-2 transition hover:border-muted/60"
          style={{ aspectRatio: CARD_ASPECT[orientation] }}
          onClick={onOpen}
        >
          {/* 스택 느낌 — 뒤에 살짝 어긋난 레이어 */}
          <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-lg border border-line bg-paper" />
          <div className="absolute inset-0 overflow-hidden rounded-lg">
            {stack.coverThumbnail ? (
              <img
                src={`data:image/webp;base64,${stack.coverThumbnail}`}
                className="h-full w-full object-cover"
                draggable={false}
                loading="lazy"
                alt=""
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-faint">
                <Layers size={26} strokeWidth={1.3} />
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pb-1.5 pt-6">
              <div className="flex items-end justify-between gap-1">
                <span className="truncate text-[13px] font-semibold text-white drop-shadow">
                  {stack.name}
                </span>
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  <Layers size={11} /> {stack.count}
                </span>
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onRename}>
          <Pencil size={13} /> 이름 변경
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem danger onSelect={onUnstack}>
          <Ungroup size={13} /> 스택 해제 (이미지는 유지)
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function IconBtn({
  icon,
  tip,
  active,
  onClick
}: {
  icon: React.ReactNode
  tip: string
  active?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'grid size-8 place-items-center rounded-md transition-colors',
            active ? 'bg-accent text-white' : 'text-muted hover:bg-surface-2 hover:text-fg'
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

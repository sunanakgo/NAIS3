import {
  CalendarPlus,
  CalendarX,
  ChevronDown,
  Copy,
  FileDown,
  FileUp,
  FolderArchive,
  FolderOpen,
  ImageOff,
  Loader2,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Trash2
} from 'lucide-react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Scene } from '@shared/types'
import { RESOLUTIONS, imageUrl } from '../lib/constants'
import { useGenerationStore } from '../stores/generation-store'
import { useScenesStore } from '../stores/scenes-store'
import { useResolutionsStore } from '../stores/resolutions-store'
import { askConfirm, askText } from '../stores/dialog-store'
import { toast } from '../stores/toast-store'
import { cn } from '../lib/utils'
import { ResolutionPicker } from './resolution-picker'
import { SceneDetail } from './scene-detail'
import { SortableList, SortableRow } from './sortable-list'
import { Button } from './ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from './ui/context-menu'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export function SceneMode(): React.JSX.Element {
  const scenes = useScenesStore((s) => s.scenes)
  const selectedId = useScenesStore((s) => s.selectedId)
  const loadPresets = useScenesStore((s) => s.loadPresets)

  useEffect(() => {
    void loadPresets()
  }, [loadPresets])

  const selected = scenes.find((s) => s.id === selectedId) ?? null
  if (selected) return <SceneDetail scene={selected} />
  return <SceneGrid />
}

/** NAIS2식 프리셋 드롭다운 — 현재 프리셋 표시 + 전환/추가/이름변경/삭제 */
function PresetDropdown(): React.JSX.Element {
  const presets = useScenesStore((s) => s.presets)
  const activePresetId = useScenesStore((s) => s.activePresetId)
  const setActivePreset = useScenesStore((s) => s.setActivePreset)
  const createPreset = useScenesStore((s) => s.createPreset)
  const renamePreset = useScenesStore((s) => s.renamePreset)
  const deletePreset = useScenesStore((s) => s.deletePreset)
  const reorderPresets = useScenesStore((s) => s.reorderPresets)
  const setPresetDefaultResolution = useScenesStore((s) => s.setPresetDefaultResolution)
  const [open, setOpen] = useState(false)

  const active = presets.find((p) => p.id === activePresetId)

  // 프리셋 선택 + 닫기 — 닫기를 먼저 (선택의 store 재렌더가 끼어들기 전에 확정) (B9)
  const choose = (id: number): void => {
    setOpen(false)
    void setActivePreset(id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex h-8 min-w-52 items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 text-[13px] font-medium hover:bg-surface-2">
          <span className="min-w-0 flex-1 truncate text-left">{active?.name ?? '프리셋'}</span>
          <ChevronDown size={14} className="shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
        <div className="max-h-64 overflow-y-auto overflow-x-hidden no-scrollbar">
          {/* 드래그로 순서 변경 */}
          <SortableList
            ids={presets.map((p) => p.id)}
            onReorder={(ids) => void reorderPresets(ids)}
          >
            {presets.map((p) => (
              <SortableRow key={p.id} id={p.id} className="group gap-1" onTap={() => choose(p.id)}>
                <div
                  onClick={() => choose(p.id)}
                  className={cn(
                    'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                    p.id === activePresetId && 'font-semibold text-accent'
                  )}
                >
                  <span className="truncate">{p.name}</span>
                </div>
                <button
                  className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-fg group-hover:opacity-100"
                  onClick={async () => {
                    const name = await askText('프리셋 이름', p.name)
                    if (name) void renamePreset(p.id, name)
                  }}
                  title="이름 변경"
                >
                  <Pencil size={12} />
                </button>
                {presets.length > 1 && (
                  <button
                    className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
                    onClick={async () => {
                      if (
                        await askConfirm('프리셋 삭제', {
                          message: `"${p.name}" 프리셋과 그 안의 씬을 모두 삭제합니다.`,
                          confirmLabel: '삭제',
                          danger: true
                        })
                      )
                        void deletePreset(p.id)
                    }}
                    title="삭제"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </SortableRow>
            ))}
          </SortableList>
        </div>
        <div className="my-1 h-px bg-line" />
        {/* 활성 프리셋의 새 씬 기본 해상도 (N3) */}
        {active && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-muted">
            <span className="shrink-0">새 씬 기본 해상도</span>
            <div className="flex-1" />
            <ResolutionPicker
              className="w-40"
              width={active.defaultWidth ?? 832}
              height={active.defaultHeight ?? 1216}
              onPick={(w, h) => void setPresetDefaultResolution(active.id, w, h)}
            />
          </div>
        )}
        <div className="my-1 h-px bg-line" />
        <button
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-accent hover:bg-surface-2"
          onClick={async () => {
            const name = await askText('새 프리셋 이름', '새 프리셋')
            if (name) void createPreset(name)
          }}
        >
          <Plus size={14} /> 새 프리셋
        </button>
      </PopoverContent>
    </Popover>
  )
}

/** 아이콘 버튼 + 툴팁 */
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

// 씬 그리드 스크롤 위치 — 다른 페이지/씬 상세를 다녀와도 위치 복원 (언마운트돼도 유지)
let savedGridScroll = 0

function SceneGrid(): React.JSX.Element {
  const scenes = useScenesStore((s) => s.scenes)
  const activePresetId = useScenesStore((s) => s.activePresetId)
  const create = useScenesStore((s) => s.create)
  const editMode = useScenesStore((s) => s.editMode)
  const setEditMode = useScenesStore((s) => s.setEditMode)
  const columns = useScenesStore((s) => s.columns)
  const setColumns = useScenesStore((s) => s.setColumns)
  const cardOrientation = useScenesStore((s) => s.cardOrientation)
  const setCardOrientation = useScenesStore((s) => s.setCardOrientation)
  const adjustReserveAll = useScenesStore((s) => s.adjustReserveAll)
  const clearReserveAll = useScenesStore((s) => s.clearReserveAll)
  const reorder = useScenesStore((s) => s.reorder)

  // 스크롤 위치 복원 — 마운트 직후 + 씬 목록이 늦게 로드된 경우 한 번 더
  const scrollRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = savedGridScroll
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (el && savedGridScroll > 0 && el.scrollTop === 0) el.scrollTop = savedGridScroll
  }, [scenes.length])

  // 드래그 재정렬 (5px 이동해야 시작 — 클릭과 구분).
  // DragOverlay 사용: 드래그 중엔 가벼운 클론이 커서를 따라가고 원본은 숨겨 프레임 저하 방지
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [dragScene, setDragScene] = useState<Scene | null>(null)
  const onDragStart = (e: DragStartEvent): void => {
    setDragScene(scenes.find((s) => `scene-${s.id}` === e.active.id) ?? null)
  }
  const onDragEnd = (e: DragEndEvent): void => {
    setDragScene(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = scenes.map((s) => `scene-${s.id}`)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    void reorder(arrayMove(scenes, from, to).map((s) => s.id))
  }

  // 스트리밍: 현재 생성 중인 씬과 미리보기 프레임 (해당 씬 카드에만 전달)
  const previewPng = useGenerationStore((s) => s.previewPng)
  const generatingSceneId = useGenerationStore(
    (s) => s.queue?.items.find((i) => i.state === 'generating')?.request.sceneId ?? null
  )

  async function exportJson(): Promise<void> {
    await window.nais.invoke('scenes:exportJson', { presetId: activePresetId })
  }
  async function importJson(): Promise<void> {
    const { count } = await window.nais.invoke('scenes:importJson', { presetId: activePresetId })
    if (count > 0) {
      toast(`씬 ${count}개 가져옴`, 'success')
      void useScenesStore.getState().load()
    } else {
      toast('가져올 씬이 없습니다', 'info')
    }
  }
  async function exportZip(): Promise<void> {
    await window.nais.invoke('scenes:exportZip', { presetId: activePresetId })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-surface">
      {/* 툴바 — 한 행: 프리셋 드롭다운 + 아이콘(툴팁) */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <PresetDropdown />
        <div className="mx-1 h-5 w-px bg-line" />
        <IconBtn icon={<FileDown size={16} />} tip="JSON 내보내기" onClick={exportJson} />
        <IconBtn icon={<FileUp size={16} />} tip="JSON 불러오기" onClick={importJson} />
        <IconBtn
          icon={<FolderArchive size={16} />}
          tip="ZIP 내보내기 — 씬별 즐겨찾기 전부, 없으면 최상단 1장 (이름=씬 이름)"
          onClick={() => void exportZip()}
        />
        <IconBtn
          icon={<Pencil size={16} />}
          tip="편집 모드"
          active={editMode}
          onClick={() => setEditMode(!editMode)}
        />

        <div className="flex-1" />

        <IconBtn
          icon={<CalendarPlus size={16} />}
          tip="전체 예약 +1"
          onClick={() => void adjustReserveAll(1)}
        />
        <IconBtn
          icon={<CalendarX size={16} />}
          tip="전체 예약 취소"
          onClick={() => void clearReserveAll()}
        />
        <div className="mx-1 h-5 w-px bg-line" />
        {/* 카드 비율: 세로/가로/정사각 (해상도와 무관하게 고정) */}
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
                'grid h-6 w-6 place-items-center rounded text-[12px] font-medium transition-colors',
                columns === n ? 'bg-paper text-ink shadow-sm' : 'text-muted hover:text-ink'
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {editMode && (
          <motion.div
            key="bulkbar"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <BulkBar />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 카드 그리드 (열 수만큼 폭에 꽉 차게). scrollbar-gutter로 스크롤바 등장 시 밀림 방지 */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          savedGridScroll = e.currentTarget.scrollTop
        }}
        className="min-h-0 flex-1 overflow-y-auto p-3 no-scrollbar"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragCancel={() => setDragScene(null)}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={scenes.map((s) => `scene-${s.id}`)}
            strategy={rectSortingStrategy}
          >
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {scenes.map((scene) => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  live={scene.id === generatingSceneId ? previewPng : null}
                  generating={scene.id === generatingSceneId}
                />
              ))}
              <button
                onClick={() => void create('새 씬')}
                className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-faint transition hover:text-accent"
                style={{ aspectRatio: CARD_ASPECT[cardOrientation] }}
              >
                <Plus size={22} />
                <span className="text-[12px]">씬 추가</span>
              </button>
            </div>
          </SortableContext>
          {/* 드래그 중 커서를 따라가는 가벼운 클론 (원본은 숨김) */}
          <DragOverlay dropAnimation={null}>
            {dragScene && (
              <div
                className="relative overflow-hidden rounded-lg border border-accent bg-surface-2 shadow-2xl"
                style={{ aspectRatio: CARD_ASPECT[cardOrientation] }}
              >
                {dragScene.thumbnail ? (
                  <img
                    src={`data:image/webp;base64,${dragScene.thumbnail}`}
                    className="h-full w-full object-cover"
                    draggable={false}
                    alt=""
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-paper text-faint">
                    <ImageOff size={26} strokeWidth={1.3} />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
                  <div className="truncate text-[13px] font-semibold text-white drop-shadow">
                    {dragScene.name}
                  </div>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
        {scenes.length === 0 && (
          <p className="mt-6 text-center text-[13px] text-faint">
            씬을 추가해 프롬프트와 해상도를 저장하고, +로 예약한 뒤 좌측 생성 버튼으로 뽑으세요.
          </p>
        )}
      </div>
    </div>
  )
}

/** 편집 모드 일괄 작업 바 */
function BulkBar(): React.JSX.Element {
  const selection = useScenesStore((s) => s.selection)
  const presets = useScenesStore((s) => s.presets)
  const activePresetId = useScenesStore((s) => s.activePresetId)
  const selectAll = useScenesStore((s) => s.selectAll)
  const clearSelection = useScenesStore((s) => s.clearSelection)
  const bulkMove = useScenesStore((s) => s.bulkMove)
  const bulkDelete = useScenesStore((s) => s.bulkDelete)
  const bulkSetResolution = useScenesStore((s) => s.bulkSetResolution)
  const customResolutions = useResolutionsStore((s) => s.custom)
  const bulkClearFavorites = useScenesStore((s) => s.bulkClearFavorites)
  const bulkClearImages = useScenesStore((s) => s.bulkClearImages)
  const bulkExportZip = useScenesStore((s) => s.bulkExportZip)

  const n = selection.size
  const disabled = n === 0

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-2 text-[13px]">
      <span className="font-medium text-fg">{n}개 선택</span>
      <Button size="sm" variant="ghost" onClick={selectAll}>
        전체 선택
      </Button>
      <Button size="sm" variant="ghost" onClick={clearSelection} disabled={disabled}>
        해제
      </Button>
      <div className="mx-1 h-4 w-px bg-line" />

      {/* 프리셋 이동 */}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" disabled={disabled}>
            프리셋 이동
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1">
          {presets
            .filter((p) => p.id !== activePresetId)
            .map((p) => (
              <MenuItem key={p.id} label={p.name} onClick={() => void bulkMove(p.id)} />
            ))}
          {presets.filter((p) => p.id !== activePresetId).length === 0 && (
            <p className="px-2 py-1.5 text-[12px] text-faint">다른 프리셋 없음</p>
          )}
        </PopoverContent>
      </Popover>

      {/* 해상도 일괄 (기본 + 커스텀) */}
      <Select
        onValueChange={(v) => {
          const [w, h] = v.split('x').map(Number)
          if (w && h) void bulkSetResolution(w, h)
        }}
      >
        <SelectTrigger className="h-8 w-40" disabled={disabled}>
          <SelectValue placeholder="해상도 변경" />
        </SelectTrigger>
        <SelectContent>
          {[...RESOLUTIONS, ...customResolutions].map((r) => (
            <SelectItem key={r.label} value={`${r.width}x${r.height}`}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void bulkExportZip()}>
        <FolderArchive size={13} /> ZIP
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => void bulkClearFavorites()}
      >
        즐겨찾기 해제
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={async () => {
          if (
            await askConfirm('이미지 비우기', {
              message: `선택한 ${n}개 씬의 생성 이미지를 모두 삭제합니다. 되돌릴 수 없습니다.`,
              confirmLabel: '비우기',
              danger: true
            })
          )
            void bulkClearImages()
        }}
      >
        이미지 비우기
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger"
        disabled={disabled}
        onClick={async () => {
          if (
            await askConfirm('씬 삭제', {
              message: `선택한 ${n}개 씬을 삭제합니다.`,
              confirmLabel: '삭제',
              danger: true
            })
          )
            void bulkDelete()
        }}
      >
        <Trash2 size={13} /> 삭제
      </Button>
    </div>
  )
}

// 카드 비율은 해상도와 무관하게 고정 (혼합 해상도에서도 레이아웃 균일)
const CARD_ASPECT = { portrait: '832 / 1216', landscape: '1216 / 832', square: '1 / 1' } as const

function dndStyle(sortable: ReturnType<typeof useSortable>): CSSProperties {
  const t = sortable.transform
  return {
    // 드래그되는 원본은 숨긴다 — 실제 이동은 DragOverlay 클론이 담당 (프레임 저하 방지)
    transform: t ? `translate3d(${Math.round(t.x)}px, ${Math.round(t.y)}px, 0)` : undefined,
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0 : undefined
  }
}

// dnd-kit useSortable은 렌더 중 ref/listener props를 JSX에 전달하는 것이 공식 사용 패턴이다.
/* eslint-disable react-hooks/refs */
const SceneCard = memo(function SceneCard({
  scene,
  live,
  generating
}: {
  scene: Scene
  live: string | null
  generating: boolean
}): React.JSX.Element {
  const editMode = useScenesStore((s) => s.editMode)
  const cardOrientation = useScenesStore((s) => s.cardOrientation)
  const selection = useScenesStore((s) => s.selection)
  const toggleSelected = useScenesStore((s) => s.toggleSelected)
  const rangeSelect = useScenesStore((s) => s.rangeSelect)
  const select = useScenesStore((s) => s.select)
  const update = useScenesStore((s) => s.update)
  const duplicate = useScenesStore((s) => s.duplicate)
  const remove = useScenesStore((s) => s.remove)
  const adjustReserve = useScenesStore((s) => s.adjustReserve)
  const sortable = useSortable({ id: `scene-${scene.id}` })

  const checked = selection.has(scene.id)
  // 이미지 우선순위: 생성 중 스트리밍 > 저장 썸네일(가벼움, 드래그 렉 방지) > 원본 > 없음.
  // 카드는 작게 표시되므로 640 webp 썸네일이면 충분히 선명하고, 풀해상도 대신 써서 드래그가 부드럽다.
  const src = live
    ? `data:image/png;base64,${live}`
    : scene.thumbnail
      ? `data:image/webp;base64,${scene.thumbnail}`
      : scene.thumbnailPath
        ? imageUrl(scene.thumbnailPath)
        : null

  // 우클릭 메뉴/3-dot 공용 액션
  const renameScene = async (): Promise<void> => {
    const name = await askText('씬 이름', scene.name)
    if (name) void update(scene.id, { name })
  }
  const openFolder = async (): Promise<void> => {
    const { ok } = await window.nais.invoke('scenes:openFolder', { sceneId: scene.id })
    if (!ok) toast('아직 생성된 이미지 폴더가 없습니다', 'info')
  }
  const removeScene = async (): Promise<void> => {
    if (
      await askConfirm('씬 삭제', {
        message: `"${scene.name}" 씬을 삭제합니다.`,
        confirmLabel: '삭제',
        danger: true
      })
    )
      void remove(scene.id)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={sortable.setNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          className={cn(
            'group relative touch-none overflow-hidden rounded-lg border bg-surface-2 transition',
            editMode && checked ? 'border-accent ring-2 ring-accent/40' : 'border-line',
            sortable.isDragging && 'shadow-xl'
          )}
          style={{ aspectRatio: CARD_ASPECT[cardOrientation], ...dndStyle(sortable) }}
          onClick={(e) =>
            editMode
              ? e.shiftKey
                ? rangeSelect(scene.id)
                : toggleSelected(scene.id)
              : select(scene.id)
          }
        >
          {/* 배경 이미지 (생성 중이면 스트리밍 프리뷰) */}
          {src ? (
            <img
              src={src}
              className="h-full w-full cursor-pointer object-cover"
              draggable={false}
              alt=""
            />
          ) : (
            <div className="flex h-full w-full cursor-pointer items-center justify-center bg-paper text-faint">
              <ImageOff size={26} strokeWidth={1.3} />
            </div>
          )}

          {/* 생성 준비 중(프리뷰 뜨기 전) 스피너 */}
          {generating && !live && (
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <Loader2 size={28} className="animate-spin text-white" strokeWidth={2} />
            </div>
          )}

          {/* 예약 수 — 좌측 상단 붉은 원 */}
          {scene.reserveCount > 0 && (
            <span className="absolute left-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-danger px-1.5 text-[12px] font-bold text-white shadow">
              {scene.reserveCount}
            </span>
          )}

          {/* 우측 상단 — 편집 모드 체크박스 / 일반 3점 메뉴 */}
          {editMode ? (
            <span
              className={cn(
                'absolute right-1.5 top-1.5 grid size-5 place-items-center rounded border-2 transition',
                checked ? 'border-accent bg-accent text-white' : 'border-white/80 bg-black/30'
              )}
            >
              {checked && <span className="text-[11px] leading-none">✓</span>}
            </span>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/55 text-white opacity-0 transition hover:bg-black/70 group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <MoreVertical size={14} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-40 p-1" onClick={(e) => e.stopPropagation()}>
                <MenuItem
                  icon={<Pencil size={13} />}
                  label="이름 변경"
                  onClick={() => void renameScene()}
                />
                <MenuItem
                  icon={<Copy size={13} />}
                  label="복제"
                  onClick={() => void duplicate(scene.id)}
                />
                <MenuItem
                  icon={<FolderOpen size={13} />}
                  label="폴더 열기"
                  onClick={() => void openFolder()}
                />
                <MenuItem
                  icon={<Trash2 size={13} />}
                  label="삭제"
                  danger
                  onClick={() => void removeScene()}
                />
              </PopoverContent>
            </Popover>
          )}

          {/* 하단 그라디언트 + 이름 + 예약 +/- */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pb-1.5 pt-6">
            <div className="pointer-events-auto flex items-end justify-between gap-1">
              <div className="min-w-0">
                {editMode ? (
                  <input
                    className="w-full truncate rounded bg-white/15 px-1 py-0.5 text-[13px] font-medium text-white outline-none placeholder:text-white/50 focus:bg-white/25"
                    value={scene.name}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => void update(scene.id, { name: e.target.value })}
                  />
                ) : (
                  <div className="truncate text-[13px] font-semibold text-white drop-shadow">
                    {scene.name}
                  </div>
                )}
              </div>
              {/* 예약 +/- */}
              <div
                className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/55 p-0.5"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  className="grid size-5 place-items-center rounded-full text-white hover:bg-white/20 disabled:opacity-30"
                  disabled={scene.reserveCount === 0}
                  onClick={() => void adjustReserve(scene.id, -1)}
                >
                  <Minus size={13} />
                </button>
                <span className="min-w-4 text-center text-[12px] font-medium text-white">
                  {scene.reserveCount}
                </span>
                <button
                  className="grid size-5 place-items-center rounded-full text-white hover:bg-white/20"
                  onClick={() => void adjustReserve(scene.id, 1)}
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void renameScene()}>
          <Pencil size={13} /> 이름 변경
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void duplicate(scene.id)}>
          <Copy size={13} /> 복제
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void openFolder()}>
          <FolderOpen size={13} className="text-amber-400" /> 폴더 열기
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem danger onSelect={() => void removeScene()}>
          <Trash2 size={13} /> 삭제
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
/* eslint-enable react-hooks/refs */

function MenuItem({
  icon,
  label,
  onClick,
  danger
}: {
  icon?: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
        danger && 'text-danger'
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

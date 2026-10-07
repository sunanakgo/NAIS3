import { Grid3X3, Maximize2, Move, UsersRound } from 'lucide-react'
import { useRef, useState } from 'react'
import type { MessageId } from '@shared/i18n'
import type { CharacterCard } from '@shared/types'
import {
  guideStops,
  nudgePosition,
  pointToNormalizedPosition,
  positionPercent,
  type GuideMode,
  type PositionGuideSettings
} from '../lib/character-position'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

const GUIDE_OPTIONS: { value: GuideMode; label: MessageId }[] = [
  { value: 'none', label: 'ui.positionGuideNone' },
  { value: 'thirds', label: 'ui.positionGuideThirds' },
  { value: 'phi', label: 'ui.positionGuideGoldenRatio' },
  { value: 'grid', label: 'ui.positionGuideGrid' }
]

interface CharacterPositionCanvasProps {
  characters: CharacterCard[]
  width: number
  height: number
  guides: PositionGuideSettings
  /** 캔버스 긴 변이 넘지 않을 최대 높이 (CSS 길이) */
  maxHeight: string
  compact?: boolean
  /** 캔버스 밖(목록 등)에서 가리킨 캐릭터 — 마커를 강조한다 */
  highlightId?: number | null
  onPosition: (id: number, center: { x: number; y: number }) => void
}

/** 마커에 커서를 올려 바로 끌어 옮기는 출력 비율 캔버스 — 사이드바/확대 창 공용 */
export function CharacterPositionCanvas({
  characters,
  width,
  height,
  guides,
  maxHeight,
  compact = false,
  highlightId = null,
  onPosition
}: CharacterPositionCanvasProps): React.JSX.Element {
  const t = useT()
  const canvasRef = useRef<HTMLDivElement>(null)
  // 잡은 지점과 마커 중심의 차이 — 끌기 시작할 때 마커가 커서로 튀지 않게
  const dragRef = useRef<{ id: number; pointerId: number; dx: number; dy: number } | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [lastId, setLastId] = useState<number | null>(null)
  const [vertical, horizontal] = guideStops(guides)
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)

  const canvasRect = (): DOMRect | null => canvasRef.current?.getBoundingClientRect() ?? null

  const moveTo = (id: number, clientX: number, clientY: number): void => {
    const rect = canvasRect()
    if (!rect) return
    onPosition(
      id,
      pointToNormalizedPosition(clientX, clientY, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      })
    )
  }

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDraggingId(null)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={canvasRef}
      role="group"
      aria-label={t('ui.characterPositionCanvas')}
      className={cn(
        'relative shrink-0 touch-none select-none overflow-hidden rounded-md border border-line bg-paper',
        // 확대 창에서는 점 격자 위에 뜬 아트보드처럼 보이게
        compact ? 'shadow-inner' : 'shadow-xl shadow-black/25'
      )}
      style={{
        width: `min(100%, calc(${maxHeight} * ${safeWidth / safeHeight}))`,
        aspectRatio: `${safeWidth} / ${safeHeight}`
      }}
    >
      <PositionGuides vertical={vertical} horizontal={horizontal} />
      {characters.map((char, index) => {
        const name = char.name || t('ui.characterValue', index + 1)
        const dragging = draggingId === char.id
        const highlighted = highlightId === char.id
        return (
          <button
            key={char.id}
            type="button"
            title={name}
            aria-label={t(
              'ui.characterPositionMarker',
              name,
              positionPercent(char.center.x),
              positionPercent(char.center.y)
            )}
            className={cn(
              'group absolute -translate-x-1/2 -translate-y-1/2 touch-none rounded-full outline-none',
              dragging || highlighted
                ? cn('z-30', dragging ? 'cursor-grabbing' : 'cursor-grab')
                : cn('cursor-grab hover:z-30', lastId === char.id ? 'z-20' : 'z-10')
            )}
            style={{ left: positionPercent(char.center.x), top: positionPercent(char.center.y) }}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return
              event.preventDefault()
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture?.(event.pointerId)
              const rect = canvasRect()
              dragRef.current = {
                id: char.id,
                pointerId: event.pointerId,
                dx: rect ? event.clientX - (rect.left + char.center.x * rect.width) : 0,
                dy: rect ? event.clientY - (rect.top + char.center.y * rect.height) : 0
              }
              setDraggingId(char.id)
              setLastId(char.id)
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (drag?.pointerId !== event.pointerId) return
              moveTo(drag.id, event.clientX - drag.dx, event.clientY - drag.dy)
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onFocus={() => setLastId(char.id)}
            onKeyDown={(event) => {
              if (!event.key.startsWith('Arrow')) return
              const key = event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
              event.preventDefault()
              onPosition(char.id, nudgePosition(char.center, key, event.shiftKey))
            }}
          >
            <span
              className={cn(
                'grid place-items-center rounded-full border font-semibold shadow-md transition-[transform,background-color,box-shadow] duration-100',
                compact ? 'size-6 text-[10.5px]' : 'size-7 text-[11px]',
                dragging || highlighted || lastId === char.id
                  ? 'border-paper bg-accent text-on-accent'
                  : 'border-line bg-surface text-muted group-hover:border-paper group-hover:bg-accent group-hover:text-on-accent',
                dragging || highlighted
                  ? 'scale-110 ring-2 ring-accent/45'
                  : 'group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-accent/60'
              )}
            >
              {index + 1}
            </span>
            {!compact && (
              <span
                className={cn(
                  'pointer-events-none absolute left-1/2 top-full mt-1 max-w-32 -translate-x-1/2 truncate rounded bg-ink/70 px-1.5 py-px text-[10.5px] text-paper transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
                  highlighted || dragging ? 'opacity-100' : 'opacity-0'
                )}
              >
                {name}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

interface CharacterPositionPanelProps {
  characters: CharacterCard[]
  width: number
  height: number
  guides: PositionGuideSettings
  onPosition: (id: number, center: { x: number; y: number }) => void
  onExpand: () => void
}

/** 사이드바 안의 작은 배치 캔버스 — 확대 버튼으로 개별 창을 연다 */
export function CharacterPositionPanel({
  characters,
  width,
  height,
  guides,
  onPosition,
  onExpand
}: CharacterPositionPanelProps): React.JSX.Element {
  const t = useT()
  return (
    <div className="relative flex shrink-0 justify-center rounded-lg bg-surface-2 p-1.5">
      <CharacterPositionCanvas
        characters={characters}
        width={width}
        height={height}
        guides={guides}
        maxHeight="200px"
        compact
        onPosition={onPosition}
      />
      <Button
        size="icon"
        variant="default"
        className="absolute right-1.5 top-1.5 size-7"
        title={t('ui.expandPositionEditor')}
        aria-label={t('ui.expandPositionEditor')}
        onClick={onExpand}
      >
        <Maximize2 size={13} />
      </Button>
    </div>
  )
}

interface CharacterPositionEditorProps {
  open: boolean
  characters: CharacterCard[]
  width: number
  height: number
  guides: PositionGuideSettings
  onGuidesChange: (guides: PositionGuideSettings) => void
  onPosition: (id: number, center: { x: number; y: number }) => void
  onClose: () => void
}

export function CharacterPositionEditor({
  open,
  characters,
  width,
  height,
  guides,
  onGuidesChange,
  onPosition,
  onClose
}: CharacterPositionEditorProps): React.JSX.Element {
  const t = useT()
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[1400px] flex-col gap-2 bg-surface-2 p-2 md:flex-row">
        {/* 좌측: 캔버스만 — 남는 공간을 전부 쓴다 */}
        {/* 디자인 툴 작업대처럼 점 격자를 깔아 캔버스 주변 여백을 채운다 */}
        <div
          className="flex min-h-0 min-w-0 flex-1 rounded-xl border border-line bg-surface p-6 shadow-sm"
          style={{
            backgroundImage: 'radial-gradient(var(--color-line) 1px, transparent 1.5px)',
            backgroundSize: '18px 18px',
            backgroundPosition: 'center'
          }}
        >
          <div
            className="flex min-h-0 min-w-0 flex-1 items-center justify-center"
            style={{ containerType: 'size' }}
          >
            {characters.length > 0 ? (
              <CharacterPositionCanvas
                characters={characters}
                width={width}
                height={height}
                guides={guides}
                maxHeight="100cqh"
                highlightId={hoveredId}
                onPosition={onPosition}
              />
            ) : (
              <p className="p-8 text-[12px] text-muted">{t('ui.noActiveCharacterPrompts')}</p>
            )}
          </div>
        </div>

        {/* 우측: 제목·안내선·캐릭터 목록·완료를 모은 사이드바 */}
        <aside className="flex max-h-[40%] w-full shrink-0 flex-col gap-4 overflow-y-auto p-2 md:max-h-none md:w-64">
          <div className="pr-8">
            <DialogTitle className="flex items-center gap-2">
              <Move size={15} /> {t('ui.v5CharacterPositionEditor')}
            </DialogTitle>
            <DialogDescription className="mt-1.5 leading-relaxed">
              {t('ui.characterPositionInstructions')}
            </DialogDescription>
          </div>

          <section className="flex flex-col gap-0.5">
            <SidebarLabel>
              <Grid3X3 size={12} /> {t('ui.positionGuides')}
            </SidebarLabel>
            {GUIDE_OPTIONS.map((option) => {
              const active = guides.mode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  className={cn(
                    'h-8 rounded-lg px-2.5 text-left text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40',
                    active
                      ? 'bg-surface font-medium text-ink shadow-sm'
                      : 'text-muted hover:bg-surface/60 hover:text-ink'
                  )}
                  onClick={() => onGuidesChange({ ...guides, mode: option.value })}
                >
                  {t(option.label)}
                </button>
              )
            })}
            {guides.mode === 'grid' && (
              <div className="mt-1 flex items-center justify-center gap-1 rounded-lg border border-line bg-surface p-0.5 font-mono text-[11px]">
                <GridSizeControl
                  label={t('ui.positionGridColumns')}
                  value={guides.columns}
                  onChange={(columns) => onGuidesChange({ ...guides, columns })}
                />
                <span className="text-faint">×</span>
                <GridSizeControl
                  label={t('ui.positionGridRows')}
                  value={guides.rows}
                  onChange={(rows) => onGuidesChange({ ...guides, rows })}
                />
              </div>
            )}
          </section>

          {characters.length > 0 && (
            <section className="flex flex-col gap-0.5">
              <SidebarLabel>
                <UsersRound size={12} /> {t('ui.character')}
              </SidebarLabel>
              {characters.map((char, index) => (
                <div
                  key={char.id}
                  className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12.5px] transition-colors hover:bg-surface/60"
                  onPointerEnter={() => setHoveredId(char.id)}
                  onPointerLeave={() => setHoveredId(null)}
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-full border border-line bg-surface font-mono text-[10px] text-muted">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {char.name || t('ui.characterValue', index + 1)}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-faint">
                    {positionPercent(char.center.x)}, {positionPercent(char.center.y)}
                  </span>
                </div>
              ))}
            </section>
          )}

          <div className="flex-1" />
          <Button variant="accent" className="w-full shrink-0" onClick={onClose}>
            {t('ui.finishPositionEditing')}
          </Button>
        </aside>
      </DialogContent>
    </Dialog>
  )
}

function SidebarLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-1 flex items-center gap-1.5 px-2.5 text-[11px] font-medium text-faint">
      {children}
    </div>
  )
}

function GridSizeControl({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex items-center gap-0.5" title={t('ui.positionGridCount', label)}>
      <button
        className="grid size-6 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-35"
        aria-label={t('ui.decreasePositionGridCount', label)}
        disabled={value <= 2}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="w-5 text-center">{value}</span>
      <button
        className="grid size-6 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-35"
        aria-label={t('ui.increasePositionGridCount', label)}
        disabled={value >= 12}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  )
}

function PositionGuides({
  vertical,
  horizontal
}: {
  vertical: number[]
  horizontal: number[]
}): React.JSX.Element | null {
  if (vertical.length === 0 && horizontal.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {vertical.map((stop) => (
        <div
          key={`x-${stop}`}
          className="absolute inset-y-0 w-px bg-ink/20"
          style={{ left: `${stop}%` }}
        />
      ))}
      {horizontal.map((stop) => (
        <div
          key={`y-${stop}`}
          className="absolute inset-x-0 h-px bg-ink/20"
          style={{ top: `${stop}%` }}
        />
      ))}
    </div>
  )
}

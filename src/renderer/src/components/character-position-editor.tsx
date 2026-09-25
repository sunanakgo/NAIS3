import { Check, Grid3X3, Move } from 'lucide-react'
import { useState } from 'react'
import type { MessageId } from '@shared/i18n'
import type { CharacterCard } from '@shared/types'
import {
  nudgePosition,
  pointToNormalizedPosition,
  positionPercent
} from '../lib/character-position'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

type GuideMode = 'none' | 'thirds' | 'phi' | 'grid'

const GUIDE_OPTIONS: { value: GuideMode; label: MessageId }[] = [
  { value: 'none', label: 'ui.positionGuideNone' },
  { value: 'thirds', label: 'ui.positionGuideThirds' },
  { value: 'phi', label: 'ui.positionGuideGoldenRatio' },
  { value: 'grid', label: 'ui.positionGuideGrid' }
]

const divisions = (count: number): number[] =>
  Array.from({ length: count - 1 }, (_, index) => ((index + 1) / count) * 100)

interface CharacterPositionEditorProps {
  open: boolean
  characters: CharacterCard[]
  selectedId: number | null
  width: number
  height: number
  onSelect: (id: number) => void
  onPosition: (id: number, center: { x: number; y: number }) => void
  onClose: () => void
}

export function CharacterPositionEditor({
  open,
  characters,
  selectedId,
  width,
  height,
  onSelect,
  onPosition,
  onClose
}: CharacterPositionEditorProps): React.JSX.Element {
  const t = useT()
  const [guide, setGuide] = useState<GuideMode>('none')
  const [gridColumns, setGridColumns] = useState(3)
  const [gridRows, setGridRows] = useState(3)
  const selected = characters.find((char) => char.id === selectedId) ?? characters[0]
  const [verticalGuides, horizontalGuides] =
    guide === 'thirds'
      ? [divisions(3), divisions(3)]
      : guide === 'phi'
        ? [
            [38.2, 61.8],
            [38.2, 61.8]
          ]
        : guide === 'grid'
          ? [divisions(gridColumns), divisions(gridRows)]
          : [[], []]
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)

  const setPositionFromPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!selected) return
    const rect = event.currentTarget.getBoundingClientRect()
    onPosition(
      selected.id,
      pointToNormalizedPosition(event.clientX, event.clientY, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      })
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-[min(900px,calc(100vw-2rem))] flex-col overflow-y-auto p-4">
        <div className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <Move size={16} /> {t('ui.v5CharacterPositionEditor')}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {t('ui.characterPositionInstructions')}
          </DialogDescription>
        </div>

        <div className="mt-3 flex max-h-28 min-h-9 shrink-0 flex-wrap items-center gap-1.5 overflow-y-auto">
          {characters.map((char, index) => {
            const active = char.id === selected?.id
            return (
              <Button
                key={char.id}
                size="sm"
                variant={active ? 'accent' : 'default'}
                className="max-w-48 gap-1.5"
                title={char.name || char.prompt}
                aria-pressed={active}
                onClick={() => onSelect(char.id)}
              >
                <span
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded-full text-[10px]',
                    active ? 'bg-paper/20' : 'bg-surface-2'
                  )}
                >
                  {index + 1}
                </span>
                <span className="truncate">{char.name || t('ui.characterValue', index + 1)}</span>
                {active && <Check size={12} />}
              </Button>
            )
          })}
        </div>

        <div className="mt-3 flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 p-2">
          {selected ? (
            <div
              role="application"
              tabIndex={0}
              aria-label={t(
                'ui.characterPositionCanvas',
                selected.name || t('ui.selectedCharacter')
              )}
              className="relative shrink-0 cursor-crosshair touch-none overflow-hidden rounded-md border border-line bg-paper shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              style={{
                width: `min(100%, ${62 * (safeWidth / safeHeight)}vh, 820px)`,
                aspectRatio: `${safeWidth} / ${safeHeight}`
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return
                event.currentTarget.focus()
                event.currentTarget.setPointerCapture(event.pointerId)
                setPositionFromPointer(event)
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  setPositionFromPointer(event)
                }
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
              }}
              onKeyDown={(event) => {
                if (!event.key.startsWith('Arrow')) return
                const key = event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
                event.preventDefault()
                onPosition(selected.id, nudgePosition(selected.center, key, event.shiftKey))
              }}
            >
              <PositionGuides vertical={verticalGuides} horizontal={horizontalGuides} />
              {characters.map((char, index) => {
                const active = char.id === selected.id
                return (
                  <div
                    key={char.id}
                    className={cn(
                      'pointer-events-none absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-[11px] font-semibold shadow-md transition-[left,top] duration-75',
                      active
                        ? 'z-20 border-paper bg-accent text-paper ring-2 ring-accent/45'
                        : 'z-10 border-line bg-surface text-muted'
                    )}
                    style={{
                      left: positionPercent(char.center.x),
                      top: positionPercent(char.center.y)
                    }}
                  >
                    {index + 1}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="p-8 text-[12px] text-muted">{t('ui.noActiveCharacterPrompts')}</p>
          )}
        </div>

        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-1.5">
          <Grid3X3 size={14} className="mr-0.5 text-muted" />
          {GUIDE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={guide === option.value ? 'accent' : 'ghost'}
              aria-pressed={guide === option.value}
              onClick={() => setGuide(option.value)}
            >
              {t(option.label)}
            </Button>
          ))}
          {guide === 'grid' && (
            <div className="ml-1 flex items-center gap-1 rounded-md border border-line bg-paper p-0.5 font-mono text-[11px]">
              <GridSizeControl
                label={t('ui.positionGridColumns')}
                value={gridColumns}
                onChange={setGridColumns}
              />
              <span className="text-faint">×</span>
              <GridSizeControl
                label={t('ui.positionGridRows')}
                value={gridRows}
                onChange={setGridRows}
              />
            </div>
          )}
          <div className="flex-1" />
          {selected && (
            <span className="font-mono text-[11px] text-muted">
              X {positionPercent(selected.center.x)} · Y {positionPercent(selected.center.y)}
            </span>
          )}
          <Button variant="accent" onClick={onClose}>
            {t('ui.finishPositionEditing')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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

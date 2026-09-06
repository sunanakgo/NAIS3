import { Maximize2, Minus, Plus } from 'lucide-react'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useImageViewport } from '../lib/image-viewport'
import { Button } from './ui/button'

export function ZoomControls({
  label,
  onZoomOut,
  onReset,
  onZoomIn,
  className
}: {
  label: string
  onZoomOut: () => void
  onReset: () => void
  onZoomIn: () => void
  className?: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-full border border-line bg-paper/85 p-1 shadow-sm backdrop-blur',
        className
      )}
    >
      <Button
        size="icon"
        variant="ghost"
        className="size-7 rounded-full"
        title={t('축소')}
        onClick={onZoomOut}
      >
        <Minus size={14} />
      </Button>
      <button
        className="min-w-12 rounded px-1 font-mono text-[11px] text-muted hover:text-ink"
        title={t('화면에 맞춤')}
        onClick={onReset}
      >
        {label}
      </button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 rounded-full"
        title={t('확대')}
        onClick={onZoomIn}
      >
        <Plus size={14} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 rounded-full"
        title={t('화면에 맞춤')}
        onClick={onReset}
      >
        <Maximize2 size={13} />
      </Button>
    </div>
  )
}

export function ZoomableImageStage({
  src,
  width,
  height,
  children,
  className
}: {
  src: string
  width: number
  height: number
  children?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const {
    viewportRef,
    frameStyle,
    zoomLabel,
    zoomIn,
    zoomOut,
    resetView,
    onWheel,
    beginPan,
    movePan,
    endPan,
    panning
  } = useImageViewport(width, height)
  return (
    <div
      ref={viewportRef}
      className={cn(
        'absolute inset-0 overflow-hidden',
        panning ? 'cursor-grabbing' : 'cursor-default',
        className
      )}
      onWheel={onWheel}
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDoubleClick={resetView}
    >
      <div className="pointer-events-none absolute will-change-transform" style={frameStyle}>
        <img src={src} className="h-full w-full select-none object-fill" draggable={false} alt="" />
      </div>
      <ZoomControls
        className="absolute right-3 top-3 z-20"
        label={zoomLabel}
        onZoomOut={zoomOut}
        onReset={resetView}
        onZoomIn={zoomIn}
      />
      {children}
    </div>
  )
}

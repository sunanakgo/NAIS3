import {
  Check,
  Circle,
  Eraser,
  Maximize2,
  PaintBucket,
  Paintbrush,
  Palette,
  Redo2,
  Scan,
  Square,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { rasterizeBrushOutline, type BrushShape, type Point } from '../lib/mask-geometry'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { useImageViewport } from '../lib/image-viewport'
import { ZoomControls } from './image-viewport'

type MaskTool = 'brush' | 'erase' | 'rectangle'
type MaskPattern = 'solid' | 'diagonal' | 'crosshatch' | 'dots' | 'grid' | 'checker'
type StrokeAction = {
  type: 'stroke'
  tool: 'brush' | 'erase'
  shape: BrushShape
  size: number
  points: Point[]
}
type MaskAction =
  | StrokeAction
  | { type: 'rectangle'; start: Point; end: Point }
  | { type: 'fill' }
  | { type: 'clear' }

const MASK_COLORS = [
  '#6862d5',
  '#f2b735',
  '#c746a8',
  '#41bcc1',
  '#e54c49',
  '#46bd5c',
  '#ad62d6',
  '#e58b32',
  '#438fd1',
  '#bfba35'
]
const MASK_PATTERNS: MaskPattern[] = ['solid', 'diagonal', 'crosshatch', 'dots', 'grid', 'checker']

export function MaskWorkspace({
  imageBase64,
  width,
  height,
  initialMaskBase64,
  onConfirm,
  onCancel,
  className
}: {
  imageBase64: string
  width: number
  height: number
  initialMaskBase64?: string
  onConfirm: (maskBase64: string) => void
  onCancel: () => void
  className?: string
}): React.JSX.Element {
  const t = useT()
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
  } = useImageViewport(width, height, 24)
  const dataCanvas = useRef<HTMLCanvasElement | null>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null)
  const initialMask = useRef<ImageData | null>(null)
  const actions = useRef<MaskAction[]>([])
  const historyIndex = useRef(0)
  const activeStroke = useRef<StrokeAction | null>(null)
  const activeRectangle = useRef<{ start: Point; end: Point } | null>(null)
  const drawingPointer = useRef<number | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [tool, setTool] = useState<MaskTool>('brush')
  const [brushSize, setBrushSize] = useState(28)
  const [brushShape, setBrushShape] = useState<BrushShape>('round')
  const [maskColor, setMaskColor] = useState(MASK_COLORS[0])
  const [maskOpacity, setMaskOpacity] = useState(50)
  const [maskBorder, setMaskBorder] = useState(true)
  const [maskPattern, setMaskPattern] = useState<MaskPattern>('solid')

  const renderDisplay = useCallback((): void => {
    const source = dataCanvas.current
    const visible = maskCanvasRef.current
    if (!source || !visible) return
    const sourceData = source.getContext('2d')!.getImageData(0, 0, width, height)
    const ctx = visible.getContext('2d')!
    const output = ctx.createImageData(width, height)
    const [red, green, blue] = hexToRgb(maskColor)
    const src = sourceData.data
    const dst = output.data

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (src[i + 3] <= 20) continue
        const edge = maskBorder && isMaskEdge(src, width, height, x, y)
        const patterned = patternAt(maskPattern, x, y)
        dst[i] = edge ? 255 : red
        dst[i + 1] = edge ? 255 : green
        dst[i + 2] = edge ? 220 : blue
        dst[i + 3] = edge ? 255 : patterned ? 255 : 62
      }
    }
    ctx.putImageData(output, 0, 0)
  }, [height, maskBorder, maskColor, maskPattern, width])

  const replayHistory = useCallback((): void => {
    const canvas = dataCanvas.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, width, height)
    if (initialMask.current) ctx.putImageData(initialMask.current, 0, 0)
    for (let i = 0; i < historyIndex.current; i++)
      applyAction(ctx, actions.current[i], width, height)
    setHistoryVersion((version) => version + 1)
  }, [height, width])

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    dataCanvas.current = canvas
    actions.current = []
    historyIndex.current = 0
    initialMask.current = null
    setHistoryVersion((version) => version + 1)

    if (!initialMaskBase64) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      const offscreen = document.createElement('canvas')
      offscreen.width = width
      offscreen.height = height
      const offscreenContext = offscreen.getContext('2d')!
      offscreenContext.drawImage(image, 0, 0, width, height)
      const source = offscreenContext.getImageData(0, 0, width, height)
      const restored = offscreenContext.createImageData(width, height)
      for (let i = 0; i < source.data.length; i += 4) {
        if (source.data[i] <= 127) continue
        restored.data[i] = 255
        restored.data[i + 1] = 255
        restored.data[i + 2] = 255
        restored.data[i + 3] = 255
      }
      initialMask.current = restored
      canvas.getContext('2d')!.putImageData(restored, 0, 0)
      setHistoryVersion((version) => version + 1)
    }
    image.src = `data:image/png;base64,${initialMaskBase64}`
    return () => {
      cancelled = true
    }
  }, [height, imageBase64, initialMaskBase64, width])

  useEffect(() => renderDisplay(), [historyVersion, renderDisplay])

  useEffect(() => {
    void Promise.all([
      window.nais.invoke('settings:get', { key: 'inpaint_brush' }),
      window.nais.invoke('settings:get', { key: 'inpaint_brush_shape' }),
      window.nais.invoke('settings:get', { key: 'inpaint_mask_color' }),
      window.nais.invoke('settings:get', { key: 'inpaint_mask_opacity' }),
      window.nais.invoke('settings:get', { key: 'inpaint_mask_pattern' }),
      window.nais.invoke('settings:get', { key: 'inpaint_mask_border' })
    ]).then(([size, shape, color, opacity, pattern, border]) => {
      if (size.value) setBrushSize(clamp(Number(size.value), 2, 512))
      if (shape.value === 'round' || shape.value === 'square') setBrushShape(shape.value)
      if (color.value && MASK_COLORS.includes(color.value)) setMaskColor(color.value)
      if (opacity.value) setMaskOpacity(clamp(Number(opacity.value), 10, 100))
      if (pattern.value && MASK_PATTERNS.includes(pattern.value as MaskPattern))
        setMaskPattern(pattern.value as MaskPattern)
      if (border.value) setMaskBorder(border.value === 'true')
    })
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyZ') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (event.code === 'KeyB') setTool('brush')
      else if (event.code === 'KeyE') setTool('erase')
      else if (event.code === 'KeyR') setTool('rectangle')
      else if (event.key === '[') setAndPersistBrush(Math.max(2, brushSize - 2))
      else if (event.key === ']') setAndPersistBrush(Math.min(512, brushSize + 2))
      else if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function persist(key: string, value: string | number | boolean): void {
    void window.nais.invoke('settings:set', { key, value: String(value) })
  }
  function setAndPersistBrush(value: number): void {
    setBrushSize(value)
    persist('inpaint_brush', value)
  }
  function pushAction(action: MaskAction): void {
    actions.current = actions.current.slice(0, historyIndex.current)
    actions.current.push(action)
    historyIndex.current = actions.current.length
    replayHistory()
  }
  function undo(): void {
    if (historyIndex.current <= 0) return
    historyIndex.current--
    replayHistory()
  }
  function redo(): void {
    if (historyIndex.current >= actions.current.length) return
    historyIndex.current++
    replayHistory()
  }
  function sourcePoint(event: ReactPointerEvent): Point {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp(Math.floor(((event.clientX - rect.left) / rect.width) * width), 0, width - 1),
      y: clamp(Math.floor(((event.clientY - rect.top) / rect.height) * height), 0, height - 1)
    }
  }
  function drawCursor(point: Point): void {
    const canvas = cursorCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, width, height)
    if (tool === 'rectangle') {
      const rectangle = activeRectangle.current
      if (!rectangle) return
      const x = Math.min(rectangle.start.x, rectangle.end.x)
      const y = Math.min(rectangle.start.y, rectangle.end.y)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 2])
      ctx.strokeRect(
        x + 0.5,
        y + 0.5,
        Math.abs(rectangle.end.x - rectangle.start.x),
        Math.abs(rectangle.end.y - rectangle.start.y)
      )
      ctx.setLineDash([])
      return
    }
    const raster = rasterizeBrushOutline(width, height, point, brushSize, brushShape)
    if (!raster) return
    const imageData = ctx.createImageData(raster.width, raster.height)
    imageData.data.set(raster.data)
    ctx.putImageData(imageData, raster.left, raster.top)
  }
  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (beginPan(event) || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingPointer.current = event.pointerId
    const point = sourcePoint(event)
    if (tool === 'rectangle') {
      activeRectangle.current = { start: point, end: point }
      drawCursor(point)
      return
    }
    const action: StrokeAction = {
      type: 'stroke',
      tool,
      shape: brushShape,
      size: brushSize,
      points: [point]
    }
    activeStroke.current = action
    const ctx = dataCanvas.current?.getContext('2d')
    if (ctx) applyStrokeSegment(ctx, action, point, point)
    const display = maskCanvasRef.current?.getContext('2d')
    if (display) applyStrokeSegment(display, action, point, point, maskColor)
    drawCursor(point)
  }
  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (movePan(event)) return
    const point = sourcePoint(event)
    if (drawingPointer.current === event.pointerId) {
      if (activeRectangle.current) activeRectangle.current.end = point
      else if (activeStroke.current) {
        const action = activeStroke.current
        const previous = action.points[action.points.length - 1]
        action.points.push(point)
        const ctx = dataCanvas.current?.getContext('2d')
        if (ctx) applyStrokeSegment(ctx, action, previous, point)
        const display = maskCanvasRef.current?.getContext('2d')
        if (display) applyStrokeSegment(display, action, previous, point, maskColor)
      }
    }
    drawCursor(point)
  }
  function onPointerEnd(event: ReactPointerEvent<HTMLCanvasElement>): void {
    endPan(event)
    if (drawingPointer.current !== event.pointerId) return
    drawingPointer.current = null
    if (activeRectangle.current) {
      const rectangle = activeRectangle.current
      activeRectangle.current = null
      pushAction({ type: 'rectangle', start: rectangle.start, end: rectangle.end })
    } else if (activeStroke.current) {
      const action = activeStroke.current
      activeStroke.current = null
      actions.current = actions.current.slice(0, historyIndex.current)
      actions.current.push(action)
      historyIndex.current = actions.current.length
      renderDisplay()
      setHistoryVersion((version) => version + 1)
    }
  }
  function exportMask(): string {
    const data = dataCanvas.current!.getContext('2d')!.getImageData(0, 0, width, height).data
    const output = document.createElement('canvas')
    output.width = width
    output.height = height
    const context = output.getContext('2d')!
    const image = context.createImageData(width, height)
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i + 3] > 20 ? 255 : 0
      image.data[i] = value
      image.data[i + 1] = value
      image.data[i + 2] = value
      image.data[i + 3] = 255
    }
    context.putImageData(image, 0, 0)
    return output.toDataURL('image/png').split(',')[1]
  }

  const canUndo = historyVersion >= 0 && historyIndex.current > 0
  const canRedo = historyVersion >= 0 && historyIndex.current < actions.current.length
  return (
    <div className={cn('relative min-h-0 overflow-hidden bg-paper', className)}>
      <div
        ref={viewportRef}
        className={cn('absolute inset-0 overflow-hidden', panning && 'cursor-grabbing')}
        onWheel={onWheel}
      >
        <div className="absolute will-change-transform" style={frameStyle}>
          <img
            src={`data:image/png;base64,${imageBase64}`}
            className="pointer-events-none absolute inset-0 h-full w-full select-none"
            draggable={false}
            alt=""
          />
          <canvas
            ref={maskCanvasRef}
            width={width}
            height={height}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ opacity: maskOpacity / 100, imageRendering: 'pixelated' }}
          />
          <canvas
            ref={cursorCanvasRef}
            width={width}
            height={height}
            className={cn(
              'absolute inset-0 h-full w-full touch-none',
              panning
                ? 'cursor-grabbing'
                : tool === 'rectangle'
                  ? 'cursor-crosshair'
                  : 'cursor-none'
            )}
            style={{ imageRendering: 'pixelated' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onPointerLeave={(event) => {
              if (drawingPointer.current !== event.pointerId)
                cursorCanvasRef.current?.getContext('2d')?.clearRect(0, 0, width, height)
            }}
          />
        </div>
        <ZoomControls
          className="absolute right-3 top-3 z-20"
          label={zoomLabel}
          onZoomOut={zoomOut}
          onReset={resetView}
          onZoomIn={zoomIn}
        />
      </div>

      <div className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-line bg-surface/95 p-1.5 shadow-xl backdrop-blur no-scrollbar">
        <ToolButton
          active={tool === 'brush'}
          title={t('칠하기 (B)')}
          onClick={() => setTool('brush')}
        >
          <Paintbrush size={17} />
        </ToolButton>
        <ToolButton
          active={tool === 'erase'}
          title={t('지우기 (E)')}
          onClick={() => setTool('erase')}
        >
          <Eraser size={17} />
        </ToolButton>
        <ToolButton
          active={false}
          title={t('마스크 전체 채우기')}
          onClick={() => pushAction({ type: 'fill' })}
        >
          <PaintBucket size={17} />
        </ToolButton>
        <ToolButton
          active={tool === 'rectangle'}
          title={t('사각 영역 마스크 (R)')}
          onClick={() => setTool('rectangle')}
        >
          <Scan size={17} />
        </ToolButton>
        <div className="mx-1 h-6 w-px shrink-0 bg-line" />
        <ToolButton
          active={brushShape === 'round'}
          title={t('원형 붓')}
          onClick={() => {
            setBrushShape('round')
            persist('inpaint_brush_shape', 'round')
          }}
        >
          <Circle size={15} />
        </ToolButton>
        <ToolButton
          active={brushShape === 'square'}
          title={t('사각 붓')}
          onClick={() => {
            setBrushShape('square')
            persist('inpaint_brush_shape', 'square')
          }}
        >
          <Square size={15} />
        </ToolButton>
        <span className="ml-1 shrink-0 font-mono text-[11px] text-muted">{brushSize}px</span>
        <Slider
          className="w-28 shrink-0"
          min={2}
          max={Math.min(512, Math.max(width, height))}
          step={2}
          value={[brushSize]}
          onValueChange={([value]) => setAndPersistBrush(value)}
        />
        <div className="mx-1 h-6 w-px shrink-0 bg-line" />
        <MaskDisplayPopover
          color={maskColor}
          opacity={maskOpacity}
          border={maskBorder}
          pattern={maskPattern}
          onColor={(value) => {
            setMaskColor(value)
            persist('inpaint_mask_color', value)
          }}
          onOpacity={(value) => {
            setMaskOpacity(value)
            persist('inpaint_mask_opacity', value)
          }}
          onBorder={(value) => {
            setMaskBorder(value)
            persist('inpaint_mask_border', value)
          }}
          onPattern={(value) => {
            setMaskPattern(value)
            persist('inpaint_mask_pattern', value)
          }}
        />
        <ToolButton
          active={false}
          title={t('마스크 초기화')}
          onClick={() => pushAction({ type: 'clear' })}
        >
          <Trash2 size={17} />
        </ToolButton>
        <ToolButton active={false} title={t('화면에 맞춤')} onClick={resetView}>
          <Maximize2 size={16} />
        </ToolButton>
        <div className="mx-1 h-6 w-px shrink-0 bg-line" />
        <ToolButton
          active={false}
          title={t('실행 취소 (Ctrl+Z)')}
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 size={17} />
        </ToolButton>
        <ToolButton
          active={false}
          title={t('다시 실행 (Ctrl+Shift+Z)')}
          disabled={!canRedo}
          onClick={redo}
        >
          <Redo2 size={17} />
        </ToolButton>
        <div className="mx-1 h-6 w-px shrink-0 bg-line" />
        <Button size="sm" variant="ghost" className="shrink-0 gap-1" onClick={onCancel}>
          <X size={14} /> {t('취소')}
        </Button>
        <Button
          size="sm"
          variant="accent"
          className="shrink-0 gap-1"
          onClick={() => onConfirm(exportMask())}
        >
          <Check size={14} /> {t('적용')}
        </Button>
      </div>
    </div>
  )
}

function MaskDisplayPopover({
  color,
  opacity,
  border,
  pattern,
  onColor,
  onOpacity,
  onBorder,
  onPattern
}: {
  color: string
  opacity: number
  border: boolean
  pattern: MaskPattern
  onColor: (value: string) => void
  onOpacity: (value: number) => void
  onBorder: (value: boolean) => void
  onPattern: (value: MaskPattern) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative shrink-0"
          title={t('마스크 표시 설정')}
        >
          <Palette size={17} />
          <span
            className="absolute bottom-1 right-1 size-2 rounded-full border border-paper"
            style={{ backgroundColor: color }}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-[330px] space-y-4 p-4">
        <div>
          <p className="mb-2 text-[12px] font-medium text-muted">{t('마스크 색상')}</p>
          <div className="flex flex-wrap gap-2">
            {MASK_COLORS.map((item) => (
              <button
                key={item}
                className={cn(
                  'size-7 rounded-full border-2 transition-transform hover:scale-110',
                  item === color ? 'border-ink' : 'border-transparent'
                )}
                style={{ backgroundColor: item }}
                onClick={() => onColor(item)}
                aria-label={item}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="font-medium text-muted">{t('마스크 불투명도')}</span>
            <span className="font-mono text-ink">{opacity}%</span>
          </div>
          <Slider
            min={10}
            max={100}
            step={5}
            value={[opacity]}
            onValueChange={([value]) => onOpacity(value)}
          />
        </div>
        <label className="flex items-center gap-2 text-[12px] font-medium text-muted">
          <Switch checked={border} onCheckedChange={onBorder} />
          {t('마스크 테두리')}
        </label>
        <div>
          <p className="mb-2 text-[12px] font-medium text-muted">{t('마스크 패턴')}</p>
          <div className="flex gap-1.5">
            {MASK_PATTERNS.map((item) => (
              <button
                key={item}
                className={cn(
                  'grid size-9 place-items-center rounded-md border bg-paper',
                  item === pattern ? 'border-accent ring-1 ring-accent' : 'border-line'
                )}
                title={t(patternLabel(item))}
                onClick={() => onPattern(item)}
              >
                <span className="size-5 border border-muted" style={patternSwatch(item)} />
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ToolButton({
  active,
  title,
  disabled,
  onClick,
  children
}: {
  active: boolean
  title: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      size="icon"
      variant={active ? 'default' : 'ghost'}
      className="shrink-0"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function applyAction(
  context: CanvasRenderingContext2D,
  action: MaskAction,
  width: number,
  height: number
): void {
  if (action.type === 'clear') context.clearRect(0, 0, width, height)
  else if (action.type === 'fill') {
    context.save()
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.restore()
  } else if (action.type === 'rectangle') {
    const x = Math.min(action.start.x, action.end.x)
    const y = Math.min(action.start.y, action.end.y)
    context.save()
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = '#fff'
    context.fillRect(
      x,
      y,
      Math.max(1, Math.abs(action.end.x - action.start.x)),
      Math.max(1, Math.abs(action.end.y - action.start.y))
    )
    context.restore()
  } else
    for (let i = 0; i < action.points.length; i++)
      applyStrokeSegment(context, action, action.points[Math.max(0, i - 1)], action.points[i])
}
function applyStrokeSegment(
  context: CanvasRenderingContext2D,
  action: StrokeAction,
  start: Point,
  end: Point,
  fillStyle = '#fff'
): void {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const count = Math.max(1, Math.ceil(distance / Math.max(1, action.size / 5)))
  context.save()
  context.globalCompositeOperation = action.tool === 'erase' ? 'destination-out' : 'source-over'
  context.fillStyle = fillStyle
  for (let i = 0; i <= count; i++) {
    const ratio = i / count
    stamp(
      context,
      start.x + (end.x - start.x) * ratio,
      start.y + (end.y - start.y) * ratio,
      action.size,
      action.shape
    )
  }
  context.restore()
}
function stamp(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shape: BrushShape
): void {
  const radius = Math.max(1, size / 2)
  if (shape === 'square')
    context.fillRect(
      Math.floor(x - radius),
      Math.floor(y - radius),
      Math.ceil(size),
      Math.ceil(size)
    )
  else {
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }
}
function isMaskEdge(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): boolean {
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true
  const i = (y * width + x) * 4
  return (
    data[i - 1] <= 20 ||
    data[i + 7] <= 20 ||
    data[i - width * 4 + 3] <= 20 ||
    data[i + width * 4 + 3] <= 20
  )
}
function patternAt(pattern: MaskPattern, x: number, y: number): boolean {
  if (pattern === 'solid') return true
  if (pattern === 'diagonal') return (x + y) % 10 < 4
  if (pattern === 'crosshatch') return (x + y) % 12 < 3 || Math.abs(x - y) % 12 < 3
  if (pattern === 'dots') return x % 10 < 3 && y % 10 < 3
  if (pattern === 'grid') return x % 10 < 2 || y % 10 < 2
  return (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0
}
function patternLabel(pattern: MaskPattern): string {
  return (
    {
      solid: '단색',
      diagonal: '사선',
      crosshatch: '교차선',
      dots: '점',
      grid: '격자',
      checker: '체커보드'
    } as const
  )[pattern]
}
function patternSwatch(pattern: MaskPattern): React.CSSProperties {
  const color = 'currentColor'
  if (pattern === 'solid') return { background: color }
  if (pattern === 'diagonal')
    return { background: `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 5px)` }
  if (pattern === 'crosshatch')
    return {
      background: `repeating-linear-gradient(45deg, ${color} 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, ${color} 0 1px, transparent 1px 4px)`
    }
  if (pattern === 'dots')
    return { background: `radial-gradient(circle, ${color} 1px, transparent 1.5px) 0 0 / 5px 5px` }
  if (pattern === 'grid')
    return {
      background: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
      backgroundSize: '5px 5px'
    }
  return {
    background: `conic-gradient(${color} 25%, transparent 0 50%, ${color} 0 75%, transparent 0) 0 0 / 8px 8px`
  }
}
function hexToRgb(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

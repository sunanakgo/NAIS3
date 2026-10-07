import { Eraser, Hand, Paintbrush, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Slider } from './ui/slider'
import { Input } from './ui/input'
import { MASK_PAINT_RGB } from '../lib/color'
import { useT } from '../lib/i18n'

type View = { scale: number; x: number; y: number }

function zoomAt(view: View, scale: number, x: number, y: number): View {
  const ratio = scale / view.scale
  return { scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio }
}

/**
 * 인페인트 마스크 에디터 (NAIS2 방식):
 * 캔버스를 "원본 이미지 해상도"로 두고 CSS로만 확대/축소한다.
 * 출력: 원본 해상도 흑백 RGB PNG (칠한 곳=흰색). 마스크 좌표가 이미지와 1:1.
 */
export function MaskEditor({
  imageBase64,
  width,
  height,
  initialMaskBase64,
  onConfirm,
  onCancel
}: {
  imageBase64: string
  width: number
  height: number
  /** 이어서 편집할 기존 마스크 (흑백 PNG) — 재편집 진입 시 칠한 영역을 그대로 복원 */
  initialMaskBase64?: string
  onConfirm: (maskBase64: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [brush, setBrush] = useState(28)
  const [erasing, setErasing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [spacePressed, setSpacePressed] = useState(false)
  const drawing = useRef(false)
  const activePointer = useRef<number | null>(null)
  const pan = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [windowSize, setWindowSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))

  // 표시 크기 — 뷰포트 안에 들어오게 (캔버스는 원본 해상도, CSS로만 축소)
  const { dispW, dispH, fitScale } = useMemo(() => {
    const maxW = Math.max(1, Math.min(620, windowSize.width - 66))
    const maxH = Math.max(1, Math.round(windowSize.height * 0.58))
    const scale = Math.min(1, maxW / width, maxH / height)
    return { dispW: width * scale, dispH: height * scale, fitScale: scale }
  }, [width, height, windowSize])
  const [view, setView] = useState<View>(() => ({ scale: fitScale, x: 0, y: 0 }))
  const minScale = Math.min(0.1, fitScale)
  const maxScale = 16

  const [viewBasis, setViewBasis] = useState({ fitScale, width, height })
  if (viewBasis.fitScale !== fitScale || viewBasis.width !== width || viewBasis.height !== height) {
    setViewBasis({ fitScale, width, height })
    setView({ scale: fitScale, x: 0, y: 0 })
  }

  useEffect(() => {
    const resize = (): void =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight })
    const keydown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (e.code !== 'Space' || target?.closest('input, textarea, [contenteditable="true"]')) return
      // Keep keyboard activation of toolbar buttons while tracking Space for the next drag.
      if (!target?.closest('button, [role="slider"]')) e.preventDefault()
      setSpacePressed(true)
    }
    const keyup = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpacePressed(false)
    }
    const blur = (): void => {
      setSpacePressed(false)
      drawing.current = false
      activePointer.current = null
      pan.current = null
      last.current = null
    }
    window.addEventListener('resize', resize)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // A non-passive listener prevents the wheel from scrolling the dialog or zooming the app.
  useEffect(() => {
    if (!viewport) return
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (activePointer.current !== null) return
      const rect = viewport.getBoundingClientRect()
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? dispH : 1)
      setView((current) =>
        zoomAt(
          current,
          Math.max(minScale, Math.min(maxScale, current.scale * Math.exp(-delta * 0.002))),
          e.clientX - rect.left,
          e.clientY - rect.top
        )
      )
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [viewport, minScale, dispH])

  function zoom(factor: number): void {
    setView((current) =>
      zoomAt(
        current,
        Math.max(minScale, Math.min(maxScale, current.scale * factor)),
        dispW / 2,
        dispH / 2
      )
    )
  }

  // 기존 마스크 복원 — 흑백 PNG의 흰 픽셀을 칠한 색으로 되살린다 (재편집: 지우개로 다듬거나 덧칠)
  useEffect(() => {
    if (!initialMaskBase64) return
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const off = document.createElement('canvas')
      off.width = width
      off.height = height
      const octx = off.getContext('2d')!
      octx.drawImage(img, 0, 0, width, height)
      const src = octx.getImageData(0, 0, width, height)
      const out = octx.createImageData(width, height)
      for (let i = 0; i < src.data.length; i += 4) {
        // 흰색(=재생성 영역)만 칠한 것으로 간주
        const on = src.data[i] > 127
        out.data[i] = 233
        out.data[i + 1] = 94
        out.data[i + 2] = 80
        out.data[i + 3] = on ? 255 : 0
      }
      canvas.getContext('2d')!.putImageData(out, 0, 0)
    }
    img.src = `data:image/png;base64,${initialMaskBase64}`
  }, [initialMaskBase64, width, height])

  /** 화면 좌표 → 캔버스(원본) 좌표 */
  function pos(e: React.PointerEvent): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height
    }
  }

  function paint(e: React.PointerEvent): void {
    const canvas = canvasRef.current
    if (!canvas || !drawing.current) return
    const ctx = canvas.getContext('2d')!
    const { x, y } = pos(e)
    // 브러시는 원본 픽셀 기준 지름. 확대율과 관계없이 같은 마스크를 그린다.
    const r = brush / 2
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    // 스트로크는 불투명으로 그리고 캔버스 자체를 CSS opacity로 반투명 표시 — 겹쳐 칠해도 진해지지 않는다.
    ctx.strokeStyle = `rgb(${MASK_PAINT_RGB})`
    ctx.fillStyle = `rgb(${MASK_PAINT_RGB})`
    if (brush === 1) {
      // 원형 안티앨리어싱은 1px 지우개에 잔여 알파를 남긴다. 픽셀 단위로 완전히 칠하고 지운다.
      const startX = Math.floor(last.current?.x ?? x)
      const startY = Math.floor(last.current?.y ?? y)
      const dx = Math.floor(x) - startX
      const dy = Math.floor(y) - startY
      const steps = Math.max(Math.abs(dx), Math.abs(dy))
      for (let i = 0; i <= steps; i++) {
        const px = Math.round(startX + (dx * i) / (steps || 1))
        const py = Math.round(startY + (dy * i) / (steps || 1))
        if (erasing) ctx.clearRect(px, py, 1, 1)
        else ctx.fillRect(px, py, 1, 1)
      }
      ctx.globalCompositeOperation = 'source-over'
      last.current = { x, y }
      return
    }
    ctx.lineWidth = r * 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (last.current) {
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(x, y)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    last.current = { x, y }
  }

  function endPointer(e: React.PointerEvent): void {
    if (activePointer.current !== e.pointerId) return
    drawing.current = false
    activePointer.current = null
    pan.current = null
    last.current = null
  }

  function clear(): void {
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')!.clearRect(0, 0, width, height)
  }

  /** 캔버스(원본 해상도) → 흑백 RGB PNG (칠한 곳=흰색). 업스케일 없음 */
  function exportMask(): string {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, width, height)
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const octx = out.getContext('2d')!
    const img = octx.createImageData(width, height)
    for (let i = 0; i < data.length; i += 4) {
      const on = data[i + 3] > 20 ? 255 : 0
      img.data[i] = on
      img.data[i + 1] = on
      img.data[i + 2] = on
      img.data[i + 3] = 255
    }
    octx.putImageData(img, 0, 0)
    return out.toDataURL('image/png').split(',')[1]
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-[680px] overflow-y-auto p-4"
        aria-describedby={undefined}
      >
        <DialogTitle className="mb-3">{t('ui.inpaintMaskPaintTheAreaToRegenerate')}</DialogTitle>
        <div className="flex flex-col items-center gap-3">
          <div
            ref={setViewport}
            className="relative shrink-0 overflow-hidden rounded-md bg-paper ring-1 ring-line"
            style={{
              width: dispW,
              height: dispH,
              touchAction: 'none',
              cursor: moving || spacePressed ? 'grab' : 'crosshair'
            }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (activePointer.current !== null || (e.button !== 0 && e.button !== 1)) return
              e.preventDefault()
              e.currentTarget.focus()
              e.currentTarget.setPointerCapture(e.pointerId)
              activePointer.current = e.pointerId
              if (e.button === 1 || moving || spacePressed) {
                pan.current = { clientX: e.clientX, clientY: e.clientY, x: view.x, y: view.y }
                return
              }
              drawing.current = true
              last.current = null
              paint(e)
            }}
            onPointerMove={(e) => {
              if (activePointer.current !== e.pointerId) return
              if (pan.current) {
                const start = pan.current
                setView((current) => ({
                  ...current,
                  x: start.x + e.clientX - start.clientX,
                  y: start.y + e.clientY - start.clientY
                }))
              } else {
                paint(e)
              }
            }}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onLostPointerCapture={endPointer}
            tabIndex={0}
            aria-label={t('ui.inpaintCanvas')}
          >
            <div
              className="absolute"
              style={{
                left: view.x,
                top: view.y,
                width: width * view.scale,
                height: height * view.scale
              }}
            >
              <img
                src={`data:image/png;base64,${imageBase64}`}
                className="pointer-events-none absolute inset-0 h-full w-full select-none"
                draggable={false}
                alt=""
              />
              {/* 캔버스는 원본 해상도, CSS로만 축소 표시. opacity는 오버레이 표시용 — 픽셀 데이터(exportMask)에는 영향 없음 */}
              <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="absolute inset-0 h-full w-full"
                style={{ opacity: 0.4, imageRendering: view.scale >= 1 ? 'pixelated' : 'auto' }}
              />
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('ui.zoomOut')}
              disabled={view.scale <= minScale}
              onClick={() => zoom(1 / 1.25)}
            >
              <ZoomOut size={16} />
            </Button>
            <span className="w-14 text-center text-[12px] tabular-nums">
              {Math.round(view.scale * 100)}%
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('ui.zoomIn')}
              disabled={view.scale >= maxScale}
              onClick={() => zoom(1.25)}
            >
              <ZoomIn size={16} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setView({ scale: fitScale, x: 0, y: 0 })}
            >
              {t('ui.inpaintFitToView')}
            </Button>
            <Button
              size="sm"
              variant={moving ? 'default' : 'ghost'}
              aria-pressed={moving}
              className="gap-1"
              onClick={() => setMoving((value) => !value)}
            >
              <Hand size={14} />
              {t('ui.inpaintMoveView')}
            </Button>
          </div>
          <p className="text-center text-[11px] text-muted">{t('ui.inpaintNavigationHint')}</p>

          <div className="flex w-full flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={!moving && !erasing ? 'default' : 'ghost'}
              className="gap-1"
              onClick={() => {
                setMoving(false)
                setErasing(false)
              }}
            >
              <Paintbrush size={14} /> {t('ui.paint')}
            </Button>
            <Button
              size="sm"
              variant={!moving && erasing ? 'default' : 'ghost'}
              className="gap-1"
              onClick={() => {
                setMoving(false)
                setErasing(true)
              }}
            >
              <Eraser size={14} /> {t('ui.erase')}
            </Button>
            <label className="flex items-center gap-1 text-[12px] text-muted">
              {t('ui.inpaintBrushSize')}
              <Input
                className="w-16"
                type="number"
                min={1}
                max={120}
                step={1}
                value={brush}
                onChange={(e) => {
                  const value = e.currentTarget.valueAsNumber
                  if (Number.isFinite(value))
                    setBrush(Math.max(1, Math.min(120, Math.round(value))))
                }}
              />
              px
            </label>
            <Slider
              className="w-24"
              aria-label={t('ui.inpaintBrushSize')}
              min={1}
              max={120}
              step={1}
              value={[brush]}
              onValueChange={([v]) => setBrush(v)}
            />
            <Button size="sm" variant="ghost" className="gap-1" onClick={clear}>
              <RotateCcw size={13} /> {t('ui.reset')}
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" onClick={onCancel}>
              {t('ui.cancel')}
            </Button>
            <Button variant="accent" onClick={() => onConfirm(exportMask())}>
              {t('ui.apply')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

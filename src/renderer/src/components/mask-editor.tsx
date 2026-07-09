import { Eraser, Paintbrush, RotateCcw } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Slider } from './ui/slider'

/**
 * 인페인트 마스크 에디터 (NAIS2 방식):
 * 캔버스를 "원본 이미지 해상도"로 두고 CSS로만 축소 표시한다 (업스케일 아티팩트 없음).
 * 출력: 원본 해상도 흑백 RGB PNG (칠한 곳=흰색). 마스크 좌표가 이미지와 1:1.
 */
export function MaskEditor({
  imageBase64,
  width,
  height,
  onConfirm,
  onCancel
}: {
  imageBase64: string
  width: number
  height: number
  onConfirm: (maskBase64: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [brush, setBrush] = useState(28)
  const [erasing, setErasing] = useState(false)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  // 표시 크기 — 뷰포트 안에 들어오게 (캔버스는 원본 해상도, CSS로만 축소)
  const { dispW, dispH } = useMemo(() => {
    const maxW = 620
    const maxH = Math.round(window.innerHeight * 0.58)
    const scale = Math.min(1, maxW / width, maxH / height)
    return { dispW: Math.round(width * scale), dispH: Math.round(height * scale) }
  }, [width, height])

  /** 화면 좌표 → 캔버스(원본) 좌표 */
  function pos(e: React.PointerEvent): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
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
    // 붓 크기는 원본 해상도 기준으로 스케일 (화면에서 보이는 크기 유지)
    const r = (brush / dispW) * width
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    // 스트로크는 불투명으로 그리고 캔버스 자체를 CSS opacity로 반투명 표시 — 겹쳐 칠해도 진해지지 않는다.
    ctx.strokeStyle = 'rgb(233, 94, 80)'
    ctx.fillStyle = 'rgb(233, 94, 80)'
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
      <DialogContent className="max-w-[680px] p-4">
        <DialogTitle className="mb-3">인페인트 마스크 — 재생성할 영역을 칠하세요</DialogTitle>
        <div className="flex flex-col items-center gap-3">
          <div
            className="relative overflow-hidden rounded-md border border-line bg-paper"
            style={{ width: dispW, height: dispH }}
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
              className="absolute inset-0 h-full w-full cursor-crosshair"
              style={{ touchAction: 'none', opacity: 0.4 }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                drawing.current = true
                last.current = null
                paint(e)
              }}
              onPointerMove={paint}
              onPointerUp={() => {
                drawing.current = false
                last.current = null
              }}
              onPointerLeave={() => {
                drawing.current = false
                last.current = null
              }}
            />
          </div>

          <div className="flex w-full items-center gap-2">
            <Button
              size="sm"
              variant={erasing ? 'ghost' : 'default'}
              className="gap-1"
              onClick={() => setErasing(false)}
            >
              <Paintbrush size={14} /> 칠하기
            </Button>
            <Button
              size="sm"
              variant={erasing ? 'default' : 'ghost'}
              className="gap-1"
              onClick={() => setErasing(true)}
            >
              <Eraser size={14} /> 지우기
            </Button>
            <span className="ml-1 text-[12px] text-muted">붓 {brush}</span>
            <Slider
              className="w-36"
              min={8}
              max={120}
              step={2}
              value={[brush]}
              onValueChange={([v]) => setBrush(v)}
            />
            <Button size="sm" variant="ghost" className="gap-1" onClick={clear}>
              <RotateCcw size={13} /> 초기화
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" onClick={onCancel}>
              취소
            </Button>
            <Button variant="accent" onClick={() => onConfirm(exportMask())}>
              적용
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

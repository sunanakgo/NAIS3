import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Slider } from './ui/slider'

/**
 * 모자이크 편집기 (디렉터 로컬 툴, NAIS2 이식):
 * 원본은 <img>로 깔고, 캔버스는 모자이크 셀만 얹는 투명 오버레이 (마스크 에디터와 동일 구조 —
 * 캔버스 초기 drawImage에 의존하지 않아 다이얼로그 마운트 타이밍과 무관하게 이미지가 보인다).
 * 브러시가 지나간 영역을 pixelSize 그리드에 스냅해 원본 ImageData의 셀 평균색으로 채운다
 * — 색을 항상 원본에서 샘플링하므로 같은 곳을 반복해 칠해도 뭉개지지 않는다.
 * 적용 시 원본 + 오버레이를 오프스크린에서 합성해 반환한다.
 */
export function MosaicEditor({
  imageBase64,
  width,
  height,
  onConfirm,
  onCancel
}: {
  imageBase64: string
  width: number
  height: number
  onConfirm: (resultBase64: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const originalRef = useRef<ImageData | null>(null)
  const doneCells = useRef(new Set<string>()) // 현재 pixelSize 그리드에서 이미 칠한 셀
  const [brush, setBrush] = useState(28) // 인페인트 마스크와 동일한 기본 붓 크기
  const [pixel, setPixel] = useState(10)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  // 표시 크기 — 뷰포트 안에 들어오게 (캔버스는 원본 해상도, CSS로만 축소)
  const { dispW, dispH } = useMemo(() => {
    const maxW = 620
    const maxH = Math.round(window.innerHeight * 0.58)
    const scale = Math.min(1, maxW / width, maxH / height)
    return { dispW: Math.round(width * scale), dispH: Math.round(height * scale) }
  }, [width, height])

  // 원본 픽셀 데이터를 오프스크린 캔버스로 확보 (색 샘플링·합성 소스)
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const off = document.createElement('canvas')
      off.width = width
      off.height = height
      const ctx = off.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      originalRef.current = ctx.getImageData(0, 0, width, height)
    }
    img.src = `data:image/png;base64,${imageBase64}`
  }, [imageBase64, width, height])

  // 슬라이더 값 복원/저장 (NAIS2와 동일하게 재시작 후 유지)
  useEffect(() => {
    void window.nais.invoke('settings:get', { key: 'mosaic_pixel' }).then(({ value }) => {
      if (value) setPixel(Math.min(30, Math.max(5, Number(value))))
    })
    void window.nais.invoke('settings:get', { key: 'mosaic_brush' }).then(({ value }) => {
      if (value) setBrush(Math.min(150, Math.max(20, Number(value))))
    })
  }, [])
  function persist(key: string, value: number): void {
    void window.nais.invoke('settings:set', { key, value: String(value) })
  }

  /** 화면 좌표 → 캔버스(원본) 좌표 */
  function pos(e: React.PointerEvent): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height
    }
  }

  /** 브러시 중심 사각 영역을 그리드에 스냅해 셀별로 원본 평균색 fillRect */
  function mosaicAt(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    const orig = originalRef.current
    if (!orig) return
    const { data } = orig
    const x0 = Math.max(0, Math.floor((cx - r) / pixel) * pixel)
    const y0 = Math.max(0, Math.floor((cy - r) / pixel) * pixel)
    for (let py = y0; py < Math.min(cy + r, height); py += pixel) {
      for (let px = x0; px < Math.min(cx + r, width); px += pixel) {
        const key = `${px},${py}`
        if (doneCells.current.has(key)) continue
        doneCells.current.add(key)
        // 셀 평균색 (NAIS2는 좌상단 1픽셀 샘플 — 평균으로 개선)
        let rs = 0
        let gs = 0
        let bs = 0
        let as = 0
        let n = 0
        const yEnd = Math.min(py + pixel, height)
        const xEnd = Math.min(px + pixel, width)
        for (let y = py; y < yEnd; y++) {
          for (let x = px; x < xEnd; x++) {
            const i = (y * width + x) * 4
            rs += data[i]
            gs += data[i + 1]
            bs += data[i + 2]
            as += data[i + 3]
            n++
          }
        }
        // 투명 영역은 덮어쓰기 위해 지우고 다시 채움 (fillRect는 알파 블렌딩이라)
        ctx.clearRect(px, py, xEnd - px, yEnd - py)
        ctx.fillStyle = `rgba(${(rs / n) | 0}, ${(gs / n) | 0}, ${(bs / n) | 0}, ${as / n / 255})`
        ctx.fillRect(px, py, xEnd - px, yEnd - py)
      }
    }
  }

  function paint(e: React.PointerEvent): void {
    const canvas = canvasRef.current
    if (!canvas || !drawing.current) return
    const ctx = canvas.getContext('2d')!
    const { x, y } = pos(e)
    // 붓 크기는 원본 해상도 기준으로 스케일 (화면에서 보이는 크기 유지)
    const r = (brush / dispW) * width
    // 빠르게 드래그해도 빈틈이 없게 이전 점부터 보간
    if (last.current) {
      const dx = x - last.current.x
      const dy = y - last.current.y
      const dist = Math.hypot(dx, dy)
      const step = Math.max(pixel, r / 2)
      for (let d = step; d < dist; d += step) {
        mosaicAt(ctx, last.current.x + (dx * d) / dist, last.current.y + (dy * d) / dist, r)
      }
    }
    mosaicAt(ctx, x, y, r)
    last.current = { x, y }
  }

  function reset(): void {
    canvasRef.current?.getContext('2d')!.clearRect(0, 0, width, height)
    doneCells.current.clear()
  }

  /** 원본 + 모자이크 오버레이를 오프스크린에서 합성 → base64 PNG */
  function exportResult(): string {
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')!
    ctx.putImageData(originalRef.current!, 0, 0)
    ctx.drawImage(canvasRef.current!, 0, 0)
    return out.toDataURL('image/png').split(',')[1]
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[680px] p-4">
        <DialogTitle className="mb-3">모자이크 — 가릴 영역을 칠하세요</DialogTitle>
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
            {/* 모자이크 셀만 얹는 오버레이 — 원본 해상도, CSS로만 축소 표시 */}
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              className="absolute inset-0 h-full w-full cursor-crosshair"
              style={{ touchAction: 'none' }}
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
            <span className="text-[12px] text-muted">픽셀 {pixel}</span>
            <Slider
              className="w-28"
              min={5}
              max={30}
              step={1}
              value={[pixel]}
              onValueChange={([v]) => {
                setPixel(v)
                persist('mosaic_pixel', v)
                doneCells.current.clear() // 그리드가 바뀌면 셀 추적 초기화
              }}
            />
            <span className="ml-1 text-[12px] text-muted">붓 {brush}</span>
            <Slider
              className="w-28"
              min={20}
              max={150}
              step={5}
              value={[brush]}
              onValueChange={([v]) => {
                setBrush(v)
                persist('mosaic_brush', v)
              }}
            />
            <Button size="sm" variant="ghost" className="gap-1" onClick={reset}>
              <RotateCcw size={13} /> 초기화
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" onClick={onCancel}>
              취소
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                if (originalRef.current) onConfirm(exportResult())
              }}
            >
              적용
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

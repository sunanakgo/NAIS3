import {
  ChevronRight,
  Droplets,
  Eraser,
  Grid3x3,
  ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  MessageSquareText,
  Pencil,
  PenTool,
  Smile,
  Sparkles,
  Undo2,
  Upload,
  Wand2,
  X,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { directorAugmentCost, directorToolCost } from '@shared/anlas'
import { EMOTIONS, type DirectorMethod } from '@shared/types'
import { openInDirector, useDirectorStore } from '../stores/director-store'
import { useGenerationStore } from '../stores/generation-store'
import { useLayoutStore } from '../stores/layout-store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { isLeavingDropZone, useDragEndCleanup } from '../lib/drop-zone'
import { DropOverlay } from './drop-overlay'
import { MosaicEditor } from './mosaic-editor'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'

type Opt = 'colorize' | 'emotion' | undefined
const TOOLS: {
  method: DirectorMethod
  label: string
  desc: string
  icon: typeof Eraser
  color: string
  opt?: Opt
}[] = [
  { method: 'bg-removal', label: '배경 제거', desc: '캐릭터만 남기고 배경을 투명하게', icon: Eraser, color: 'text-rose-400' },
  { method: 'lineart', label: '라인아트', desc: '선화 추출', icon: PenTool, color: 'text-sky-400' },
  { method: 'sketch', label: '스케치', desc: '스케치풍으로 변환', icon: Pencil, color: 'text-amber-400' },
  { method: 'colorize', label: '색칠', desc: '선화를 채색 (프롬프트로 유도)', icon: Droplets, color: 'text-emerald-400', opt: 'colorize' },
  { method: 'emotion', label: '표정 변경', desc: '얼굴 표정을 교체', icon: Smile, color: 'text-fuchsia-400', opt: 'emotion' },
  { method: 'declutter', label: '이미지 정리', desc: '워터마크·잡요소 제거', icon: Sparkles, color: 'text-violet-400' },
  {
    method: 'declutter-keep-bubbles',
    label: '정리 (말풍선 유지)',
    desc: '말풍선은 남기고 정리',
    icon: MessageSquareText,
    color: 'text-violet-300'
  }
]

export function DirectorMode(): React.JSX.Element {
  const stack = useDirectorStore((s) => s.stack)
  const loading = useDirectorStore((s) => s.loading)
  const error = useDirectorStore((s) => s.error)
  const setSource = useDirectorStore((s) => s.setSource)
  const applyLocal = useDirectorStore((s) => s.applyLocal)
  const undo = useDirectorStore((s) => s.undo)
  const clear = useDirectorStore((s) => s.clear)
  // 모자이크 편집기 — 열 때의 이미지·해상도 고정 (편집 중 스택 변화와 무관)
  const [mosaic, setMosaic] = useState<{ base64: string; width: number; height: number } | null>(
    null
  )

  const source = stack.length > 0 ? stack[stack.length - 1] : null
  const isResult = stack.length > 1 // 툴이 한 번 이상 적용된 상태
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  useDragEndCleanup(() => setDragOver(false))

  // 예상 Anlas — 업스케일과 augment-image 디렉터 툴은 서로 다른 공식 계산식을 쓴다.
  const tier = useGenerationStore((s) => s.subscriptionTier)
  const [toolCosts, setToolCosts] = useState<{
    upscale: number
    backgroundRemoval: number
    standardAugment: number
  } | null>(null)
  useEffect(() => {
    if (!source) {
      setToolCosts(null)
      return
    }
    let alive = true
    void imageDims(source).then(({ width, height }) => {
      if (!alive) return
      const isOpus = tier === 'opus'
      setToolCosts({
        upscale: directorToolCost(width, height, isOpus),
        backgroundRemoval: directorAugmentCost('bg-removal', width, height, isOpus),
        standardAugment: directorAugmentCost('lineart', width, height, isOpus)
      })
    })
    return () => {
      alive = false
    }
  }, [source, tier])

  // i2i/인페인트로 보내고 메인 페이지로 전환 (현재 이미지 사용)
  async function sendToMain(mode: 'i2i' | 'inpaint'): Promise<void> {
    if (!source) return
    const { width, height } = await imageDims(source)
    if (mode === 'i2i') {
      useGenerationStore.getState().setSource({ imageBase64: source, width, height })
    } else {
      useGenerationStore.getState().startInpaintFromImage(source, width, height)
    }
    useLayoutStore.getState().setCenterMode('main')
  }

  function loadFile(file: File): void {
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result as string
      setSource(result.replace(/^data:[^,]+,/, ''))
    }
    reader.readAsDataURL(file)
  }

  const shown = source ? `data:image/png;base64,${source}` : null

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      {/* 캔버스 */}
      <div
        className={cn(
          'relative flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl border bg-surface',
          dragOver ? 'border-accent' : 'border-line'
        )}
        onDragOver={(e) => {
          // 외부 파일 또는 히스토리 썸네일(내부 드래그) 둘 다 허용
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
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const internalPath = e.dataTransfer.getData('nais/file-path')
          if (internalPath) {
            void openInDirector(internalPath)
            return
          }
          const file = e.dataTransfer.files?.[0]
          if (file?.type.startsWith('image/')) loadFile(file)
        }}
      >
        {shown ? (
          <>
            <img src={shown} className="h-full w-full object-contain p-2" draggable={false} alt="" />
            {isResult && (
              <span className="absolute left-3 top-3 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-white">
                결과
              </span>
            )}
            {/* 하단 컨트롤 */}
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-paper/85 p-1 backdrop-blur">
              <Button size="icon" variant="ghost" className="rounded-full" title="지우기" onClick={clear}>
                <X size={16} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="rounded-full"
                title="되돌리기 (이전 이미지)"
                disabled={!isResult}
                onClick={undo}
              >
                <Undo2 size={16} />
              </Button>
              <div className="mx-0.5 h-5 w-px bg-line" />
              <Button
                size="icon"
                variant="ghost"
                className="rounded-full"
                title="다른 이미지 열기"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={16} />
              </Button>
            </div>
          </>
        ) : (
          <div
            // 점선 박스를 실제 드롭 가능 영역(캔버스 전체)과 일치시킴 — 여백만큼 작아 보이던 문제 (B10)
            className={cn(
              'absolute inset-2 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-faint transition-colors',
              dragOver ? 'border-accent text-accent' : 'border-line'
            )}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={44} strokeWidth={1.2} className="opacity-40" />
            <p className="text-[14px] font-medium">이미지를 열거나 드래그하세요</p>
            <p className="text-[12px] opacity-60">히스토리 이미지를 우클릭해 바로 보낼 수도 있어요</p>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/45 text-white backdrop-blur-sm">
            <Loader2 size={40} className="animate-spin" />
            <span className="text-[13px]">처리 중…</span>
          </div>
        )}

        {/* 이미지가 이미 있을 때의 드롭 안내 (없을 땐 점선 박스가 하이라이트됨) */}
        <DropOverlay
          show={dragOver && !!shown}
          icon={Wand2}
          label="여기 놓으면 이 이미지로 교체합니다"
          sub="디렉터 툴로 새 이미지 열기"
        />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) loadFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {/* 툴 패널 */}
      <div className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Wand2 size={16} className="text-accent" />
          <h2 className="text-[14px] font-semibold">디렉터 툴</h2>
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3 no-scrollbar">
          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}
          {/* i2i·인페인트 — 여기서 시작하면 메인 페이지로 이동 */}
          <SendToMainCard
            icon={ImageIcon}
            color="text-indigo-400"
            label="I2I"
            desc="이 이미지로 img2img (메인으로)"
            disabled={!source}
            onRun={() => sendToMain('i2i')}
          />
          <SendToMainCard
            icon={Layers}
            color="text-pink-400"
            label="인페인트"
            desc="마스크 칠해 부분 재생성 (메인으로)"
            disabled={!source}
            onRun={() => sendToMain('inpaint')}
          />
          <div className="!my-3 h-px bg-line" />
          <UpscaleCard disabled={!source || loading} cost={toolCosts?.upscale ?? null} />
          {TOOLS.map((tool) => (
            <ToolCard
              key={tool.method}
              tool={tool}
              disabled={!source || loading}
              cost={
                tool.method === 'bg-removal'
                  ? (toolCosts?.backgroundRemoval ?? null)
                  : (toolCosts?.standardAugment ?? null)
              }
            />
          ))}
          <div className="!my-3 h-px bg-line" />
          {/* 로컬 툴 — API/Anlas 안 씀 */}
          <SendToMainCard
            icon={Grid3x3}
            color="text-orange-400"
            label="모자이크"
            desc="브러시로 칠해 픽셀화 (로컬·무료)"
            disabled={!source || loading}
            onRun={() => {
              if (!source) return
              void imageDims(source).then((dims) => setMosaic({ base64: source, ...dims }))
            }}
          />
        </div>
      </div>

      {mosaic && (
        <MosaicEditor
          imageBase64={mosaic.base64}
          width={mosaic.width}
          height={mosaic.height}
          onConfirm={(b64) => {
            setMosaic(null)
            void applyLocal(b64, 'mosaic')
          }}
          onCancel={() => setMosaic(null)}
        />
      )}
    </div>
  )
}

/** 예상 Anlas 칩 — 0=무료(초록), >0=빨간 -N */
function CostChip({ cost }: { cost: number | null }): React.JSX.Element | null {
  if (cost == null) return null
  return cost === 0 ? (
    <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
      무료
    </span>
  ) : (
    <span className="shrink-0 rounded bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-danger">
      -{cost}
    </span>
  )
}

function ToolCard({
  tool,
  disabled,
  cost
}: {
  tool: (typeof TOOLS)[number]
  disabled: boolean
  cost: number | null
}): React.JSX.Element {
  const run = useDirectorStore((s) => s.run)
  // 옵션은 카드별 로컬 state — 툴끼리 값 공유 안 되게
  const [emotion, setEmotion] = useState('neutral')
  const [prompt, setPrompt] = useState('')
  const [defry, setDefry] = useState(0)
  const Icon = tool.icon

  function onRun(): void {
    if (tool.opt === 'emotion') {
      void run(tool.method, { prompt: `${emotion};;${prompt}`, defry })
    } else if (tool.opt === 'colorize') {
      void run(tool.method, { prompt, defry })
    } else {
      void run(tool.method)
    }
  }

  const hasOpt = tool.opt != null
  // 옵션 위젯은 클릭해도 실행 안 되게 (카드 클릭 실행과 분리)
  const stop = (e: React.MouseEvent): void => e.stopPropagation()

  return (
    <div
      role="button"
      aria-disabled={disabled}
      onClick={() => !disabled && onRun()}
      className={cn(
        'group rounded-xl border border-line bg-surface-2/40 p-3 transition-colors',
        disabled ? 'opacity-60' : 'cursor-pointer hover:bg-surface-2/70'
      )}
    >
      <div className={cn('flex items-center gap-2.5', hasOpt && 'mb-2')}>
        <Icon size={18} className={tool.color} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{tool.label}</p>
          <p className="truncate text-[11px] text-faint">{tool.desc}</p>
        </div>
        <CostChip cost={cost} />
        <ChevronRight size={16} className="shrink-0 text-faint transition-colors group-hover:text-accent" />
      </div>

      {tool.opt === 'emotion' && (
        <div className="grid gap-1.5" onClick={stop}>
          <Select value={emotion} onValueChange={setEmotion}>
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMOTIONS.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-8"
            placeholder="추가 프롬프트 (선택)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <DefryRow value={defry} onChange={setDefry} />
        </div>
      )}
      {tool.opt === 'colorize' && (
        <div className="grid gap-1.5" onClick={stop}>
          <Input
            className="h-8"
            placeholder="색 유도 프롬프트 (선택)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <DefryRow value={defry} onChange={setDefry} />
        </div>
      )}
    </div>
  )
}

/** 업스케일 카드 — 2x/4x 선택 후 클릭 실행 (결과 자동 체이닝) */
function UpscaleCard({
  disabled,
  cost
}: {
  disabled: boolean
  cost: number | null
}): React.JSX.Element {
  const upscale = useDirectorStore((s) => s.upscale)
  const [scale, setScale] = useState(2)
  return (
    <div
      role="button"
      aria-disabled={disabled}
      onClick={() => !disabled && void upscale(scale)}
      className={cn(
        'group rounded-xl border border-line bg-surface-2/40 p-3 transition-colors',
        disabled ? 'opacity-60' : 'cursor-pointer hover:bg-surface-2/70'
      )}
    >
      <div className="mb-2 flex items-center gap-2.5">
        <Maximize2 size={18} className="text-cyan-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">업스케일</p>
          <p className="truncate text-[11px] text-faint">해상도를 배수로 키움</p>
        </div>
        <CostChip cost={cost} />
        <ChevronRight size={16} className="shrink-0 text-faint transition-colors group-hover:text-accent" />
      </div>
      {/* 배율 선택 — 클릭이 카드 실행으로 전파되지 않게 */}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {[2, 4].map((n) => (
          <button
            key={n}
            onClick={() => setScale(n)}
            className={cn(
              'flex-1 rounded-md border py-1 text-[12px] font-medium transition-colors',
              scale === n ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink'
            )}
          >
            {n}x
          </button>
        ))}
      </div>
    </div>
  )
}

/** base64 이미지의 실제 픽셀 크기 */
function imageDims(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = `data:image/png;base64,${base64}`
  })
}

/** i2i·인페인트 진입 카드 (메인 페이지로 이동) */
function SendToMainCard({
  icon: Icon,
  color,
  label,
  desc,
  disabled,
  onRun
}: {
  icon: LucideIcon
  color: string
  label: string
  desc: string
  disabled: boolean
  onRun: () => void
}): React.JSX.Element {
  return (
    <div
      role="button"
      aria-disabled={disabled}
      onClick={() => !disabled && onRun()}
      className={cn(
        'group flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/40 p-3 transition-colors',
        disabled ? 'opacity-60' : 'cursor-pointer hover:bg-surface-2/70'
      )}
    >
      <Icon size={18} className={color} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="truncate text-[11px] text-faint">{desc}</p>
      </div>
      <ChevronRight size={16} className="shrink-0 text-faint transition-colors group-hover:text-accent" />
    </div>
  )
}

function DefryRow({ value, onChange }: { value: number; onChange: (v: number) => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="w-16 shrink-0 text-[11px] text-muted">약화 {value}</span>
      <Slider min={0} max={5} step={1} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  )
}

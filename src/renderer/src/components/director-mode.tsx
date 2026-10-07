import {
  ArrowUpRight,
  Droplets,
  Eraser,
  Grid3x3,
  ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  MessageSquareText,
  Palette,
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
import { directorAugmentCost, UPSCALE_ANLAS_COST } from '@shared/anlas'
import type { MessageId } from '@shared/i18n'
import { EMOTIONS, type DirectorMethod } from '@shared/types'
import { useT } from '../lib/i18n'
import { useArtistTagsStore } from '../stores/artist-tags-store'
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
import { MaskWorkspace } from './mask-workspace'
import { ZoomableImageStage } from './image-viewport'

type ToolGroup = 'ai' | 'main' | 'local'
type ToolId = DirectorMethod | 'upscale' | 'i2i' | 'inpaint' | 'mosaic' | 'artist-tags'

/**
 * 디렉터 툴 목록 — 그룹 순서대로 표시.
 * ai: Anlas를 쓰고 결과가 스택에 쌓임 / main: 메인 페이지로 넘겨 이어서 작업 / local: 무료
 */
const TOOLS: {
  id: ToolId
  group: ToolGroup
  label: MessageId
  desc: MessageId
  icon: LucideIcon
}[] = [
  {
    id: 'upscale',
    group: 'ai',
    label: 'ui.upscale',
    desc: 'ui.upscaleV5Description',
    icon: Maximize2
  },
  {
    id: 'bg-removal',
    group: 'ai',
    label: 'ui.removeBg',
    desc: 'ui.makeTheBackgroundTransparentKeepingOnlyTheCharacter',
    icon: Eraser
  },
  { id: 'lineart', group: 'ai', label: 'ui.lineArt', desc: 'ui.extractLineArt', icon: PenTool },
  { id: 'sketch', group: 'ai', label: 'ui.sketch', desc: 'ui.convertToSketchStyle', icon: Pencil },
  {
    id: 'colorize',
    group: 'ai',
    label: 'ui.colorize',
    desc: 'ui.colorLineArtGuidedByPrompt',
    icon: Droplets
  },
  {
    id: 'emotion',
    group: 'ai',
    label: 'ui.changeExpression',
    desc: 'ui.replaceTheFacialExpression',
    icon: Smile
  },
  {
    id: 'declutter',
    group: 'ai',
    label: 'ui.declutter.6851509',
    desc: 'ui.removeWatermarksAndClutter',
    icon: Sparkles
  },
  {
    id: 'declutter-keep-bubbles',
    group: 'ai',
    label: 'ui.declutterKeepBubbles',
    desc: 'ui.declutterWhileKeepingSpeechBubbles',
    icon: MessageSquareText
  },
  {
    id: 'i2i',
    group: 'main',
    label: 'ui.directorImg2img',
    desc: 'ui.img2imgWithThisImageGoesToMain',
    icon: ImageIcon
  },
  {
    id: 'inpaint',
    group: 'main',
    label: 'ui.inpaint',
    desc: 'ui.paintMaskInCanvas',
    icon: Layers
  },
  {
    id: 'mosaic',
    group: 'local',
    label: 'ui.mosaic',
    desc: 'ui.paintWithABrushToPixelateLocalFree',
    icon: Grid3x3
  },
  // Anlas는 안 쓰지만 외부(HF Space) 호출 — 인터넷 필요
  {
    id: 'artist-tags',
    group: 'local',
    label: 'ui.artistTagAnalysis',
    desc: 'ui.extractArtistTagsWithASimilarStyleKaloscopeFree',
    icon: Palette
  }
]

const GROUPS: { id: ToolGroup; label: MessageId }[] = [
  { id: 'ai', label: 'ui.directorGroupAi' },
  { id: 'main', label: 'ui.directorGroupMain' },
  { id: 'local', label: 'ui.directorGroupLocal' }
]

/** 실행 버튼 문구 — 그룹/툴마다 실제로 일어나는 일을 말해 준다 */
function actionLabel(id: ToolId, group: ToolGroup): MessageId {
  if (group === 'main' && id !== 'inpaint') return 'ui.directorOpenInMain'
  if (id === 'mosaic' || id === 'inpaint') return 'ui.directorOpenEditor'
  if (id === 'artist-tags') return 'ui.directorAnalyze'
  return 'ui.directorApply'
}

export function DirectorMode(): React.JSX.Element {
  const t = useT()
  const stack = useDirectorStore((s) => s.stack)
  const loading = useDirectorStore((s) => s.loading)
  const error = useDirectorStore((s) => s.error)
  const setSource = useDirectorStore((s) => s.setSource)
  const run = useDirectorStore((s) => s.run)
  const upscale = useDirectorStore((s) => s.upscale)
  const applyLocal = useDirectorStore((s) => s.applyLocal)
  const undo = useDirectorStore((s) => s.undo)
  const clear = useDirectorStore((s) => s.clear)
  const instantRun = useDirectorStore((s) => s.instantRun)
  // 기본은 클릭으로 고르고 하단 버튼으로 실행 — 실수 클릭으로 Anlas가 나가지 않게.
  // 설정의 '디렉터 툴 즉시 실행'을 켜면 클릭 한 번에 실행된다.
  const [selected, setSelected] = useState<ToolId | null>(null)
  // 옵션은 툴별로 따로 — 툴끼리 값 공유 안 되게
  const [colorizeOpt, setColorizeOpt] = useState({ prompt: '', defry: 0 })
  const [emotionOpt, setEmotionOpt] = useState({ emotion: 'neutral', prompt: '', defry: 0 })
  // 모자이크 편집기 — 열 때의 이미지·해상도 고정 (편집 중 스택 변화와 무관)
  const [mosaic, setMosaic] = useState<{ base64: string; width: number; height: number } | null>(
    null
  )
  const [inpaint, setInpaint] = useState<{
    base64: string
    width: number
    height: number
  } | null>(null)

  const source = stack.length > 0 ? stack[stack.length - 1] : null
  const isResult = stack.length > 1 // 툴이 한 번 이상 적용된 상태
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  useDragEndCleanup(() => setDragOver(false))

  // 예상 Anlas — 업스케일과 augment-image 디렉터 툴은 서로 다른 공식 계산식을 쓴다.
  const tier = useGenerationStore((s) => s.subscriptionTier)
  const [sourceInfo, setSourceInfo] = useState<{
    source: string
    dimensions: { width: number; height: number }
    costs: { upscale: number; backgroundRemoval: number; standardAugment: number }
  } | null>(null)
  const sourceDims = sourceInfo?.source === source ? sourceInfo.dimensions : null
  const currentToolCosts = sourceInfo?.source === source ? sourceInfo.costs : null
  useEffect(() => {
    if (!source) return
    let alive = true
    void imageDims(source).then(({ width, height }) => {
      if (!alive) return
      const isOpus = tier === 'opus'
      setSourceInfo({
        source,
        dimensions: { width, height },
        costs: {
          upscale: UPSCALE_ANLAS_COST,
          backgroundRemoval: directorAugmentCost('bg-removal', width, height, isOpus),
          standardAugment: directorAugmentCost('lineart', width, height, isOpus)
        }
      })
    })
    return () => {
      alive = false
    }
  }, [source, tier])

  // i2i/인페인트로 보내고 메인 페이지로 전환 (현재 이미지 사용)
  async function sendToMain(): Promise<void> {
    if (!source) return
    const { width, height } = sourceDims ?? (await imageDims(source))
    useGenerationStore.getState().setSource({ imageBase64: source, width, height })
    useLayoutStore.getState().setCenterMode('main')
  }

  async function beginInpaint(): Promise<void> {
    if (!source) return
    const { width, height } = sourceDims ?? (await imageDims(source))
    setInpaint({ base64: source, width, height })
  }

  function applyInpaint(maskBase64: string): void {
    if (!inpaint) return
    const generation = useGenerationStore.getState()
    generation.startInpaintFromImage(inpaint.base64, inpaint.width, inpaint.height)
    generation.confirmInpaint(maskBase64)
    setInpaint(null)
    useLayoutStore.getState().setCenterMode('main')
  }

  function costOf(id: ToolId, group: ToolGroup): number | null {
    if (group === 'local') return 0
    if (group === 'main' || !currentToolCosts) return null
    if (id === 'upscale') return currentToolCosts.upscale
    if (id === 'bg-removal') return currentToolCosts.backgroundRemoval
    return currentToolCosts.standardAugment
  }

  // 메인으로 보내기는 처리 중에도 가능 (기존 동작 유지)
  const canRun = (group: ToolGroup): boolean =>
    !!source && !inpaint && (group === 'main' || !loading)

  function runTool(id: ToolId): void {
    if (!source) return
    switch (id) {
      case 'upscale':
        void upscale()
        break
      case 'i2i':
        void sendToMain()
        break
      case 'inpaint':
        void beginInpaint()
        break
      case 'mosaic':
        void imageDims(source).then((dims) => setMosaic({ base64: source, ...dims }))
        break
      case 'artist-tags':
        void useArtistTagsStore.getState().show({ base64: source })
        break
      case 'colorize':
        void run(id, colorizeOpt)
        break
      case 'emotion':
        void run(id, {
          prompt: `${emotionOpt.emotion};;${emotionOpt.prompt}`,
          defry: emotionOpt.defry
        })
        break
      default:
        void run(id)
    }
  }

  const selectedTool = TOOLS.find((tool) => tool.id === selected) ?? null

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
        {inpaint ? (
          <MaskWorkspace
            className="absolute inset-0"
            imageBase64={inpaint.base64}
            width={inpaint.width}
            height={inpaint.height}
            onConfirm={applyInpaint}
            onCancel={() => setInpaint(null)}
          />
        ) : shown ? (
          <>
            {sourceDims ? (
              <ZoomableImageStage src={shown} width={sourceDims.width} height={sourceDims.height}>
                {isResult && (
                  <span className="absolute left-3 top-3 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-on-accent">
                    {t('ui.result')}
                  </span>
                )}
                <DirectorImageControls
                  isResult={isResult}
                  clear={clear}
                  undo={undo}
                  openFile={() => fileRef.current?.click()}
                />
              </ZoomableImageStage>
            ) : (
              <img
                src={shown}
                className="h-full w-full object-contain p-2"
                draggable={false}
                alt=""
              />
            )}
          </>
        ) : (
          <div
            // 점선 박스를 실제 드롭 가능 영역(캔버스 전체)과 일치시킴 — 여백만큼 작아 보이던 문제 (B10)
            className={cn(
              'absolute inset-2 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-faint transition-colors',
              dragOver ? 'border-accent text-accent-ink' : 'border-line'
            )}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={44} strokeWidth={1.2} className="opacity-40" />
            <p className="text-[14px] font-medium">{t('ui.openOrDragAnImageHere')}</p>
            <p className="text-[12px] opacity-60">
              {t('ui.youCanAlsoRightClickAHistoryImageToSendItHere')}
            </p>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/45 text-white backdrop-blur-sm">
            <Loader2 size={40} className="animate-spin" />
            <span className="text-[13px]">{t('ui.processing')}</span>
          </div>
        )}

        {/* 이미지가 이미 있을 때의 드롭 안내 (없을 땐 점선 박스가 하이라이트됨) */}
        <DropOverlay
          show={dragOver && !!shown}
          icon={Wand2}
          label={t('ui.dropHereToReplaceThisImage')}
          sub={t('ui.openANewImageInDirectorTools')}
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

      {/* 툴 패널 — 위: 그룹별 툴 목록 / 아래: 고른 툴의 옵션과 실행 버튼 */}
      <div className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        {/* 헤더 — 히스토리 패널 헤더와 같은 높이·크기 */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <Wand2 size={14} className="text-muted" />
          <h2 className="text-[13px] font-medium">{t('ui.directorTools')}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 no-scrollbar">
          {error && (
            <p className="mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}
          {GROUPS.map((group) => (
            <section key={group.id} className="mb-2 last:mb-0">
              <h3 className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-muted">
                {t(group.label)}
              </h3>
              {TOOLS.filter((tool) => tool.group === group.id).map((tool) => (
                <ToolRow
                  key={tool.id}
                  icon={tool.icon}
                  label={t(tool.label)}
                  desc={t(tool.desc)}
                  selected={selected === tool.id}
                  trailing={
                    group.id === 'main' ? (
                      <ArrowUpRight size={14} className="shrink-0 text-faint" />
                    ) : (
                      <CostChip cost={costOf(tool.id, group.id)} />
                    )
                  }
                  onSelect={() => {
                    setSelected(tool.id)
                    if (instantRun && canRun(group.id)) runTool(tool.id)
                  }}
                  // 더블클릭은 바로 실행 — 즉시 실행이 꺼져 있을 때의 지름길
                  onRun={() => !instantRun && canRun(group.id) && runTool(tool.id)}
                />
              ))}
            </section>
          ))}
        </div>

        <div className="border-t border-line p-3">
          {!source || !selectedTool ? (
            <p className="py-3 text-center text-[12px] text-muted">
              {t(!source ? 'ui.directorOpenImageFirst' : 'ui.directorSelectTool')}
            </p>
          ) : (
            <div className="grid gap-2.5">
              <div className="flex items-center gap-2">
                <selectedTool.icon size={16} className="shrink-0 text-accent-ink" />
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                  {t(selectedTool.label)}
                </p>
                {selectedTool.group !== 'main' && (
                  <CostChip cost={costOf(selectedTool.id, selectedTool.group)} />
                )}
              </div>
              {selectedTool.id === 'colorize' && (
                <>
                  <Input
                    className="h-8"
                    placeholder={t('ui.colorGuidancePromptOptional')}
                    value={colorizeOpt.prompt}
                    onChange={(e) => setColorizeOpt({ ...colorizeOpt, prompt: e.target.value })}
                  />
                  <DefryRow
                    value={colorizeOpt.defry}
                    onChange={(defry) => setColorizeOpt({ ...colorizeOpt, defry })}
                  />
                </>
              )}
              {selectedTool.id === 'emotion' && (
                <>
                  <Select
                    value={emotionOpt.emotion}
                    onValueChange={(emotion) => setEmotionOpt({ ...emotionOpt, emotion })}
                  >
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
                    placeholder={t('ui.additionalPromptOptional')}
                    value={emotionOpt.prompt}
                    onChange={(e) => setEmotionOpt({ ...emotionOpt, prompt: e.target.value })}
                  />
                  <DefryRow
                    value={emotionOpt.defry}
                    onChange={(defry) => setEmotionOpt({ ...emotionOpt, defry })}
                  />
                </>
              )}
              <Button
                variant="accent"
                size="lg"
                className="w-full"
                disabled={!canRun(selectedTool.group)}
                onClick={() => runTool(selectedTool.id)}
              >
                {t(actionLabel(selectedTool.id, selectedTool.group))}
              </Button>
            </div>
          )}
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

function DirectorImageControls({
  isResult,
  clear,
  undo,
  openFile
}: {
  isResult: boolean
  clear: () => void
  undo: () => void
  openFile: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-paper/85 p-1 backdrop-blur">
      <Button
        size="icon"
        variant="ghost"
        className="rounded-full"
        title={t('ui.erase')}
        onClick={clear}
      >
        <X size={16} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="rounded-full"
        title={t('ui.undoPreviousImage')}
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
        title={t('ui.openAnotherImage')}
        onClick={openFile}
      >
        <Upload size={16} />
      </Button>
    </div>
  )
}

/** 예상 Anlas 칩 — 0=무료(초록), >0=빨간 -N */
function CostChip({ cost }: { cost: number | null }): React.JSX.Element | null {
  const t = useT()
  if (cost == null) return null
  return cost === 0 ? (
    <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
      {t('ui.free')}
    </span>
  ) : (
    <span className="shrink-0 rounded bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-danger">
      -{cost}
    </span>
  )
}

/** 툴 목록 한 줄 — 클릭은 선택, 더블클릭은 바로 실행 */
function ToolRow({
  icon: Icon,
  label,
  desc,
  selected,
  trailing,
  onSelect,
  onRun
}: {
  icon: LucideIcon
  label: string
  desc: string
  selected: boolean
  trailing: React.ReactNode
  onSelect: () => void
  onRun: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onRun}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors',
        selected ? 'border-accent/40 bg-accent-soft' : 'border-transparent hover:bg-surface-2'
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
          selected ? 'bg-accent/15 text-accent-ink' : 'bg-surface-2 text-muted group-hover:text-ink'
        )}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="block truncate text-[11px] text-muted">{desc}</span>
      </span>
      {trailing}
    </button>
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

function DefryRow({
  value,
  onChange
}: {
  value: number
  onChange: (v: number) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="w-16 shrink-0 text-[11px] text-muted">{t('ui.defryValue', value)}</span>
      <Slider min={0} max={5} step={1} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  )
}

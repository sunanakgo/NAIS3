import {
  ChevronDown,
  ChevronUp,
  ImageUp,
  Info,
  Layers,
  Minus,
  Plus,
  Puzzle,
  SlidersHorizontal,
  Square,
  UsersRound
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { effectiveGenerationStrength, estimateAnlas, formatAnlasEstimate } from '@shared/anlas'
import type { MessageId } from '@shared/i18n'
import { snapNaiResolution } from '@shared/nai-resolution'
import {
  inpaintingModelFor,
  isV5Model,
  modelCapabilities,
  promptTokenLimit
} from '@shared/nai-models'
import { useT } from '../lib/i18n'
import { useCharactersStore } from '../stores/characters-store'
import { useFragmentsStore } from '../stores/fragments-store'
import { useGenerationStore } from '../stores/generation-store'
import { useLayoutStore } from '../stores/layout-store'
import { useCharRefsStore, useVibesStore } from '../stores/refs-store'
import { useScenesStore } from '../stores/scenes-store'
import { PromptEditor } from './prompt-editor'
import { PromptPresetBar } from './prompt-preset-bar'
import { CharacterOverlay } from './character-overlay'
import { FragmentOverlay } from './fragment-overlay'
import { ParamsDialog } from './params-dialog'
import { RefOverlay } from './ref-overlay'
import { SOURCE_BANNER_HEIGHT, SourceBanner } from './source-banner'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export function PromptPanel(): React.JSX.Element {
  const t = useT()
  const request = useGenerationStore((s) => s.request)
  const patch = useGenerationStore((s) => s.patchRequest)
  const patchPromptParts = useGenerationStore((s) => s.patchPromptParts)
  const promptSplitEnabled = useGenerationStore((s) => s.promptSplitEnabled)
  const queue = useGenerationStore((s) => s.queue)
  const batchCount = useGenerationStore((s) => s.batchCount)
  const setBatchCount = useGenerationStore((s) => s.setBatchCount)
  const generate = useGenerationStore((s) => s.generate)
  const cancelAll = useGenerationStore((s) => s.cancelAll)
  const charOverlayOpen = useCharactersStore((s) => s.overlayOpen)
  const toggleCharOverlay = useCharactersStore((s) => s.toggleOverlay)
  const charItems = useCharactersStore((s) => s.items)
  const fragOverlayOpen = useFragmentsStore((s) => s.overlayOpen)
  const setFragOverlayOpen = useFragmentsStore((s) => s.setOverlayOpen)
  const vibeOverlayOpen = useVibesStore((s) => s.overlayOpen)
  const setVibeOverlayOpen = useVibesStore((s) => s.setOverlayOpen)
  const enabledVibes = useVibesStore((s) => s.items.filter((v) => v.enabled).length)
  const unencodedVibes = useVibesStore(
    (s) => s.items.filter((v) => v.enabled && !v.encodedModels?.includes(request.model)).length
  )
  const crefOverlayOpen = useCharRefsStore((s) => s.overlayOpen)
  const setCrefOpen = useCharRefsStore((s) => s.setOverlayOpen)
  const enabledCrefs = useCharRefsStore((s) => s.items.filter((c) => c.enabled).length)
  const source = useGenerationStore((s) => s.source)
  const opusUsage = useGenerationStore((s) => s.opusUsage)
  const capabilities = modelCapabilities(request.model)
  const tokenLimit = promptTokenLimit(request.model)
  const estimateModel = source?.maskBase64 ? inpaintingModelFor(request.model) : request.model
  const estimateSize = source
    ? snapNaiResolution(source.width, source.height)
    : { width: request.width, height: request.height }
  const [paramsOpen, setParamsOpen] = useState(false)

  useEffect(() => {
    const openParams = (): void => setParamsOpen((v) => !v)
    window.addEventListener('shortcut:openParams', openParams)
    return () => window.removeEventListener('shortcut:openParams', openParams)
  }, [])

  // 씬 모드: 생성은 예약된 씬들을 예약 수만큼 큐에 넣는다. 예약 0이면 생성 버튼 비활성.
  const centerMode = useLayoutStore((s) => s.centerMode)
  // 모든 프리셋의 예약 총합 — 씬 생성 버튼 한 번으로 전부 실행
  const sceneReserved = useScenesStore((s) => s.reservedTotal)
  const generateReserved = useScenesStore((s) => s.generateReserved)
  const isScene = centerMode === 'scene'
  // 프롬프트/네거티브 개별 접기 — 하나를 접으면 다른 하나가 넓어짐
  const [posCollapsed, setPosCollapsed] = useState(false)
  const [negCollapsed, setNegCollapsed] = useState(false)
  // 포지티브/네거티브 세로 비율 — 사이 스플리터 드래그로 조절 (F10)
  const promptAreaRef = useRef<HTMLDivElement>(null)
  const [posRatio, setPosRatio] = useState(() => {
    const v = Number(localStorage.getItem('prompt_pos_ratio'))
    return v >= 0.15 && v <= 0.85 ? v : 0.62
  })
  const bothOpen = !posCollapsed && !negCollapsed
  const startPromptResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const area = promptAreaRef.current
    if (!area) return
    const onMove = (ev: MouseEvent): void => {
      const rect = area.getBoundingClientRect()
      const r = Math.min(0.85, Math.max(0.15, (ev.clientY - rect.top) / rect.height))
      setPosRatio(r)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      localStorage.setItem('prompt_pos_ratio', String(posRatioRef.current))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const posRatioRef = useRef(posRatio)
  useEffect(() => {
    posRatioRef.current = posRatio
  }, [posRatio])

  const subscriptionTier = useGenerationStore((s) => s.subscriptionTier)
  const queueCount =
    queue?.items.filter((i) => i.state === 'pending' || i.state === 'generating').length ?? 0
  const generating = queueCount > 0
  const activeChars = charItems.filter((c) => c.enabled && c.prompt.trim()).length

  // 토큰 표시: 포지티브는 기본+캐릭터 합산(공홈과 동일), 네거티브는 메인 것만 —
  // 공홈이 메인 네거와 캐릭터 네거를 별개로 세므로 합산하지 않는다 (캐릭 네거는 카드에서 자체 표시)
  const [tokenTotals, setTokenTotals] = useState<{ pos: number | null; neg: number | null }>({
    pos: null,
    neg: null
  })
  const enabledChars = useMemo(
    () => charItems.filter((c) => c.enabled && c.prompt.trim()),
    [charItems]
  )
  useEffect(() => {
    // V5 uses Qwen rather than the bundled V4.5 T5 tokenizer. Hide the count until
    // the matching Qwen tokenizer is bundled; showing a T5 count would be misleading.
    if (isV5Model(request.model)) {
      const timer = setTimeout(() => setTokenTotals({ pos: null, neg: null }))
      return () => clearTimeout(timer)
    }
    const posTexts = [request.prompt, ...enabledChars.map((c) => c.prompt)].filter((t) => t.trim())
    const negTexts = [request.negativePrompt].filter((t) => t.trim())
    if (posTexts.length === 0 && negTexts.length === 0) {
      const timer = setTimeout(() => setTokenTotals({ pos: null, neg: null }))
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      void window.nais
        .invoke('tokens:count', { texts: [...posTexts, ...negTexts] })
        .then(({ counts }) => {
          // 공홈은 캡션별 EOS를 각각 포함해 그대로 합산한다 (빈 칸 = 1토큰인 이유)
          const sum = (arr: number[]): number | null =>
            arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0)
          setTokenTotals({
            pos: sum(counts.slice(0, posTexts.length)),
            neg: sum(counts.slice(posTexts.length))
          })
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [request.model, request.prompt, request.negativePrompt, enabledChars])

  const anlas = useMemo(
    () =>
      estimateAnlas({
        model: estimateModel,
        width: estimateSize.width,
        height: estimateSize.height,
        steps: request.steps,
        strength: effectiveGenerationStrength(
          Boolean(source),
          Boolean(source?.maskBase64),
          request.i2iStrength
        ),
        charRefCount: capabilities.characterReferences ? enabledCrefs : 0,
        isOpus: subscriptionTier === 'opus',
        opusUsageExhausted: opusUsage?.isNegative,
        batchCount,
        vibeCount: capabilities.vibes ? enabledVibes : 0,
        unencodedVibes: capabilities.vibes ? unencodedVibes : 0
      }),
    [
      estimateModel,
      estimateSize.width,
      estimateSize.height,
      request.steps,
      request.i2iStrength,
      source,
      subscriptionTier,
      opusUsage,
      batchCount,
      enabledCrefs,
      enabledVibes,
      unencodedVibes,
      capabilities.characterReferences,
      capabilities.vibes
    ]
  )

  // 오버레이는 하나만 열림 — 서로 배타
  const only = (target: 'char' | 'frag' | 'vibe' | 'cref'): void => {
    const map = {
      char: charOverlayOpen,
      frag: fragOverlayOpen,
      vibe: vibeOverlayOpen,
      cref: crefOverlayOpen
    }
    const willOpen = !map[target]
    if (charOverlayOpen) toggleCharOverlay()
    setFragOverlayOpen(false)
    setVibeOverlayOpen(false)
    setCrefOpen(false)
    if (!willOpen) return
    if (target === 'char') toggleCharOverlay()
    else if (target === 'frag') setFragOverlayOpen(true)
    else if (target === 'vibe') setVibeOverlayOpen(true)
    else setCrefOpen(true)
  }

  return (
    <aside className="relative flex h-full w-full flex-col gap-3 rounded-xl border border-line bg-surface p-3">
      {/* 상단 여백을 창 드래그 영역으로 (프롬프트 영역 위) */}
      <div className="drag absolute inset-x-0 top-0 h-3" />
      {/* 오버레이는 프롬프트 영역만 덮는다 — 하단 버튼들은 항상 접근 가능 (NAIS2 2.0.7 교훈)
          셸 하나가 열림/닫힘만 애니메이션하고 내용은 즉시 전환 — 오버레이 간 전환 깜빡임 방지 */}
      <div ref={promptAreaRef} className="relative flex min-h-0 flex-1 flex-col gap-2">
        <AnimatePresence>
          {(charOverlayOpen || fragOverlayOpen || vibeOverlayOpen || crefOverlayOpen) && (
            <motion.div
              key="overlay-shell"
              className="absolute -inset-1 z-10 rounded-lg bg-surface p-1"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {charOverlayOpen ? (
                <CharacterOverlay />
              ) : fragOverlayOpen ? (
                <FragmentOverlay />
              ) : vibeOverlayOpen ? (
                // key로 vibe↔charref 전환 시 리마운트 → 카드 등장 애니메이션 방지 (캐릭터/조각과 동일하게 빠릿)
                <RefOverlay key="vibe" kind="vibe" />
              ) : (
                <RefOverlay key="charref" kind="charref" />
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {source && (
            <motion.div
              key="source-banner"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: SOURCE_BANNER_HEIGHT, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="shrink-0 overflow-hidden"
            >
              <SourceBanner />
            </motion.div>
          )}
        </AnimatePresence>
        {/* 프롬프트 프리셋 — 포지티브 프롬프트 위 */}
        <PromptPresetBar />
        <div
          className={'flex min-h-0 flex-col gap-1 ' + (posCollapsed ? 'flex-none' : 'min-h-9')}
          style={
            bothOpen
              ? { flexGrow: posRatio, flexBasis: 0 }
              : !posCollapsed
                ? { flexGrow: 1 }
                : undefined
          }
        >
          <CollapseHeader
            label="ui.prompt"
            collapsed={posCollapsed}
            onToggle={() => setPosCollapsed((v) => !v)}
            action={
              <div className="flex items-center gap-1">
                {promptSplitEnabled && <TokenBadge tokens={tokenTotals.pos} limit={tokenLimit} />}
                <SyntaxHelp />
              </div>
            }
          />
          {!posCollapsed &&
            (promptSplitEnabled ? (
              <SplitPromptFields
                parts={request.promptParts ?? { base: request.prompt, additional: '', detail: '' }}
                onChange={patchPromptParts}
              />
            ) : (
              <PromptEditor
                className="min-h-0 flex-1"
                value={request.prompt}
                tokensOverride={tokenTotals.pos}
                tokenLimit={tokenLimit}
                placeholder={t('ui.value1girlTagAutocompleteFragment')}
                onValueChange={(v) => patch({ prompt: v })}
              />
            ))}
        </div>
        {/* 세로 비율 조절 스플리터 (둘 다 펼쳐졌을 때만) */}
        {bothOpen && (
          <div
            className="group -my-1 flex h-2 shrink-0 cursor-row-resize items-center justify-center"
            onMouseDown={startPromptResize}
          >
            <div className="h-0.5 w-8 rounded-full bg-line transition-colors group-hover:bg-accent/50" />
          </div>
        )}
        <div
          className={'flex min-h-0 flex-col gap-1 ' + (negCollapsed ? 'flex-none' : 'min-h-9')}
          style={
            bothOpen
              ? { flexGrow: 1 - posRatio, flexBasis: 0 }
              : !negCollapsed
                ? { flexGrow: 1 }
                : undefined
          }
        >
          <CollapseHeader
            label="ui.negative"
            collapsed={negCollapsed}
            onToggle={() => setNegCollapsed((v) => !v)}
          />
          {!negCollapsed && (
            <PromptEditor
              negative
              className="min-h-0 flex-1"
              value={request.negativePrompt}
              tokensOverride={tokenTotals.neg}
              tokenLimit={tokenLimit}
              placeholder={t('ui.appendedAfterTheUcPreset')}
              onValueChange={(v) => patch({ negativePrompt: v })}
            />
          )}
        </div>
      </div>

      {/* 도구 행: 캐릭터 / 조각 / 바이브 / 레퍼런스 */}
      <div className="grid grid-cols-4 gap-1.5">
        <ToolButton
          active={charOverlayOpen}
          icon={<UsersRound size={14} />}
          label="ui.character"
          badge={activeChars}
          onClick={() => only('char')}
        />
        <ToolButton
          active={fragOverlayOpen}
          icon={<Puzzle size={14} />}
          label="ui.fragments"
          badge={0}
          onClick={() => only('frag')}
        />
        <ToolButton
          active={vibeOverlayOpen}
          icon={<Layers size={14} />}
          label="ui.vibes"
          badge={capabilities.vibes ? enabledVibes : 0}
          disabled={!capabilities.vibes}
          onClick={() => only('vibe')}
        />
        <ToolButton
          active={crefOverlayOpen}
          icon={<ImageUp size={14} />}
          label="ui.reference"
          badge={capabilities.characterReferences ? enabledCrefs : 0}
          disabled={!capabilities.characterReferences}
          onClick={() => only('cref')}
        />
      </div>

      {/* 생성 행: 파라미터 / 배치 / 생성 */}
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          className="h-10 w-9 shrink-0"
          title={t('ui.generationParameters')}
          onClick={() => setParamsOpen(true)}
        >
          <SlidersHorizontal size={16} />
        </Button>
        <div className="flex h-10 items-center rounded-md border border-line bg-paper">
          <Button
            size="icon"
            variant="ghost"
            className="h-full w-7 rounded-r-none"
            onClick={() => setBatchCount(batchCount - 1)}
          >
            <Minus size={13} />
          </Button>
          {/* 숫자 직접 입력 가능 */}
          <input
            className="w-8 bg-transparent text-center font-mono text-[13px] text-ink outline-none"
            value={batchCount}
            inputMode="numeric"
            onChange={(e) => {
              const n = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10)
              if (!Number.isNaN(n)) setBatchCount(n)
            }}
            onFocus={(e) => e.target.select()}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-full w-7 rounded-l-none"
            onClick={() => setBatchCount(batchCount + 1)}
          >
            <Plus size={13} />
          </Button>
        </div>
        {generating ? (
          <Button variant="danger" size="lg" className="flex-1" onClick={() => void cancelAll()}>
            <Square size={14} /> {t('ui.cancel')} ({queueCount})
          </Button>
        ) : isScene ? (
          <Button
            variant="accent"
            size="lg"
            className="flex-1 gap-2"
            disabled={sceneReserved === 0}
            title={
              sceneReserved === 0
                ? t('ui.queueScenesWithBeforeGenerating')
                : t('ui.generateValueQueuedImagesAcrossAllPresetsInPresetOrder', sceneReserved)
            }
            onClick={() => void generateReserved()}
          >
            {t('ui.generateScenes')}
            {sceneReserved > 0 && (
              // 한글 '장'이 mono 폴백(Windows Consolas)에서 깨져 보여 기본 폰트(Pretendard) 사용
              <span className="text-[12px] opacity-75">{t('ui.valueImages', sceneReserved)}</span>
            )}
          </Button>
        ) : (
          <Button
            variant="accent"
            size="lg"
            className="flex-1 gap-2"
            title={formatAnlasEstimate(anlas, batchCount, t)}
            onClick={() => void generate()}
          >
            {t('ui.generate')}
          </Button>
        )}
      </div>

      <ParamsDialog open={paramsOpen} onOpenChange={setParamsOpen} />
    </aside>
  )
}

/** 프롬프트/네거티브 라벨 + 개별 접기 토글(^) */
function CollapseHeader({
  label,
  collapsed,
  onToggle,
  action
}: {
  label: MessageId
  collapsed: boolean
  onToggle: () => void
  action?: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex shrink-0 items-center justify-between text-[12px] font-medium text-muted">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 transition-colors hover:text-ink"
        title={collapsed ? t('ui.expandValue', t(label)) : t('ui.collapseValue', t(label))}
      >
        <span>{t(label)}</span>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {action}
    </div>
  )
}

function TokenBadge({
  tokens,
  limit
}: {
  tokens: number | null
  limit: number
}): React.JSX.Element | null {
  const t = useT()
  if (tokens === null) return null
  const over = tokens > limit
  return (
    <span
      className={
        'rounded bg-paper px-1.5 py-0.5 font-mono text-[10.5px] ' +
        (over ? 'text-danger' : 'text-faint')
      }
      title={
        over
          ? t('ui.overTheLimitValueValueTokensTheExcessIsCutOffAndNotApplied', tokens, limit)
          : t('ui.finalPromptValueValueTokens', tokens, limit)
      }
    >
      {tokens}/{limit}
    </span>
  )
}

type SplitPartKey = 'base' | 'additional' | 'detail'
type SplitPromptParts = Record<SplitPartKey, string>

const SPLIT_PARTS: { key: SplitPartKey; label: MessageId; placeholder: MessageId }[] = [
  { key: 'base', label: 'ui.fixed', placeholder: 'ui.basePromptToAlwaysKeep' },
  { key: 'additional', label: 'ui.variable', placeholder: 'ui.promptToClearAndRewriteEachTime' },
  { key: 'detail', label: 'ui.detail', placeholder: 'ui.qualityCompositionFineDetails' }
]

const SPLIT_COLLAPSED_KEY = 'prompt_split_collapsed'
const SPLIT_SIZES_KEY = 'prompt_split_sizes'

function loadSplitCollapsed(): Record<SplitPartKey, boolean> {
  const fallback = { base: false, additional: false, detail: false }
  try {
    const raw = JSON.parse(localStorage.getItem(SPLIT_COLLAPSED_KEY) ?? '{}') as Partial<
      Record<SplitPartKey, boolean>
    >
    return {
      base: raw.base === true,
      additional: raw.additional === true,
      detail: raw.detail === true
    }
  } catch {
    return fallback
  }
}

function loadSplitSizes(): Record<SplitPartKey, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SPLIT_SIZES_KEY) ?? '{}') as Partial<
      Record<SplitPartKey, number>
    >
    const base = typeof raw.base === 'number' ? raw.base : 0.34
    const additional = typeof raw.additional === 'number' ? raw.additional : 0.33
    const detail = typeof raw.detail === 'number' ? raw.detail : 0.33
    return { base, additional, detail }
  } catch {
    return { base: 0.34, additional: 0.33, detail: 0.33 }
  }
}

function SplitPromptFields({
  parts,
  onChange
}: {
  parts: SplitPromptParts
  onChange: (patch: Partial<SplitPromptParts>) => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(loadSplitCollapsed)
  const [sizes, setSizes] = useState(loadSplitSizes)
  const sizesRef = useRef(sizes)
  useEffect(() => {
    sizesRef.current = sizes
  }, [sizes])

  const openKeys = SPLIT_PARTS.filter((part) => !collapsed[part.key]).map((part) => part.key)

  const togglePart = (key: SplitPartKey): void => {
    setCollapsed((current) => {
      const next = { ...current, [key]: !current[key] }
      localStorage.setItem(SPLIT_COLLAPSED_KEY, JSON.stringify(next))
      return next
    })
  }

  const startSplitResize = (
    before: SplitPartKey,
    after: SplitPartKey,
    e: React.MouseEvent<HTMLDivElement>
  ): void => {
    e.preventDefault()
    const area = containerRef.current
    if (!area) return
    const startY = e.clientY
    const start = sizesRef.current
    const beforeStart = start[before]
    const afterStart = start[after]
    const pairTotal = beforeStart + afterStart
    const min = Math.min(0.16, pairTotal / 2)

    const onMove = (ev: MouseEvent): void => {
      const height = Math.max(1, area.getBoundingClientRect().height)
      const delta = (ev.clientY - startY) / height
      const nextBefore = Math.min(pairTotal - min, Math.max(min, beforeStart + delta))
      const nextAfter = pairTotal - nextBefore
      setSizes((current) => {
        const next = { ...current, [before]: nextBefore, [after]: nextAfter }
        sizesRef.current = next
        return next
      })
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      localStorage.setItem(SPLIT_SIZES_KEY, JSON.stringify(sizesRef.current))
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const nextOpenAfter = (key: SplitPartKey): SplitPartKey | undefined => {
    const index = openKeys.indexOf(key)
    return index >= 0 ? openKeys[index + 1] : undefined
  }

  // flex-grow 합이 1 미만이면 남는 공간을 다 안 채운다 (CSS 스펙) —
  // 칸을 접으면 열린 칸들의 비율 합이 1이 되도록 정규화해서 나머지가 자동으로 커지게 한다
  const openTotal = openKeys.reduce((sum, key) => sum + sizes[key], 0)

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col gap-1">
      {SPLIT_PARTS.map((part) => {
        const isCollapsed = collapsed[part.key]
        const nextOpen = isCollapsed ? undefined : nextOpenAfter(part.key)
        return (
          <Fragment key={part.key}>
            <SplitField
              label={part.label}
              collapsed={isCollapsed}
              value={parts[part.key]}
              placeholder={part.placeholder}
              grow={sizes[part.key] / (openTotal || 1)}
              onToggle={() => togglePart(part.key)}
              onChange={(value) => onChange({ [part.key]: value })}
            />
            {nextOpen && (
              <div
                className="group -my-1 flex h-2 shrink-0 cursor-row-resize items-center justify-center"
                onMouseDown={(e) => startSplitResize(part.key, nextOpen, e)}
              >
                <div className="h-0.5 w-8 rounded-full bg-line transition-colors group-hover:bg-accent/50" />
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

function SplitField({
  label,
  collapsed,
  value,
  placeholder,
  grow,
  onToggle,
  onChange
}: {
  label: MessageId
  collapsed: boolean
  value: string
  placeholder: MessageId
  grow: number
  onToggle: () => void
  onChange: (value: string) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div
      className={'flex min-h-0 flex-col gap-1 ' + (collapsed ? 'flex-none' : 'min-h-9')}
      style={collapsed ? undefined : { flexGrow: grow, flexBasis: 0 }}
    >
      <CollapseHeader label={label} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <PromptEditor
          className="min-h-0 flex-1"
          value={value}
          tokensOverride={null}
          placeholder={t(placeholder)}
          onValueChange={onChange}
        />
      )}
    </div>
  )
}

/** 프롬프트 문법 도움말 — ⓘ 팝오버 (주석·조각·순차·랜덤·가중치) */
function SyntaxHelp(): React.JSX.Element {
  const t = useT()
  const rows: { syntax: MessageId; desc: MessageId }[] = [
    { syntax: 'ui.note', desc: 'ui.linesStartingWithAreCommentsNotSent' },
    {
      syntax: 'ui.name.ae3fe07',
      desc: 'ui.insertAFragmentWithMultipleLinesOneRandomLinePerGeneration'
    },
    {
      syntax: 'ui.name.0ecf258',
      desc: 'ui.sequentialNextLineEachGenerationResetWithInTheHeader'
    },
    { syntax: 'ui.inlineRandomSyntax', desc: 'ui.inlineRandomOneOfTheThree' },
    { syntax: 'ui.value13Tag', desc: 'ui.weightAbove1StrongerBelow1WeakerNegativeAllowed' }
  ]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="grid size-5 place-items-center rounded text-faint transition-colors hover:text-ink"
          title={t('ui.promptSyntaxHelp')}
        >
          <Info size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2.5">
        <p className="mb-1.5 text-[12px] font-semibold text-ink">{t('ui.promptSyntax')}</p>
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div key={r.syntax} className="flex flex-col gap-0.5">
              <code className="w-fit rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-accent">
                {t(r.syntax)}
              </code>
              <span className="text-[11px] leading-snug text-muted">{t(r.desc)}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ToolButton({
  active,
  icon,
  label,
  badge,
  onClick,
  disabled = false
}: {
  active: boolean
  icon: React.ReactNode
  label: MessageId
  badge: number
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="relative">
      <Button
        variant={active ? 'default' : 'ghost'}
        className="h-8 w-full min-w-0 gap-1 px-1.5 text-[12px]"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? t('ui.notYetSupportedByTheSelectedModel') : undefined}
      >
        {icon}
        <span className="min-w-0 truncate">{t(label)}</span>
      </Button>
      {badge > 0 && (
        // 우측 상단에 겹치는 알림 배지 (붉은 원)
        <span className="pointer-events-none absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 font-mono text-[10px] font-medium text-white shadow">
          {badge}
        </span>
      )}
    </div>
  )
}

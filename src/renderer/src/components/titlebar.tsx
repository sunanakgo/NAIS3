import {
  BatteryCharging,
  Coins,
  Download,
  Loader2,
  Minus,
  PanelLeft,
  PanelRight,
  Settings,
  Square,
  X
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useGenerationStore } from '../stores/generation-store'
import { useLayoutStore } from '../stores/layout-store'
import { useUpdateStore } from '../stores/update-store'
import { useVibesStore, useCharRefsStore } from '../stores/refs-store'
import { displayOpusUsagePercent, effectiveGenerationStrength, estimateAnlas } from '@shared/anlas'
import { inpaintingModelFor, modelCapabilities } from '@shared/nai-models'
import { snapNaiResolution } from '@shared/nai-resolution'
import { PageNav } from './page-nav'
import { ThemeToggle } from './theme-toggle'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

function ctrl(action: 'minimize' | 'maximize' | 'close'): void {
  void window.nais.invoke('window:control', { action })
}

/** 업데이트 발견 시 나타나는 다운로드 버튼 (신호등·패널토글 옆). 클릭 시 자동 업데이트 진행 */
function UpdateButton(): React.JSX.Element | null {
  const t = useT()
  const status = useUpdateStore((s) => s.status)
  const percent = useUpdateStore((s) => s.percent)
  const version = useUpdateStore((s) => s.version)
  const start = useUpdateStore((s) => s.start)

  if (status === 'available') {
    return (
      <BarButton
        onClick={start}
        className="text-accent hover:text-accent"
        title={t('업데이트 {0} 다운로드 후 자동 설치', version ?? '')}
      >
        <Download size={15} />
      </BarButton>
    )
  }
  if (status === 'downloading') {
    return (
      <BarButton className="text-accent" title={t('업데이트 다운로드 중 {0}%', percent)} disabled>
        <Loader2 size={15} className="animate-spin" />
      </BarButton>
    )
  }
  if (status === 'downloaded') {
    return (
      <BarButton className="text-accent" title={t('업데이트 설치 — 재시작 중')} disabled>
        <Loader2 size={15} className="animate-spin" />
      </BarButton>
    )
  }
  return null
}

/** Anlas 잔액 + 예상 소모(-N). 토큰 미설정(잔액 없음)이면 표시하지 않음 */
function AnlasChips({
  balance,
  cost
}: {
  balance: number | null
  cost: number
}): React.JSX.Element | null {
  const t = useT()
  if (balance === null) return null
  return (
    <div className="no-drag mx-1 flex items-center gap-1">
      <span
        className="flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-muted"
        title={t('Anlas 잔액 (생성할 때마다 갱신)')}
      >
        <Coins size={12} className="text-[#c9a34f]" />
        {balance.toLocaleString()}
      </span>
      {cost > 0 && (
        <span
          className="rounded-md bg-danger px-2 py-0.5 font-mono text-[11.5px] font-medium text-white"
          title={t('이번 생성에 소모될 Anlas (고해상도 · 캐릭터 레퍼런스 · 미인코딩 바이브 포함)')}
        >
          -{cost}
        </span>
      )}
    </div>
  )
}

function OpusUsageChip(): React.JSX.Element | null {
  const t = useT()
  const usage = useGenerationStore((s) => s.opusUsage)
  const model = useGenerationStore((s) => s.request.model)
  if (!usage || !model.startsWith('nai-diffusion-5-')) return null
  const percent = displayOpusUsagePercent(usage)
  const hours = Math.max(0, usage.timeUntilNextPercent / 3600)
  return (
    <span
      className="no-drag flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-muted"
      title={
        usage.isNegative
          ? t('V5 충전 게이지 소진 — 충전될 때까지 Anlas 사용')
          : t('V5 Opus 충전 게이지 · 다음 1%까지 약 {0}시간', hours.toFixed(1))
      }
    >
      <BatteryCharging size={12} className={usage.isNegative ? 'text-danger' : 'text-accent'} />
      {percent}%
    </span>
  )
}

function BarButton({
  className,
  active,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }): React.JSX.Element {
  return (
    <button
      className={cn(
        'no-drag grid h-7 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:pointer-events-none',
        active && 'text-ink',
        className
      )}
      {...props}
    />
  )
}

export function Titlebar(): React.JSX.Element {
  const t = useT()
  const leftOpen = useLayoutStore((s) => s.leftOpen)
  const rightOpen = useLayoutStore((s) => s.rightOpen)
  const toggleLeft = useLayoutStore((s) => s.toggleLeft)
  const toggleRight = useLayoutStore((s) => s.toggleRight)
  const setSettingsOpen = useLayoutStore((s) => s.setSettingsOpen)
  const anlasBalance = useGenerationStore((s) => s.anlasBalance)
  const opusUsage = useGenerationStore((s) => s.opusUsage)

  // 이번 생성에 소모될 Anlas 추정 (고해상도·캐릭터 레퍼런스·미인코딩 바이브 등)
  const request = useGenerationStore((s) => s.request)
  const source = useGenerationStore((s) => s.source)
  const batchCount = useGenerationStore((s) => s.batchCount)
  const tier = useGenerationStore((s) => s.subscriptionTier)
  const enabledCrefs = useCharRefsStore((s) => s.items.filter((c) => c.enabled).length)
  const unencodedVibes = useVibesStore(
    (s) => s.items.filter((v) => v.enabled && !v.encodedModels?.includes(request.model)).length
  )
  const enabledVibes = useVibesStore((s) => s.items.filter((v) => v.enabled).length)
  const capabilities = modelCapabilities(request.model)
  const estimateModel = source?.maskBase64 ? inpaintingModelFor(request.model) : request.model
  const estimateSize = source
    ? snapNaiResolution(source.width, source.height)
    : { width: request.width, height: request.height }
  const anlasCost = estimateAnlas({
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
    isOpus: tier === 'opus',
    opusUsageExhausted: opusUsage?.isNegative,
    batchCount,
    vibeCount: capabilities.vibes ? enabledVibes : 0,
    unencodedVibes: capabilities.vibes ? unencodedVibes : 0
  }).total

  return (
    <header
      className="drag relative flex h-14 shrink-0 select-none items-center gap-1 bg-paper px-2"
      style={{ paddingLeft: isMac ? 90 : undefined }}
    >
      {/* 네비게이션 — 타이틀바 중앙 (컨테이너는 pointer-events-none, PageNav만 클릭 가능) */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <PageNav />
      </div>

      <BarButton onClick={toggleLeft} active={leftOpen} title={t('프롬프트 패널 접기/펴기')}>
        <PanelLeft size={15} />
      </BarButton>

      <UpdateButton />

      {import.meta.env.DEV && (
        <span
          className="no-drag ml-1 rounded-md border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-accent"
          title="Development mode"
        >
          DEV
        </span>
      )}

      {/* Windows는 우측에 창 컨트롤(─ □ ✕)이 있어 테마·Anlas를 좌측에 배치 */}
      {!isMac && (
        <>
          <div className="no-drag mx-0.5">
            <ThemeToggle />
          </div>
          <OpusUsageChip />
          <AnlasChips balance={anlasBalance} cost={anlasCost} />
        </>
      )}

      <div className="flex-1" />

      {isMac && <OpusUsageChip />}
      {isMac && <AnlasChips balance={anlasBalance} cost={anlasCost} />}

      <BarButton onClick={toggleRight} active={rightOpen} title={t('히스토리 패널 접기/펴기')}>
        <PanelRight size={15} />
      </BarButton>
      {isMac && (
        <div className="no-drag mx-0.5">
          <ThemeToggle />
        </div>
      )}
      <BarButton onClick={() => setSettingsOpen(true)} title={t('설정')}>
        <Settings size={15} />
      </BarButton>

      {!isMac && (
        <div className="no-drag ml-1 flex items-center">
          <BarButton className="w-9" onClick={() => ctrl('minimize')} aria-label={t('최소화')}>
            <Minus size={15} />
          </BarButton>
          <BarButton className="w-9" onClick={() => ctrl('maximize')} aria-label={t('최대화')}>
            <Square size={12} />
          </BarButton>
          <BarButton
            className="w-9 hover:bg-danger hover:text-white"
            onClick={() => ctrl('close')}
            aria-label={t('닫기')}
          >
            <X size={15} />
          </BarButton>
        </div>
      )}
    </header>
  )
}

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
  Ticket,
  X
} from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useGenerationStore } from '../stores/generation-store'
import { useLayoutStore } from '../stores/layout-store'
import { useUpdateStore } from '../stores/update-store'
import { useVibesStore, useCharRefsStore } from '../stores/refs-store'
import {
  displayOpusUsagePercent,
  effectiveGenerationStrength,
  estimateAnlas,
  formatOpusUsageRefill,
  opusUsagePurchasedPercent
} from '@shared/anlas'
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
        className="text-accent-ink hover:text-accent-ink"
        title={t('ui.downloadUpdateValueAndInstallAutomatically', version ?? '')}
      >
        <Download size={15} />
      </BarButton>
    )
  }
  if (status === 'downloading') {
    return (
      <BarButton
        className="text-accent-ink"
        title={t('ui.downloadingUpdateValue.773cde6', percent)}
        disabled
      >
        <Loader2 size={15} className="animate-spin" />
      </BarButton>
    )
  }
  if (status === 'downloaded') {
    return (
      <BarButton className="text-accent-ink" title={t('ui.installingUpdateRestarting')} disabled>
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
        title={t('ui.anlasBalanceUpdatesAfterEachGeneration')}
      >
        <Coins size={12} className="text-anlas" />
        {balance.toLocaleString()}
      </span>
      {cost > 0 && (
        <span
          className="rounded-md bg-danger px-2 py-0.5 font-mono text-[11.5px] font-medium text-on-danger"
          title={t('ui.anlasCostOfThisGenerationInclHighResolutionCharacterReferenceUneaa8754e')}
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
  const subscriptionTier = useGenerationStore((s) => s.subscriptionTier)
  const model = useGenerationStore((s) => s.request.model)
  if (subscriptionTier !== 'opus' || !usage || !model.startsWith('nai-diffusion-5-')) return null
  const percent = displayOpusUsagePercent(usage)
  const purchased = opusUsagePurchasedPercent(usage)
  const refill = formatOpusUsageRefill(usage, t)
  const status = usage.isNegative
    ? `${t('ui.v5RechargeGaugeDepletedAnlasIsUsedUntilItRecharges')} · ${refill}`
    : t('ui.v5OpusRechargeGaugeValue', refill)
  // 기본 게이지를 먼저 쓰고 추가 사용량은 그다음 — 소모 순서대로 왼쪽부터 놓는다.
  // 추가 사용량은 부스트 1개(100%)당 한 칸씩, 최대 400%라 네 칸 — 한 막대로 400%를 그리면
  // 부스트 1개가 1/4밖에 안 차 보인다.
  // 게이지까지 다 그리면 폭이 늘어 중앙 탭과 겹치므로, 2xl 미만 폭에서는 숫자만 남긴다.
  const meterVisibility = purchased > 0 ? 'hidden 2xl:block' : undefined
  const title = purchased > 0 ? `${status} · ${t('ui.v5ExtraUsageValue', purchased)}` : status
  return (
    <span
      className="no-drag flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-muted"
      title={title}
    >
      {/* 화면의 숫자만으로는 어느 쪽이 추가 사용량인지 알 수 없어, 스크린 리더에는 title과 같은
          설명을 숫자와 함께 읽히고 눈에 보이는 게이지·숫자는 숨긴다 */}
      <span className="sr-only">{`${t('ui.v5Usage')} ${percent}% · ${title}`}</span>
      <BatteryCharging
        size={12}
        className={usage.isNegative ? 'text-danger-ink' : 'text-accent-ink'}
      />
      <UsageMeter
        fill={percent / 100}
        className={cn('w-8', meterVisibility)}
        barClassName={usage.isNegative ? 'bg-danger' : 'bg-accent'}
      />
      <span aria-hidden>{percent}%</span>
      {purchased > 0 && (
        <>
          <span aria-hidden className="h-3 w-px bg-faint" />
          <Ticket size={12} className="text-hue-violet" />
          <span className="hidden gap-0.5 2xl:flex">
            {Array.from({ length: MAX_PURCHASED_PERCENT / 100 }, (_, index) => (
              <UsageMeter
                key={index}
                fill={(purchased - index * 100) / 100}
                className="w-3"
                barClassName="bg-hue-violet"
              />
            ))}
          </span>
          <span aria-hidden>{purchased}%</span>
        </>
      )}
    </span>
  )
}

/** NAI 웹 `MaxPurchasedPercent` — 추가 사용량 칸의 최대치 */
const MAX_PURCHASED_PERCENT = 400

function UsageMeter({
  fill,
  className,
  barClassName
}: {
  fill: number
  className: string
  barClassName: string
}): React.JSX.Element {
  // 빈 트랙(paper)은 칩 배경(surface-2)과 대비가 1.2:1뿐이라, 3:1이 보장된 faint 테두리로
  // 칸 경계를 그린다 — 추가 사용량 100%일 때 남은 칸도 보이도록
  return (
    <span
      aria-hidden
      className={cn(
        'h-1.5 overflow-hidden rounded-full bg-paper inset-ring inset-ring-faint',
        className
      )}
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
          barClassName
        )}
        style={{ width: `${Math.min(1, Math.max(0, fill)) * 100}%` }}
      />
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

/** 패널 접기/펴기 — 열림 상태는 여기서만 구독해 누를 때 타이틀 바 전체가 다시 그려지지 않게 한다 */
function PanelToggle({ side }: { side: 'left' | 'right' }): React.JSX.Element {
  const t = useT()
  const open = useLayoutStore((s) => (side === 'left' ? s.leftOpen : s.rightOpen))
  const toggle = useLayoutStore((s) => (side === 'left' ? s.toggleLeft : s.toggleRight))
  return side === 'left' ? (
    <BarButton onClick={toggle} active={open} title={t('ui.togglePromptPanel.6ab7472')}>
      <PanelLeft size={15} />
    </BarButton>
  ) : (
    <BarButton onClick={toggle} active={open} title={t('ui.toggleHistoryPanel.b5c0fb9')}>
      <PanelRight size={15} />
    </BarButton>
  )
}

/** 개발 서버로 띄운 창임을 표시 (배포 빌드엔 없음) */
function DevBadge(): React.JSX.Element | null {
  if (!import.meta.env.DEV) return null
  return (
    <span
      className="no-drag ml-1 rounded-md border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-accent-ink"
      title="Development mode"
    >
      DEV
    </span>
  )
}

/** 개발 서버 전용 — 온보딩을 다시 띄워 확인하는 테스트용 버튼 (배포 빌드엔 없음, 개발용이라 번역하지 않는다) */
function DevOnboardingButton(): React.JSX.Element | null {
  if (!import.meta.env.DEV) return null
  return (
    <BarButton
      className="w-auto px-2 text-[12px]"
      onClick={() => useLayoutStore.setState({ onboardingOpen: true })}
    >
      Force onboarding
    </BarButton>
  )
}

/** Windows 창 컨트롤(─ □ ✕). macOS는 시스템 신호등을 쓴다 */
function WindowControls(): React.JSX.Element {
  const t = useT()
  return (
    <div className="no-drag ml-1 flex items-center">
      <BarButton className="w-9" onClick={() => ctrl('minimize')} aria-label={t('ui.minimize')}>
        <Minus size={15} />
      </BarButton>
      <BarButton className="w-9" onClick={() => ctrl('maximize')} aria-label={t('ui.maximize')}>
        <Square size={12} />
      </BarButton>
      <BarButton
        className="w-9 hover:bg-window-close hover:text-white"
        onClick={() => ctrl('close')}
        aria-label={t('ui.close')}
      >
        <X size={15} />
      </BarButton>
    </div>
  )
}

export function Titlebar(): React.JSX.Element {
  const t = useT()
  const setSettingsOpen = useLayoutStore((s) => s.setSettingsOpen)
  const onboardingOpen = useLayoutStore((s) => s.onboardingOpen)
  const onboardingFinished = useLayoutStore((s) => s.onboardingFinished)
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

  // 첫 실행 온보딩 중엔 창 컨트롤(과 DEV 표시)만 — 앱 기능은 온보딩을 마친 뒤에 드러낸다.
  // 바탕은 투명하게 두어 온보딩 배경 무늬가 창 맨 위까지 이어지게 (배경보다 위에 그린다)
  if (onboardingOpen) {
    return (
      <header
        className="drag relative z-10 flex h-14 shrink-0 select-none items-center px-2"
        style={{ paddingLeft: isMac ? 90 : undefined }}
      >
        <DevBadge />
        <div className="flex-1" />
        {!isMac && <WindowControls />}
      </header>
    )
  }

  return (
    <motion.header
      className="drag relative flex h-14 shrink-0 select-none items-center gap-1 bg-paper px-2"
      style={{ paddingLeft: isMac ? 90 : undefined }}
      // 온보딩을 막 마쳤으면 작업 화면과 함께 페이드인
      initial={onboardingFinished ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* 네비게이션 — 타이틀바 중앙 (컨테이너는 pointer-events-none, PageNav만 클릭 가능) */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <PageNav />
      </div>

      <PanelToggle side="left" />

      <UpdateButton />

      <DevBadge />
      <DevOnboardingButton />

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

      <PanelToggle side="right" />
      {isMac && (
        <div className="no-drag mx-0.5">
          <ThemeToggle />
        </div>
      )}
      <BarButton onClick={() => setSettingsOpen(true)} title={t('ui.settings')}>
        <Settings size={15} />
      </BarButton>

      {!isMac && <WindowControls />}
    </motion.header>
  )
}

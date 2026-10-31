import {
  ArrowLeft,
  Download,
  FolderOpen,
  KeyRound,
  Languages,
  Palette,
  Sparkles,
  TextCursorInput,
  type LucideIcon
} from 'lucide-react'
import {
  AnimatePresence,
  motion,
  MotionConfig,
  type MotionProps,
  type Variants
} from 'motion/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type RefObject
} from 'react'
import type { MessageId } from '@shared/i18n'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { useLayoutStore } from '../../stores/layout-store'
import { Button } from '../ui/button'
import { AccountStep } from './account-step'
import { AppearanceStep } from './appearance-step'
import { OnboardingBackdrop } from './backdrop'
import { ImportStep } from './import-step'
import { IntroContext } from './intro-context'
import { IntroLogo } from './intro-logo'
import { LanguageStep } from './language-step'
import { StepHeading, type StepProps } from './parts'
import { PromptStep } from './prompt-step'
import { StorageStep } from './storage-step'
import { TipsStep } from './tips-step'

const STEPS = [
  'welcome',
  'language',
  'appearance',
  'prompt',
  'storage',
  'account',
  'import',
  'tips'
] as const
type Step = (typeof STEPS)[number]

/**
 * 단계마다 머리(아이콘·제목)와 본문. 본문이 없는 소개 화면은 머리만 가운데 둔다.
 * gated 단계는 마쳐야 '다음'이 열리고, 대신 '건너뛰기'로 이 단계만 넘길 수 있다
 */
const STEP_VIEWS: Record<
  Step,
  {
    icon: LucideIcon | React.ReactElement
    title: MessageId
    View?: ComponentType<StepProps>
    gated?: boolean
  }
> = {
  welcome: {
    icon: <IntroLogo />,
    title: 'ui.onboardingWelcomeTitle'
  },
  language: { icon: Languages, title: 'ui.onboardingLanguageTitle', View: LanguageStep },
  appearance: { icon: Palette, title: 'ui.onboardingAppearanceTitle', View: AppearanceStep },
  prompt: { icon: TextCursorInput, title: 'ui.onboardingPromptTitle', View: PromptStep },
  storage: { icon: FolderOpen, title: 'ui.onboardingStorageTitle', View: StorageStep },
  account: { icon: KeyRound, title: 'ui.onboardingAccountTitle', View: AccountStep, gated: true },
  import: { icon: Download, title: 'ui.onboardingImportTitle', View: ImportStep, gated: true },
  tips: { icon: Sparkles, title: 'ui.onboardingTipsTitle', View: TipsStep }
}

/** 브라우저판은 저장 위치가 다운로드 폴더로 정해져 있어 저장 단계를 뺀다 */
function stepsForRuntime(): readonly Step[] {
  return window.nais.runtime === 'browser' ? STEPS.filter((s) => s !== 'storage') : STEPS
}

/**
 * 새 설치 첫 실행 온보딩. 소개 → 언어 → 모양(모드·팔레트) → 프롬프트 칸 → 저장 → NAI 토큰 → 기존 데이터
 * → 기본 사용법 순서.
 * macOS 설정 지원처럼 넓은 창 + 가운데 큰 아이콘·제목, 이동 버튼은 아래 양 끝.
 * 처음 뜰 때는 로고 두 조각이 카드 한가운데서 맞물려 조립되고, 로고가 제자리로 옮겨 앉은 뒤에 카드
 * 바탕·제목·버튼·배경이 차례로 나타난다.
 * 온보딩 전체는 위쪽 '온보딩 생략'으로 언제든 끝낼 수 있고, 계정 연결처럼 마쳐야 넘어가는
 * 단계만 '건너뛰기'를 따로 둔다. 같은 항목은 설정에서 다시 바꿀 수 있다.
 */
export function Onboarding(): React.JSX.Element {
  const t = useT()
  const finish = useLayoutStore((s) => s.finishOnboarding)
  const [steps] = useState(stepsForRuntime)
  const [index, setIndex] = useState(0)
  // 슬라이드 방향 (다음 = 1, 뒤로 = -1)
  const [direction, setDirection] = useState(1)
  // 백업 복원 중엔 단계 이동·종료를 막는다 — 복원이 뒤늦게 끝나며 테이블을 통째로 바꾸므로
  // 그 사이 작업 화면에서 만든 항목이 사라질 수 있다
  const [busy, setBusy] = useState(false)
  // 한 번이라도 단계를 옮긴 뒤엔 새 단계 제목으로 포커스를 넘긴다 (첫 화면은 그대로)
  const [navigated, setNavigated] = useState(false)
  // 계정을 연결했거나 데이터를 불러온 단계 — 그 단계의 '다음'이 열린다
  const [done, setDone] = useState<Partial<Record<Step, boolean>>>({})
  // 마치거나 생략하면 카드를 먼저 흐리게 빼고, 다 사라진 뒤에 작업 화면으로 넘긴다
  const [leaving, setLeaving] = useState(false)
  const leave = (): void => setLeaving(true)
  // 소개 로고가 조립돼 제자리에 앉았는지 — 그 전엔 로고만 보이고 나머지는 숨겨 둔다
  const [revealed, setRevealed] = useState(false)
  const reveal = useCallback(() => setRevealed(true), [])
  // 위아래 테두리(머리·발) 높이 차 — 소개 화면을 카드 정중앙에 두는 데 쓴다
  const headerRef = useRef<HTMLElement>(null)
  const footerRef = useRef<HTMLElement>(null)
  const chromeOffset = useHeightGap(headerRef, footerRef)
  const zoom = useLargeScreenZoom()
  const step = steps[index]
  const { icon, title, View, gated } = STEP_VIEWS[step]
  const blocked = gated && !done[step]
  const last = index === steps.length - 1
  const markDone = useCallback(() => setDone((d) => (d[step] ? d : { ...d, [step]: true })), [step])

  const go = (delta: number): void => {
    setNavigated(true)
    setDirection(delta)
    setIndex((i) => Math.min(steps.length - 1, Math.max(0, i + delta)))
  }

  return (
    <MotionConfig reducedMotion="user">
      <IntroContext.Provider value={{ revealed, reveal }}>
        <div className="relative flex min-h-0 flex-1">
          {/* 무늬 수십 개가 끝없이 움직이므로 로고가 앉은 뒤에 붙인다 — 조립 중엔 메인 스레드를 비워 둔다 */}
          {revealed && (
            <OnboardingBackdrop progress={index / (steps.length - 1)} leaving={leaving} />
          )}
          <motion.div
            className={cn(
              'relative flex min-h-0 flex-1 items-center justify-center',
              'px-3 pb-6 pt-2 sm:px-8 sm:pb-12 sm:pt-6 short:pb-4 short:pt-1',
              leaving && 'pointer-events-none'
            )}
            // 첫 등장은 안쪽 요소들이 각자 맡는다 — 여기서 투명도를 건드리면 로고까지 같이 가려진다
            initial={false}
            animate={leaving ? LEAVE : SHOWN}
            onAnimationComplete={() => leaving && finish()}
          >
            <section
              aria-label={t('ui.onboardingWelcomeTitle')}
              className="relative isolate flex h-full max-h-[720px] w-full max-w-[880px] flex-col overflow-hidden rounded-2xl"
              style={{ zoom }}
            >
              {/* 카드 바탕 — 로고가 앉은 뒤에 드러난다. 내용 뒤에 깔리도록 맨 아래 층 */}
              <motion.div
                aria-hidden
                className="absolute inset-0 -z-10 rounded-2xl border border-line bg-surface shadow-xl"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={revealed ? { opacity: 1, scale: 1 } : undefined}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
              <motion.header
                ref={headerRef}
                className="flex h-12 shrink-0 items-center justify-end px-3 pt-2 sm:px-5"
                // 드러나기 전엔 보이지 않는 버튼이 눌리거나 Tab으로 잡히지 않게
                inert={!revealed}
                {...chromeIn(revealed)}
              >
                {!last && (
                  <Button
                    variant="ghost"
                    size="lg"
                    className="text-[15px] text-muted"
                    disabled={busy}
                    onClick={leave}
                  >
                    {t('ui.onboardingSkipAll')}
                  </Button>
                )}
              </motion.header>
              <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
                <AnimatePresence mode="wait" initial={false} custom={direction}>
                  <motion.div
                    key={step}
                    custom={direction}
                    variants={SLIDE}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className={cn(
                      'm-auto flex w-full max-w-[720px] flex-col items-center px-5 pb-6 pt-2 sm:px-10 sm:pt-4 short:pb-4 short:pt-0',
                      // 팁은 두 단 글이 길어 다른 단계보다 넓게
                      step === 'tips' && 'max-w-[800px]'
                    )}
                    // 소개 화면은 내용이 적어 치우침이 눈에 띈다 — 머리·발 높이 차만큼 반대쪽에 여백을
                    // 두어 스크롤 영역이 아니라 카드 기준으로 가운데 오게
                    style={
                      step === 'welcome'
                        ? {
                            paddingTop: Math.max(0, chromeOffset),
                            paddingBottom: Math.max(0, -chromeOffset)
                          }
                        : undefined
                    }
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <StepHeading icon={icon} title={t(title)} focusOnMount={navigated} />
                    {View && (
                      <View
                        done={!!done[step]}
                        onDone={markDone}
                        busy={busy}
                        onBusyChange={setBusy}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              <motion.footer
                ref={footerRef}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 pb-5 pt-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:px-10 sm:pb-7"
                inert={!revealed}
                {...chromeIn(revealed)}
              >
                <div className="flex justify-start">
                  {index > 0 ? (
                    <Button
                      variant="ghost"
                      size="lg"
                      className={cn(FOOTER_BUTTON, 'gap-2')}
                      disabled={busy}
                      onClick={() => go(-1)}
                    >
                      <ArrowLeft size={17} /> {t('ui.back')}
                    </Button>
                  ) : (
                    <span className="text-[15px] text-muted">
                      {t('ui.onboardingSettingsLater')}
                    </span>
                  )}
                </div>
                <ol
                  className="order-first flex w-full items-center justify-center gap-2 sm:order-none sm:w-auto"
                  aria-label={t('ui.onboardingStepOf', index + 1, steps.length)}
                >
                  {steps.map((s, i) => (
                    <li
                      key={s}
                      aria-current={i === index ? 'step' : undefined}
                      className={cn(
                        'size-2 rounded-full transition-colors duration-300',
                        i === index ? 'bg-ink' : 'bg-line'
                      )}
                    />
                  ))}
                </ol>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {blocked && (
                    <Button
                      variant="ghost"
                      size="lg"
                      className={FOOTER_BUTTON}
                      disabled={busy}
                      onClick={() => go(1)}
                    >
                      {t('ui.onboardingSkip')}
                    </Button>
                  )}
                  <Button
                    variant="accent"
                    size="lg"
                    className={cn(FOOTER_BUTTON, 'min-w-[160px]')}
                    disabled={busy || blocked}
                    onClick={last ? leave : () => go(1)}
                  >
                    {index === 0
                      ? t('ui.onboardingStart')
                      : last
                        ? t('ui.onboardingFinish')
                        : t('ui.onboardingNext')}
                  </Button>
                </div>
              </motion.footer>
            </section>
          </motion.div>
        </div>
      </IntroContext.Provider>
    </MotionConfig>
  )
}

const FOOTER_BUTTON = 'h-12 px-7 text-[17px]'

/**
 * 넓은 화면(QHD 100%·UHD 150% 이상)에서 카드가 작아 보이지 않게 키우는 배율. 창이 ZOOM_BASE보다
 * 커진 만큼 비례해 키우되 ZOOM_MAX에서 멈춘다. CSS zoom은 퍼센트 높이를 부모 기준 그대로 두어서
 * 카드가 창보다 커지지는 않는다
 */
function useLargeScreenZoom(): number {
  const [zoom, setZoom] = useState(zoomFor)
  useEffect(() => {
    const onResize = (): void => setZoom(zoomFor())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return zoom
}

const ZOOM_BASE = { width: 1760, height: 1100 }
const ZOOM_MAX = 1.25

function zoomFor(): number {
  const fit = Math.min(window.innerWidth / ZOOM_BASE.width, window.innerHeight / ZOOM_BASE.height)
  return Math.min(ZOOM_MAX, Math.max(1, fit))
}

/** 아래 요소 높이 − 위 요소 높이. 창 크기에 따라 발이 두 줄로 접히기도 해서 계속 잰다 */
function useHeightGap(
  top: RefObject<HTMLElement | null>,
  bottom: RefObject<HTMLElement | null>
): number {
  const [gap, setGap] = useState(0)
  useLayoutEffect(() => {
    const measure = (): void =>
      setGap((bottom.current?.offsetHeight ?? 0) - (top.current?.offsetHeight ?? 0))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    for (const el of [top.current, bottom.current]) if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [top, bottom])
  return gap
}

const SHOWN = { opacity: 1, scale: 1 } as const
// 마칠 때 — 빠르게 흐려지며 빠진다
const LEAVE = {
  opacity: 0,
  scale: 0.97,
  transition: { duration: 0.28, ease: [0.4, 0, 1, 1] }
} as const

/** 머리·발 — 로고가 앉고 카드 바탕이 깔리기 시작한 뒤에 들어온다 (다시 마운트되지 않아 처음 한 번뿐) */
function chromeIn(revealed: boolean): MotionProps {
  return {
    initial: { opacity: 0, y: 10 },
    animate: revealed ? { opacity: 1, y: 0 } : undefined,
    transition: { duration: 0.6, delay: 0.25, ease: [0.22, 1, 0.36, 1] }
  }
}

// 단계 전환 슬라이드 — 방향은 AnimatePresence의 custom으로 받는다. 나가는 단계는 들어올 때의
// props를 그대로 들고 있어서, 방향을 바꿔 이동하면 반대쪽으로 빠지기 때문
const SLIDE: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 32 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -32 })
}

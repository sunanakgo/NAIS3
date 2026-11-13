import {
  animate,
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
  type Transition
} from 'motion/react'
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { HistoryPanel } from './components/history-panel'
import { LoadingScreen } from './components/loading-screen'
import { Toaster } from './components/toaster'
import { PreviewPane } from './components/preview-pane'
import { DirectorMode } from './components/director-mode'
import { InpaintHost } from './components/inpaint-host'
import { LibraryMode } from './components/library-mode'
import { ArtistTagsDialog } from './components/artist-tags-dialog'
import { MetadataDialog } from './components/metadata-dialog'
import { SidePageHost } from './components/side-page-host'
import { PromptPanel } from './components/prompt-panel'
import { SceneMode } from './components/scene-mode'
import { Titlebar } from './components/titlebar'
import { SettingsDialog } from './components/token-dialog'
import { TextPromptHost } from './components/text-prompt-host'
import { FragmentEditorDialog } from './components/fragment-editor-dialog'
import { WebSearchMode } from './components/web-search-mode'
import { TooltipProvider } from './components/ui/tooltip'
import { useCharactersStore } from './stores/characters-store'
import { useDirectorStore } from './stores/director-store'
import { useFragmentsStore } from './stores/fragments-store'
import { useCharRefsStore, useVibesStore } from './stores/refs-store'
import { bindGenerationEvents, useGenerationStore } from './stores/generation-store'
import { bindSceneEvents } from './stores/scenes-store'
import { bindShortcuts, useShortcutsStore } from './stores/shortcuts-store'
import { bindUpdateEvents } from './stores/update-store'
import { bindNavMouse } from './lib/nav-history'
import { useLanguageStore } from './lib/i18n'
import {
  behind,
  edgeShadow,
  FRONT,
  PAGE_SWAP,
  PAGE_TURN,
  RECEDE_SHIFT,
  RECEDE_STYLE
} from './lib/page-turn'
import { cn } from './lib/utils'
import { useWebSearchKeepAlive } from './lib/websearch-keep-alive'
import { useLayoutStore } from './stores/layout-store'
import { useThemeStore } from './stores/theme-store'

// 좌우 패널 접기/펴기 — 페이지 넘김(SidePageHost)과 같은 연출 (lib/page-turn).
// 메인 영역이 가장자리 그림자를 달고 넓어지며 패널을 덮고, 패널은 바깥쪽으로 조금 밀리며 작아지고 흐려진다.
// 바깥 칸은 차지하는 폭만 줄이고, 안의 패널은 바깥쪽 벽에 붙은 채 원래 폭 그대로 메인 아래로 들어간다.
// 칸 사이 간격(SidePageHost의 gap-3)도 음수 여백으로 같이 접어야 마지막에 12px 툭 끊기지 않는다
const PANEL_GAP = 12
// 물러나는 패널은 칸의 바깥쪽 벽 너머 창 가장자리 여백(px-3)까지 밀려나는데, 메인은 그 여백을 덮지 않아
// 접히는 동안 흐린 패널 조각이 창 끝에 비친다. 바깥쪽 벽에서만 잘라 내고 나머지 방향은 그대로 둔다
const CLIP_OUTER_LEFT = { clipPath: 'inset(-100vh -100vw -100vh 0)' } as const
const CLIP_OUTER_RIGHT = { clipPath: 'inset(-100vh 0 -100vh -100vw)' } as const

// 새 설치 첫 실행에만 뜨므로 평소 실행에선 읽지 않는다. React.lazy는 쓰지 않는다 — 미리 불러 둔
// 모듈이어도 첫 렌더에서 한 번 멈추고, Suspense가 다시 그리기를 300ms가량 미뤄 첫 등장이 늦어진다
const loadOnboarding = (): Promise<ComponentType> =>
  import('./components/onboarding').then((m) => m.Onboarding)

export default function App(): React.JSX.Element {
  const settingsOpen = useLayoutStore((s) => s.settingsOpen)
  const setSettingsOpen = useLayoutStore((s) => s.setSettingsOpen)
  const centerMode = useLayoutStore((s) => s.centerMode)
  const onboardingOpen = useLayoutStore((s) => s.onboardingOpen)
  const webHidden = useLayoutStore((s) => s.hiddenPages.includes('websearch'))
  // 숨긴 웹 탭은 <webview>를 내리므로, 어떤 경로로든 그 모드에 오면 빈 화면 대신 미리보기를 보여 준다
  const webActive = centerMode === 'websearch' && !webHidden
  const webMounted = useWebSearchKeepAlive(webActive)
  const [ready, setReady] = useState(false)
  const [OnboardingView, setOnboardingView] = useState<ComponentType | null>(null)

  // 시작 뒤에 온보딩을 여는 경우(개발용 다시 보기)에는 그때 불러온다
  useEffect(() => {
    if (!onboardingOpen || OnboardingView) return
    let alive = true
    void loadOnboarding().then((View) => alive && setOnboardingView(() => View))
    return () => {
      alive = false
    }
  }, [onboardingOpen, OnboardingView])

  useEffect(() => {
    // 초기 하이드레이션 — 완료되면 로딩 스플래시 해제
    void (async () => {
      await Promise.allSettled([
        useLanguageStore.getState().hydrate(),
        useThemeStore.getState().hydrate(),
        // 온보딩 화면은 스플래시 뒤에서 미리 불러 둔다 — 스플래시가 걷힌 뒤에야 읽기 시작하면
        // (새 설치는 코드 캐시도 없다) 빈 화면이 잠깐 비치고 카드의 첫 등장 애니메이션이 끊긴다
        useLayoutStore
          .getState()
          .hydrate()
          .then(async () => {
            if (!useLayoutStore.getState().onboardingOpen) return
            const View = await loadOnboarding()
            setOnboardingView(() => View)
          }),
        useGenerationStore.getState().hydrate(),
        useCharactersStore.getState().load(),
        useFragmentsStore.getState().load(),
        useVibesStore.getState().load(),
        useCharRefsStore.getState().load(),
        useShortcutsStore.getState().hydrate(),
        useDirectorStore.getState().hydrate()
      ])
      // 스플래시가 너무 순식간에 사라지지 않게 최소 표시 시간 확보
      setTimeout(() => setReady(true), 350)
    })()
    const unbindGen = bindGenerationEvents()
    const unbindScene = bindSceneEvents()
    const unbindKeys = bindShortcuts()
    const unbindUpdate = bindUpdateEvents()
    const unbindNav = bindNavMouse() // 마우스 4/5번 버튼 뒤로/앞으로
    // F5 새로고침 (프로덕션에서도)
    const onF5 = (e: KeyboardEvent): void => {
      if (e.key === 'F5') {
        e.preventDefault()
        window.location.reload()
      }
    }
    window.addEventListener('keydown', onF5)
    return () => {
      unbindGen()
      unbindScene()
      unbindKeys()
      unbindUpdate()
      unbindNav()
      window.removeEventListener('keydown', onF5)
    }
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-paper">
        <Titlebar />
        {/* 새 설치 첫 실행 — 작업 영역 자리에 표시 (타이틀바의 창 컨트롤은 그대로).
            스플래시가 걷힐 때 마운트해야 첫 등장 애니메이션이 가려지지 않는다 */}
        {onboardingOpen && ready && OnboardingView && <OnboardingView />}
        {/* 온보딩을 마치면 카드가 빠진 뒤 작업 화면이 페이드인 (평소 시작에는 애니메이션 없음) */}
        <motion.div
          className={cn('flex min-h-0 flex-1 flex-col', onboardingOpen && 'hidden')}
          initial={false}
          animate={{ opacity: onboardingOpen ? 0 : 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <SidePageHost>
            <LeftPanel />
            {/* 접히는 패널이 이 아래로 들어간다 — 바탕을 칠하고 위에 쌓아 패널을 가린다 */}
            <main className="relative z-10 flex min-h-0 min-w-0 flex-1 bg-paper">
              <CoverShadow side="left" />
              <CoverShadow side="right" />
              {centerMode === 'scene' ? (
                <SceneMode />
              ) : centerMode === 'director' ? (
                <DirectorMode />
              ) : centerMode === 'library' ? (
                <LibraryMode />
              ) : webActive ? null : (
                <PreviewPane />
              )}
              {webMounted && (
                // 떠나 있는 동안은 display:none(Electron webview의 기본 [hidden] 스타일과 같음) —
                // 게스트 프레임이 '안 보임'이 되어 그리기를 멈추고 백그라운드 타이머 제한을 받는다
                <div className={cn('absolute inset-0 flex', !webActive && 'hidden')}>
                  <WebSearchMode active={webActive} />
                </div>
              )}
            </main>
            <RightPanel />
          </SidePageHost>
        </motion.div>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <TextPromptHost />
        <FragmentEditorDialog />
        <InpaintHost />
        <MetadataDialog />
        <ArtistTagsDialog />
        <Toaster />
        <AnimatePresence>{!ready && <LoadingScreen key="loading" />}</AnimatePresence>
      </div>
    </TooltipProvider>
  )
}

/**
 * 프롬프트 패널 칸. 열림·폭 구독을 App이 아니라 여기서 해야 접고 펼 때(폭 드래그 중엔 매 이동마다)
 * 메인 영역과 히스토리까지 다시 그려지지 않는다 — 접기 첫 프레임이 그 렌더 때문에 끊겼다
 */
function LeftPanel(): React.JSX.Element {
  const leftOpen = useLayoutStore((s) => s.leftOpen)
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth)
  const [resizing, setResizing] = useState(false)

  // 사이드바 폭 드래그 조절
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    setResizing(true)
    const startX = e.clientX
    const startW = useLayoutStore.getState().sidebarWidth
    const onMove = (ev: MouseEvent): void =>
      useLayoutStore.getState().setSidebarWidth(startW + (ev.clientX - startX))
    const onUp = (): void => {
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const transition = usePanelTransition()

  return (
    <AnimatePresence initial={false}>
      {leftOpen && (
        <motion.div
          key="left"
          className="relative h-full shrink-0"
          style={CLIP_OUTER_LEFT}
          initial={{ width: 0, marginRight: -PANEL_GAP }}
          animate={{ width: sidebarWidth, marginRight: 0 }}
          exit={{ width: 0, marginRight: -PANEL_GAP }}
          // 드래그 중엔 즉시 반영 (애니메이션이 따라오면 답답함)
          transition={resizing ? PAGE_SWAP : transition}
        >
          <PanelBody
            shift={-RECEDE_SHIFT}
            transition={transition}
            style={{ width: sidebarWidth }}
            className="absolute inset-y-0 left-0"
          >
            <PromptPanel />
            {/* 폭 조절 핸들 */}
            <div
              className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-accent/30"
              onMouseDown={startResize}
            />
          </PanelBody>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 히스토리 패널 칸 — LeftPanel과 같은 이유로 열림 구독을 따로 둔다 */
function RightPanel(): React.JSX.Element {
  const rightOpen = useLayoutStore((s) => s.rightOpen)
  const transition = usePanelTransition()
  return (
    <AnimatePresence initial={false}>
      {rightOpen && (
        <motion.div
          key="right"
          className="relative h-full shrink-0"
          style={CLIP_OUTER_RIGHT}
          initial={{ width: 0, marginLeft: -PANEL_GAP }}
          animate={{ width: 240, marginLeft: 0 }}
          exit={{ width: 0, marginLeft: -PANEL_GAP }}
          transition={transition}
        >
          <PanelBody
            shift={RECEDE_SHIFT}
            transition={transition}
            className="absolute inset-y-0 right-0 w-[240px]"
          >
            <HistoryPanel />
          </PanelBody>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function usePanelTransition(): Transition {
  return useReducedMotion() ? PAGE_SWAP : PAGE_TURN
}

/**
 * 패널 본체 — 접히면 덮이며 바깥쪽으로 물러나고, 펴지면 앞으로 나온다.
 * 칸의 variants를 물려받게 하면 빠르게 접었다 펴기를 반복할 때 칸은 펴졌는데 본체만 물러난 채
 * 멈추곤 했다. 그래서 본체는 칸이 남아 있는지(useIsPresent)를 보고 제 목표를 직접 정한다
 */
function PanelBody({
  shift,
  transition,
  className,
  style,
  children
}: {
  shift: number
  transition: Transition
  className: string
  style?: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  const present = useIsPresent()
  return (
    <motion.div
      className={cn('bg-paper', className)}
      style={{ ...RECEDE_STYLE, ...style }}
      initial={behind(shift)}
      animate={present ? FRONT : behind(shift)}
      transition={transition}
    >
      {children}
    </motion.div>
  )
}

/**
 * 메인 영역이 패널을 덮을 때 패널 쪽 가장자리에 드리우는 그림자 — 넘기는 페이지의 그림자와 같다.
 * 투명한 판의 바깥 그림자만 보이게 해서 메인 안쪽은 어두워지지 않는다. 다 펴지거나 접힌 뒤엔
 * 패널·여백에 그림자가 남지 않도록 움직이는 동안만 짙어졌다가 사라진다
 */
function CoverShadow({ side }: { side: 'left' | 'right' }): React.JSX.Element {
  const open = useLayoutStore((s) => (side === 'left' ? s.leftOpen : s.rightOpen))
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (reduced || !ref.current) return
    const shade = animate(
      ref.current,
      { opacity: [0, 1, 1, 0] },
      { duration: PAGE_TURN.duration, ease: 'linear', times: [0, 0.08, 0.5, 1] }
    )
    return () => shade.stop()
  }, [open, reduced])

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-xl opacity-0"
      style={{
        boxShadow: edgeShadow(side),
        // 위아래·반대쪽으로 번지는 그림자는 잘라 낸다
        clipPath: side === 'left' ? 'inset(0 0 0 -64px)' : 'inset(0 -64px 0 0)'
      }}
    />
  )
}

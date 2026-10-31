import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ComponentType } from 'react'
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
import { cn } from './lib/utils'
import { useLayoutStore } from './stores/layout-store'
import { useThemeStore } from './stores/theme-store'

// 새 설치 첫 실행에만 뜨므로 평소 실행에선 읽지 않는다. React.lazy는 쓰지 않는다 — 미리 불러 둔
// 모듈이어도 첫 렌더에서 한 번 멈추고, Suspense가 다시 그리기를 300ms가량 미뤄 첫 등장이 늦어진다
const loadOnboarding = (): Promise<ComponentType> =>
  import('./components/onboarding').then((m) => m.Onboarding)

export default function App(): React.JSX.Element {
  const leftOpen = useLayoutStore((s) => s.leftOpen)
  const rightOpen = useLayoutStore((s) => s.rightOpen)
  const settingsOpen = useLayoutStore((s) => s.settingsOpen)
  const setSettingsOpen = useLayoutStore((s) => s.setSettingsOpen)
  const centerMode = useLayoutStore((s) => s.centerMode)
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth)
  const onboardingOpen = useLayoutStore((s) => s.onboardingOpen)
  const [ready, setReady] = useState(false)
  const [OnboardingView, setOnboardingView] = useState<ComponentType | null>(null)
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
            <AnimatePresence initial={false}>
              {leftOpen && (
                <motion.div
                  key="left"
                  className="relative h-full shrink-0 overflow-hidden"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: sidebarWidth, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  // 드래그 중엔 즉시 반영 (애니메이션이 따라오면 답답함)
                  transition={
                    resizing ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                  }
                >
                  <div style={{ width: sidebarWidth }} className="h-full">
                    <PromptPanel />
                  </div>
                  {/* 폭 조절 핸들 */}
                  <div
                    className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-accent/30"
                    onMouseDown={startResize}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <main className="flex min-h-0 min-w-0 flex-1">
              {centerMode === 'scene' ? (
                <SceneMode />
              ) : centerMode === 'director' ? (
                <DirectorMode />
              ) : centerMode === 'library' ? (
                <LibraryMode />
              ) : centerMode === 'websearch' ? (
                <WebSearchMode />
              ) : (
                <PreviewPane />
              )}
            </main>
            <AnimatePresence initial={false}>
              {rightOpen && (
                <motion.div
                  key="right"
                  className="h-full shrink-0 overflow-hidden"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 240, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <HistoryPanel />
                </motion.div>
              )}
            </AnimatePresence>
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

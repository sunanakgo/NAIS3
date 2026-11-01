import { Globe, Image, LayoutGrid, Library, Wand2, type LucideIcon } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MessageId } from '@shared/i18n'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useLayoutStore, type CenterMode } from '../stores/layout-store'

type Page = CenterMode

const PAGES: { id: Page; label: MessageId; icon: LucideIcon }[] = [
  { id: 'main', label: 'ui.main', icon: Image },
  { id: 'scene', label: 'ui.scene', icon: LayoutGrid },
  { id: 'director', label: 'ui.director', icon: Wand2 },
  { id: 'library', label: 'ui.library', icon: Library },
  { id: 'websearch', label: 'ui.web', icon: Globe }
]

/**
 * 감쇠비 0.8 스프링(살짝 튕기는 정도)을 CSS `linear()` 이징으로 샘플링한다 —
 * JS 스프링과 달리 WAAPI 이징으로 넘기면 컴포지터가 혼자 끝까지 재생한다.
 */
const SPRING_DURATION = 500
const SPRING_EASING = ((): string => {
  const zeta = 0.8
  const omega = 6.9 / (zeta * (SPRING_DURATION / 1000)) // 끝에서 오차 0.1% 이하로 수렴
  const omegaD = omega * Math.sqrt(1 - zeta * zeta)
  const points: string[] = []
  const steps = 40
  for (let i = 0; i <= steps; i++) {
    const t = ((SPRING_DURATION / 1000) * i) / steps
    const x =
      i === steps
        ? 1
        : 1 -
          Math.exp(-zeta * omega * t) *
            (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t))
    points.push(x.toFixed(4))
  }
  return `linear(${points.join(', ')})`
})()

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 상단 중앙 페이지 네비게이션 (NAIS2 AnimatedNavBar 이식).
 *
 * 활성 pill은 메인 스레드와 떨어져 움직여야 한다 — 페이지 전환은 큰 화면(라이브러리 그리드,
 * 웹 검색의 <webview> 등)을 통째로 마운트하므로 그동안 메인 스레드가 막히기 때문이다.
 * 그래서
 *  1. pill은 FLIP으로 transform만 WAAPI 애니메이션 → 시작만 되면 컴포지터가 재생한다.
 *  2. 클릭하면 pill부터 옮기고, 실제 페이지 전환(setCenterMode)은 그 프레임이 그려진 뒤로 미룬다.
 * (예전 motion layoutId 방식은 매 프레임 JS로 돌아서, 마운트가 끝날 때까지 pill이 멈췄다)
 */
export const PageNav = memo(function PageNav(): React.JSX.Element {
  const t = useT()
  const centerMode = useLayoutStore((s) => s.centerMode)
  const hiddenPages = useLayoutStore((s) => s.hiddenPages)
  const visible = PAGES.filter((p) => p.id === 'main' || !hiddenPages.includes(p.id))

  // 클릭 직후 ~ 실제 전환 전까지 pill이 먼저 가 있을 탭. 스토어가 바뀌면(우리 전환이든 단축키든) 버린다
  const [pending, setPending] = useState<{ id: Page; from: Page } | null>(null)
  if (pending && pending.from !== centerMode) setPending(null)
  const shown = pending?.id ?? centerMode

  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<Page, HTMLButtonElement>())
  const scheduled = useRef<{ frame: number; timer: number } | null>(null)

  function cancelScheduled(): void {
    if (!scheduled.current) return
    cancelAnimationFrame(scheduled.current.frame)
    clearTimeout(scheduled.current.timer)
    scheduled.current = null
  }
  useEffect(() => cancelScheduled, [])

  function select(id: Page): void {
    cancelScheduled()
    if (id === centerMode) {
      setPending(null)
      return
    }
    const from = centerMode
    setPending({ id, from })
    // rAF는 다음 페인트 직전, 그 안의 setTimeout은 페인트 직후 — pill 애니메이션이 컴포지터에
    // 넘어간 다음에 무거운 페이지 마운트를 시작한다
    const entry = { frame: 0, timer: 0 }
    entry.frame = requestAnimationFrame(() => {
      entry.timer = window.setTimeout(() => {
        scheduled.current = null
        // 그 사이 단축키 등으로 이미 다른 곳으로 갔다면 덮어쓰지 않는다
        if (useLayoutStore.getState().centerMode === from) {
          useLayoutStore.getState().setCenterMode(id)
        }
      }, 0)
    })
    scheduled.current = entry
  }

  // pill 배치. 위치/폭은 즉시 목표값으로 두고, 직전 모습에서 출발하는 transform만 애니메이션(FLIP)
  const place = (animate: boolean): void => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (!nav || !indicator) return
    const tab = tabRefs.current.get(shown)
    if (!tab) {
      indicator.style.opacity = '0'
      return
    }
    // 애니메이션 도중이면 지금 화면에 보이는 위치(transform 포함)에서 이어서 출발
    const navBox = nav.getBoundingClientRect()
    const before = indicator.getBoundingClientRect()
    const wasVisible = indicator.style.opacity === '1'
    for (const running of indicator.getAnimations()) running.cancel()

    const left = tab.offsetLeft
    const width = tab.offsetWidth
    indicator.style.transform = `translateX(${left}px)`
    indicator.style.width = `${width}px`
    indicator.style.opacity = '1'

    if (!animate || !wasVisible || before.width === 0 || prefersReducedMotion()) return
    const fromX = before.left - navBox.left - nav.clientLeft
    const scale = before.width / width
    if (Math.abs(fromX - left) < 0.5 && Math.abs(scale - 1) < 0.005) return
    indicator.animate(
      [
        { transform: `translateX(${fromX}px) scaleX(${scale})` },
        { transform: `translateX(${left}px)` }
      ],
      { duration: SPRING_DURATION, easing: SPRING_EASING }
    )
  }
  const placeRef = useRef(place)
  useLayoutEffect(() => {
    placeRef.current = place
  })

  const visibleKey = visible.map((p) => p.id).join(',')
  useLayoutEffect(() => {
    placeRef.current(true)
  }, [shown, visibleKey])

  // 언어 변경·폰트 로딩 등으로 탭 폭이 바뀌면 애니메이션 없이 다시 맞춘다.
  // (관찰 시작 직후의 첫 콜백이 진행 중인 애니메이션을 끊지 않도록 탭 전환 effect와 분리)
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const observer = new ResizeObserver(() => placeRef.current(false))
    observer.observe(nav)
    for (const tab of tabRefs.current.values()) observer.observe(tab)
    return () => observer.disconnect()
  }, [visibleKey])

  return (
    <nav
      ref={navRef}
      aria-label={t('ui.pages')}
      className="no-drag pointer-events-auto relative flex items-center gap-1 rounded-full border border-line/70 bg-surface/95 p-1 shadow-md backdrop-blur"
    >
      {/* 활성 pill — 움직이는 요소라 backdrop-filter는 두지 않는다(매 프레임 배경을 다시 흐리게 그림) */}
      <div
        ref={indicatorRef}
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-0 rounded-full border border-ink/10 bg-ink/[0.08] shadow-sm opacity-0 will-change-transform"
        style={{ transformOrigin: '0 0' }}
      />
      {visible.map((page) => {
        const active = shown === page.id
        return (
          <button
            key={page.id}
            ref={(el) => {
              if (el) tabRefs.current.set(page.id, el)
              else tabRefs.current.delete(page.id)
            }}
            onClick={() => select(page.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative z-10 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors',
              active ? 'text-ink' : 'text-muted hover:text-ink'
            )}
          >
            <span className="flex items-center gap-2">
              <page.icon className="size-4" />
              {t(page.label)}
            </span>
          </button>
        )
      })}
    </nav>
  )
})

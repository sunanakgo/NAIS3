import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
  type Transition
} from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import {
  behind,
  edgeShadow,
  FRONT,
  PAGE_SWAP,
  PAGE_TURN,
  RECEDE_SHIFT,
  RECEDE_STYLE
} from '../lib/page-turn'
import { useSidePageStore, type SidePage } from '../stores/side-page-store'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// 넘기는 장도 transform 문자열로 컴포지터에서 움직인다 (lib/page-turn). 두 장 모두 미리 별도 레이어로 올려
// 두고 배경을 칠한다 — 레티나에서 화면 전체(히스토리 썸네일·블러 포함)를 매 프레임 다시 그리면 몇 프레임밖에 안 보인다
const turned = (percent: number): string => `translateX(${percent}%)`
const LAYER_STYLE = { willChange: 'transform', boxShadow: edgeShadow('left') } as const
// 페이지가 덮어 올 때 작업 화면은 왼쪽으로 조금 물러나며 작아지고 흐려진다
const WORK_BEHIND = behind(-RECEDE_SHIFT)

// 열 때마다 새 장으로 — id로 키를 잡으면 덮이는 중에 같은 페이지를 다시 열 때 그 장이 되살아나
// 편집기 안 상태(모자이크의 칠한 칸 기록 등)가 이전 것 그대로 남는다. open이 넘긴 객체마다 번호를 매긴다
const pageKeys = new WeakMap<SidePage, number>()
let lastPageKey = 0
function pageKey(page: SidePage): number {
  let key = pageKeys.get(page)
  if (key == null) {
    key = ++lastPageKey
    pageKeys.set(page, key)
  }
  return key
}

/**
 * 타이틀 바 아래 영역을 한 장의 페이지로 다룬다 — side-page-store에 페이지가 열리면 옆으로 넘긴다.
 * 작업 화면(children)은 마운트된 채로 뒤로 물러나고 페이지가 그 위를 덮는다 — 상태(선택한 툴 등)가 유지된다.
 * 페이지 상태 구독을 여기로 모아 넘길 때 App 전체(프롬프트·히스토리 패널)가 다시 그려지지 않게 한다.
 * 작업 화면은 inert로 막히므로 포커스는 열린 페이지로 옮기고, 닫으면 페이지를 연 컨트롤로 돌려준다.
 */
export function SidePageHost({ children }: { children: React.ReactNode }): React.JSX.Element {
  const page = useSidePageStore((s) => s.page)
  // 페이지가 다 넘어간 뒤에야 ready — 무거운 계산을 넘김과 같이 돌리면 메인 스레드가 막혀 끊긴다
  const [turnedTo, setTurnedTo] = useState<SidePage | null>(null)
  const transition = useReducedMotion() ? PAGE_SWAP : PAGE_TURN
  const opener = useRef<HTMLElement | null>(null)

  // 페이지를 연 컨트롤 — 작업 화면이 inert가 되며 포커스를 잃기 전에 기억해 둔다
  useEffect(
    () =>
      useSidePageStore.subscribe((s, prev) => {
        if (s.page && !prev.page) {
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
        }
      }),
    []
  )
  // 닫히면 돌려준다 — 작업 화면의 inert가 풀린 뒤라 포커스를 받을 수 있다
  useEffect(() => {
    if (page || !opener.current) return
    if (opener.current.isConnected) opener.current.focus({ preventScroll: true })
    opener.current = null
  }, [page])

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <motion.div
        className="absolute inset-0 flex gap-3 bg-paper px-3 pb-3"
        style={RECEDE_STYLE}
        initial={false}
        animate={page ? WORK_BEHIND : FRONT}
        transition={transition}
        inert={!!page}
      >
        {children}
      </motion.div>
      <AnimatePresence
        initial={false}
        // 덮인 페이지를 계속 쥐고 있지 않게 — render가 연 이미지(base64)를 붙잡고 있다
        onExitComplete={() =>
          setTurnedTo((t) => (t === useSidePageStore.getState().page ? t : null))
        }
      >
        {page && (
          <PageLayer
            key={pageKey(page)}
            transition={transition}
            onTurned={() => {
              // 덮이며 끝난 애니메이션(exit)은 무시 — 지금 열려 있는 페이지만 ready로
              if (useSidePageStore.getState().page === page) setTurnedTo(page)
            }}
          >
            {page.render({
              ready: turnedTo === page,
              close: () => useSidePageStore.getState().close(page.id)
            })}
          </PageLayer>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * 넘겨지는 페이지 한 장. 덮이는 중(exit)엔 마지막 화면이 그대로 남아 있으므로 inert로 막는다
 * — 적용 직후 Enter를 연달아 누르면 같은 결과가 한 번 더 적용되는 등, 닫힌 페이지가 입력을 받지 않게.
 * 열리면 포커스를 페이지 제목([data-page-focus])으로, 없으면 첫 조작 요소로 옮긴다.
 */
function PageLayer({
  transition,
  onTurned,
  children
}: {
  transition: Transition
  onTurned: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const present = useIsPresent()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const layer = ref.current
    if (!layer) return
    const target =
      layer.querySelector<HTMLElement>('[data-page-focus]') ??
      layer.querySelector<HTMLElement>(FOCUSABLE) ??
      layer
    target.focus({ preventScroll: true })
  }, [])

  return (
    <motion.div
      ref={ref}
      tabIndex={-1}
      // 왼쪽 가장자리 그림자(LAYER_STYLE)로 작업 화면 위를 덮는 장임을 드러낸다 (다 넘어오면 영역 밖이라 잘린다)
      className="absolute inset-0 bg-paper px-3 pb-3 outline-none"
      style={LAYER_STYLE}
      initial={{ transform: turned(100) }}
      animate={{ transform: turned(0) }}
      exit={{ transform: turned(100) }}
      transition={transition}
      inert={!present}
      onAnimationComplete={onTurned}
    >
      {children}
    </motion.div>
  )
}

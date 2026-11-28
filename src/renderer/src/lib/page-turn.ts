import type { TargetAndTransition, Transition, Variants } from 'motion/react'

// 한 장이 다른 장 위를 덮을 때의 연출 — 페이지 넘김(SidePageHost)과 좌우 패널 접기(App)가 같이 쓴다.
// 덮이는 쪽은 덮어 오는 반대 방향으로 조금 밀리며 작아지고 흐려지고, 덮는 쪽은 가장자리 그림자를 단다
export const PAGE_TURN: Transition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] }
// OS의 동작 줄이기 설정이 켜져 있으면 미끄러지지 않고 바로 바뀐다
export const PAGE_SWAP: Transition = { duration: 0 }

// transform 문자열로 — Motion이 브라우저(WAAPI) 애니메이션으로 돌려 컴포지터에서 움직인다.
// x·scale로 움직이면 매 프레임 메인 스레드가 값을 쓰고 화면을 다시 그린다 (opacity도 컴포지터에서 돈다)
const RECEDE_HINT = 'transform, opacity'
const FRONT_TRANSFORM = 'translateX(0%) scale(1)'
// 전환이 끝난 뒤 힌트를 해제해 Windows의 서브픽셀 글꼴 렌더링을 방해하지 않도록 한다.
export const FRONT = {
  transform: FRONT_TRANSFORM,
  opacity: 1,
  willChange: RECEDE_HINT,
  transitionEnd: { transform: 'none', willChange: 'auto' }
}
/** 덮인 모습 — shift는 밀려나는 거리(자기 폭의 %), 음수면 왼쪽 */
export const behind = (shift: number): TargetAndTransition => ({
  transform: `translateX(${shift}%) scale(0.94)`,
  opacity: 0.4,
  willChange: RECEDE_HINT,
  transitionEnd: { willChange: 'auto' }
})
export const RECEDE_SHIFT = 12

/** Resting `none` must start at scale 1, not Motion's synthesized scale 0.
 * Resolve at animation time: an interrupted WAAPI transition can still have
 * `none` as its inline style while its computed transform is already in flight.
 * Leave that case to Motion so reversals continue from the current frame.
 */
export function recedeVariants(shift: number): Variants {
  return {
    front: FRONT,
    behind: (ref: { current: HTMLElement | null }): TargetAndTransition => {
      const target = behind(shift)
      if (ref.current && getComputedStyle(ref.current).transform === 'none') {
        return { ...target, transform: [FRONT_TRANSFORM, target.transform as string] }
      }
      return target
    }
  }
}

/** 덮는 쪽 가장자리 그림자 — side는 그림자가 드리우는 쪽 */
export const edgeShadow = (side: 'left' | 'right'): string =>
  `${side === 'left' ? -16 : 16}px 0 40px rgba(0,0,0,0.3)`

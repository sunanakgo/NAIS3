import type { Transition } from 'motion/react'

// 한 장이 다른 장 위를 덮을 때의 연출 — 페이지 넘김(SidePageHost)과 좌우 패널 접기(App)가 같이 쓴다.
// 덮이는 쪽은 덮어 오는 반대 방향으로 조금 밀리며 작아지고 흐려지고, 덮는 쪽은 가장자리 그림자를 단다
export const PAGE_TURN: Transition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] }
// OS의 동작 줄이기 설정이 켜져 있으면 미끄러지지 않고 바로 바뀐다
export const PAGE_SWAP: Transition = { duration: 0 }

// transform 문자열로 — Motion이 브라우저(WAAPI) 애니메이션으로 돌려 컴포지터에서 움직인다.
// x·scale로 움직이면 매 프레임 메인 스레드가 값을 쓰고 화면을 다시 그린다 (opacity도 컴포지터에서 돈다)
export const FRONT = { transform: 'translateX(0%) scale(1)', opacity: 1 }
/** 덮인 모습 — shift는 밀려나는 거리(자기 폭의 %), 음수면 왼쪽 */
export const behind = (shift: number): typeof FRONT => ({
  transform: `translateX(${shift}%) scale(0.94)`,
  opacity: 0.4
})
export const RECEDE_SHIFT = 12
// 미리 별도 레이어로 올려 둔다 — 배경도 칠해야 한다 (투명 레이어는 Windows에서 서브픽셀 글꼴이 꺼진다)
export const RECEDE_STYLE = { willChange: 'transform, opacity' } as const

/** 덮는 쪽 가장자리 그림자 — side는 그림자가 드리우는 쪽 */
export const edgeShadow = (side: 'left' | 'right'): string =>
  `${side === 'left' ? -16 : 16}px 0 40px rgba(0,0,0,0.3)`

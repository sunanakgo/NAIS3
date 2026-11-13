import { MotionGlobalConfig, useReducedMotion } from 'motion/react'
import { useContext, useEffect, useRef, useState } from 'react'
import { IntroContext } from './intro-context'

/**
 * 소개 화면 로고. 온보딩이 처음 뜰 때는 두 조각이 양쪽에서 날아와 카드 한가운데서 맞물리고, 그대로
 * 원래 자리(제목 위)로 옮겨 앉은 뒤에 카드·제목·버튼이 나타나도록 알린다. 그 뒤 소개 화면으로 돌아오면
 * 조립된 채로 그린다. 그림은 assets/nais3-logo.svg와 같은 두 조각.
 *
 * 움직임은 HTML 요소의 transform·opacity만 Web Animations로 돌려 합성기에서 그린다. 새 설치 첫 실행은
 * 코드 캐시가 없어 메인 스레드가 한동안 바쁜데, motion의 x·y·scale이나 SVG 요소 애니메이션은 매 프레임
 * 메인 스레드에서 계산돼 그 사이 끊긴다
 */
export function IntroLogo(): React.JSX.Element {
  const { revealed, reveal } = useContext(IntroContext)
  // 마운트 시점에만 정한다 — 등장이 끝나 revealed가 바뀌어도 다시 숨기지 않게
  const [play] = useState(!revealed)
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!play) return
    const logo = ref.current!
    const pieces = [...logo.querySelectorAll<HTMLElement>('[data-piece]')]
    let animations: Animation[] = []
    let cancelled = false
    const run = (): void => {
      const card = logo.closest('section')
      // Web Animations가 없거나 motion 애니메이션을 끈 환경(테스트)에선 바로 드러낸다
      if (typeof logo.animate !== 'function' || MotionGlobalConfig.skipAnimations) {
        logo.style.visibility = ''
        reveal()
        return
      }
      if (reduce || !card) {
        animations = [logo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 })]
      } else {
        // 카드 가운데와 로고 자리의 높이 차. 카드에 걸린 zoom만큼 transform이 커지므로 나눠 준다
        const zoom = parseFloat(getComputedStyle(card).zoom) || 1
        const box = logo.getBoundingClientRect()
        const area = card.getBoundingClientRect()
        const dy = (area.top + area.height / 2 - (box.top + box.height / 2)) / zoom
        const gathered = `translateY(${dy}px) scale(${GATHER_SCALE})`
        // 조립하는 동안 가운데 머물다가, 맞물린 직후부터 제자리로 옮겨 앉는다
        const hold = (START + STAGGER + ASSEMBLE) / (START + STAGGER + ASSEMBLE + MOVE)
        animations = [
          logo.animate(
            [
              { transform: gathered },
              { transform: gathered, offset: hold, easing: SETTLE },
              { transform: 'none' }
            ],
            { duration: (START + STAGGER + ASSEMBLE + MOVE) * 1000 }
          ),
          ...pieces.flatMap((piece, i) => {
            const from = PIECES[i]
            const timing = { delay: (START + i * STAGGER) * 1000, fill: 'backwards' } as const
            return [
              piece.animate(
                [
                  { transform: `translate(${from.x}px, ${from.y}px) rotate(${from.rotate}deg)` },
                  { transform: 'none' }
                ],
                { ...timing, duration: ASSEMBLE * 1000, easing: SNAP }
              ),
              piece.animate([{ opacity: 0 }, { opacity: 1 }], {
                ...timing,
                duration: 350,
                easing: 'ease-out'
              })
            ]
          })
        ]
      }
      // 재기 전까지 숨겨 둔 자리를 연다 — 같은 프레임에 애니메이션이 첫 장면을 덮는다
      logo.style.visibility = ''
      void Promise.all(animations.map((a) => a.finished)).then(
        () => !cancelled && reveal(),
        () => {} // 언마운트로 취소됨
      )
    }
    // 한 프레임 뒤에 잰다 — 소개 화면을 카드 정중앙에 두는 여백이 첫 레이아웃 뒤에 정해진다
    const frame = requestAnimationFrame(run)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      for (const a of animations) a.cancel()
    }
  }, [play, reduce, reveal])

  return (
    <div
      ref={ref}
      role="img"
      aria-label="NAIS3"
      className="relative aspect-[739/668] h-[96px] text-ink"
      style={play ? { visibility: 'hidden' } : undefined}
    >
      {PIECES.map((piece) => (
        <div
          key={piece.d}
          data-piece
          className="absolute inset-0"
          style={{ transformOrigin: piece.origin }}
        >
          <svg viewBox="0 0 739 668" className="size-full overflow-visible" aria-hidden>
            <path
              d={piece.d}
              fill="currentColor"
              transform="translate(-312 -372) matrix(1.234671 0 0 1.234671 60.12709 97.90301)"
            />
          </svg>
        </div>
      ))}
    </div>
  )
}

/** 첫 조각이 날아오기 전 숨 고르기(스플래시가 걷히는 중)·두 조각 사이 간격·맞물리기·옮겨 앉기 (초) */
const START = 0.2
const STAGGER = 0.08
const ASSEMBLE = 0.75
const MOVE = 0.7

/** 조립하는 동안의 배율 — 자리로 옮겨 앉으며 1로 줄어든다 */
const GATHER_SCALE = 1.35

/** 맞물릴 때 살짝 지나쳤다 돌아오는 곡선 */
const SNAP = 'cubic-bezier(0.34, 1.45, 0.64, 1)'

/** 두 지점 사이를 옮겨 가는 움직임이라 양 끝을 모두 부드럽게 */
const SETTLE = 'cubic-bezier(0.65, 0, 0.35, 1)'

/**
 * 왼쪽 위 아치 조각과 오른쪽 아래 조각. 출발점은 로고 크기(px) 기준이고, 도는 축은 조각마다 제 가운데
 * (로고 상자 대비 %)
 */
const PIECES = [
  {
    d: 'M204,667L204,419C204,302 292,222 411,222C473,222 528,248 566,292L400,341C384,346 373,348 367,356C359,367 358,381 359,402C359,402 358.361,630.685 355,632.75C320,659.25 242,674 204,667Z',
    origin: '30% 42%',
    x: -30,
    y: -21,
    rotate: -18
  },
  {
    d: 'M410,389L784,279C791,277 798,276 802,276L802,552C802,676 714,763 590,763C506,763 435,718 402,644C407,640 410,635 410,626L410,389Z',
    origin: '66% 55%',
    x: 30,
    y: 21,
    rotate: 18
  }
]

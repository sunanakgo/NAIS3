import { CheckCircle2, type LucideIcon } from 'lucide-react'
import { motion, type MotionProps } from 'motion/react'
import { isValidElement, useContext, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { IntroContext } from './intro-context'

/** 단계 본문이 받는 값 — 마쳐야 넘어가는 단계(계정·불러오기)와 온보딩 전체의 이동 잠금 */
export interface StepProps {
  /** 이 단계를 마쳤는지 (다시 열어도 유지) */
  done: boolean
  onDone: () => void
  /** 온보딩 전체의 이동 잠금과 같은 값 */
  busy: boolean
  onBusyChange: (busy: boolean) => void
}

const HIDDEN = { opacity: 0, y: 12 }
const SHOWN = { opacity: 1, y: 0 }

/** 첫 등장 시 단계 머리(아이콘·제목)를 이 간격으로 차례차례 들인다 (로고가 제자리에 앉은 뒤) */
function introIn(order: number, revealed: boolean): MotionProps {
  return {
    initial: HIDDEN,
    animate: revealed ? SHOWN : HIDDEN,
    transition: { duration: 0.6, delay: order * 0.12, ease: [0.22, 1, 0.36, 1] }
  }
}

/**
 * 단계 머리: 큰 아이콘(또는 직접 그린 그림) + 가운데 정렬 제목.
 * 단계를 옮겨 와서 마운트됐으면 제목이 포커스를 받고, 아니면 온보딩이 막 뜬 첫 화면이라 차례로 들인다
 */
export function StepHeading({
  icon,
  title,
  focusOnMount
}: {
  icon: LucideIcon | React.ReactElement
  title: string
  focusOnMount: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLHeadingElement>(null)
  const { revealed } = useContext(IntroContext)
  // 마운트 시점 값만 본다 — 퇴장 애니메이션 중인 이전 단계 제목이 포커스를 가져가지 않게
  const [focus] = useState(focusOnMount)
  const enter = (order: number): MotionProps => (focus ? {} : introIn(order, revealed))
  useEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true })
  }, [focus])
  return (
    // 아래에 내용이 이어질 때만 띄운다 — 소개 화면은 머리만으로 가운데 정렬
    <div className="mb-8 flex flex-col items-center text-center last:mb-0! short:mb-6 shorter:mb-5">
      {/* 직접 그린 그림(소개 로고)은 스스로 등장한다 */}
      <motion.div className="mb-6" {...(isValidElement(icon) ? {} : enter(0))}>
        {isValidElement(icon) ? icon : <HeroIcon icon={icon} />}
      </motion.div>
      <motion.h2
        ref={ref}
        tabIndex={-1}
        className="text-[34px] font-semibold tracking-tight text-ink outline-none shorter:text-[30px]"
        {...enter(1)}
      >
        {title}
      </motion.h2>
    </div>
  )
}

function HeroIcon({ icon: Icon }: { icon: LucideIcon }): React.JSX.Element {
  return (
    <div className="grid size-[88px] place-items-center rounded-[24px] bg-accent-soft text-accent-ink">
      <Icon size={42} strokeWidth={1.75} />
    </div>
  )
}

/**
 * 카드형 라디오 그룹의 키보드 동작 (WAI-ARIA radio 패턴) — 방향키로 선택과 포커스를 함께 옮긴다.
 * Tab 정지점은 선택된 카드 하나뿐 (각 카드 tabIndex는 선택 여부로 정한다)
 */
function radioKeys<T>(
  values: readonly T[],
  current: T,
  select: (value: T) => void
): (e: React.KeyboardEvent<HTMLElement>) => void {
  return (e) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!delta) return
    e.preventDefault()
    const next = (values.indexOf(current) + delta + values.length) % values.length
    select(values[next])
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }
}

/**
 * 카드형 단일 선택 (WAI-ARIA radio 패턴). 카드 안쪽은 children이 값마다 그리고,
 * 이미 고른 카드를 다시 눌러도 onSelect는 부르지 않는다
 */
export function ChoiceGroup<T extends string | boolean>({
  label,
  values,
  value,
  onSelect,
  className,
  children
}: {
  label: string
  values: readonly T[]
  value: T
  onSelect: (value: T) => void
  className: string
  children: (value: T, selected: boolean) => React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={className}
      role="radiogroup"
      aria-label={label}
      onKeyDown={radioKeys(values, value, onSelect)}
    >
      {values.map((v) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          tabIndex={v === value ? 0 : -1}
          onClick={() => v !== value && onSelect(v)}
          className="group flex flex-col items-center gap-2.5 outline-none"
        >
          {children(v, v === value)}
        </button>
      ))}
    </div>
  )
}

/** 선택 카드 이름 — 고른 카드만 진하게 */
export function ChoiceLabel({
  selected,
  className,
  children
}: {
  selected: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={cn('text-[14px]', selected ? 'font-medium text-ink' : 'text-muted', className)}
    >
      {children}
    </span>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h3 className="mb-3 w-full text-[14px] font-medium text-muted">{children}</h3>
}

/**
 * 완료 안내 상자. 방금 끝난 동작의 결과면 포커스를 받아, 사라진 버튼·입력란 대신 읽힌다.
 * 덧붙일 설명이 없는 한 줄짜리 결과는 가운데로
 */
export function ResultBox({
  focusOnMount,
  title,
  detail
}: {
  focusOnMount: boolean
  title: string
  detail?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusOnMount) ref.current?.focus()
  }, [focusOnMount])
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={cn(
        'flex gap-3.5 rounded-2xl bg-accent-soft p-6 outline-none',
        detail ? 'items-start' : 'items-center justify-center'
      )}
    >
      <CheckCircle2 size={22} className={cn('shrink-0 text-accent-ink', detail && 'mt-0.5')} />
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-ink">{title}</p>
        {detail && <p className="mt-1 text-[13px] text-muted">{detail}</p>}
      </div>
    </div>
  )
}

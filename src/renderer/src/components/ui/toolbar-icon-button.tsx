import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

/**
 * 패널 툴바 아이콘 버튼 — 이름은 시스템 title 대신 NAIS3 툴팁으로 보여준다.
 * 툴팁은 아래로 (위쪽 검색창을 가리지 않게). 부모 칸을 나눠 쓰도록 폭은 flex-1.
 * 꺼진 버튼은 기본 border-line보다 진한 테두리로 칸 구분을 또렷하게. pressed를 주면 토글 버튼(aria-pressed + 켜짐 강조).
 * hint를 주면 툴팁은 이름 대신 hint를 보여준다 — 사용법 설명이 이미 이름으로 시작하는 문구라서.
 */
export function ToolbarIconButton({
  icon,
  label,
  hint,
  pressed,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'children' | 'title'> & {
  icon: ReactNode
  label: string
  hint?: string
  pressed?: boolean
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={pressed ? 'accent' : 'default'}
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            'h-8 min-w-0 flex-1 px-0',
            !pressed && 'border-muted/40 hover:border-muted/60',
            className
          )}
          {...props}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64 px-2 py-1 text-[12px]">
        {hint ?? label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * 툴바 왼쪽 절반 — 아이콘 버튼들이 칸을 1/n씩 나눈다.
 * 자체 TooltipProvider를 두어 App 밖(단독 렌더, 테스트)에서도 툴팁이 동작한다.
 */
export function ToolbarIconGroup({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <TooltipProvider>
      <div className="flex gap-1.5">{children}</div>
    </TooltipProvider>
  )
}

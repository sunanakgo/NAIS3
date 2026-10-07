import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, type ComponentProps } from 'react'
import { cn } from '../../lib/utils'

let openSelectCount = 0
let recentlyClosedUntil = 0
let guardedPointerDownUntil = 0
let guardListenerInstalled = false

function installSelectDismissGuard(): void {
  if (guardListenerInstalled || typeof window === 'undefined') return
  guardListenerInstalled = true
  window.addEventListener(
    'pointerdown',
    () => {
      if (openSelectCount > 0) guardedPointerDownUntil = Date.now() + 300
    },
    true
  )
}

export function hasActiveSelectPopup(): boolean {
  const now = Date.now()
  return openSelectCount > 0 || now < recentlyClosedUntil || now < guardedPointerDownUntil
}

export function Select({ onOpenChange, ...props }: ComponentProps<typeof SelectPrimitive.Root>) {
  const openRef = useRef(false)

  installSelectDismissGuard()

  useEffect(() => {
    return () => {
      if (openRef.current) {
        openSelectCount = Math.max(0, openSelectCount - 1)
        openRef.current = false
      }
    }
  }, [])

  return (
    <SelectPrimitive.Root
      {...props}
      onOpenChange={(open) => {
        if (openRef.current !== open) {
          openSelectCount += open ? 1 : -1
          openSelectCount = Math.max(0, openSelectCount)
          openRef.current = open
          if (!open) recentlyClosedUntil = Date.now() + 300
        }
        onOpenChange?.(open)
      }}
    />
  )
}

export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-md border border-line bg-paper px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-accent/50 data-[placeholder]:text-muted',
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={14} className="flex-none text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        data-radix-select-content=""
        className={cn(
          'z-50 max-h-[300px] min-w-[8rem] overflow-hidden rounded-lg border border-line bg-surface text-ink shadow-xl',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className
        )}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]'
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-2.5 pr-8 text-[13px] text-muted outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink data-[state=checked]:text-ink',
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2.5 flex items-center">
        <SelectPrimitive.ItemIndicator>
          <Check size={14} className="text-accent-ink" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

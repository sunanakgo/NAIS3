import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>): React.JSX.Element {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-md border border-line bg-paper px-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-muted focus:border-accent/50',
        className
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>): React.JSX.Element {
  return (
    <textarea
      className={cn(
        'w-full resize-none rounded-md border border-line bg-paper p-2.5 font-mono text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-muted focus:border-accent/50',
        className
      )}
      spellCheck={false}
      {...props}
    />
  )
}

import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border border-line bg-surface text-ink hover:bg-surface-2',
        accent: 'bg-accent text-on-accent hover:bg-accent-hover',
        // 투명 테두리를 미리 깔아 ghost→default 전환 시 border-color가 currentColor(검정/흰)에서
        // 시작해 반짝이는 것 방지 (transition-colors가 transparent→border-line만 애니메이션)
        ghost: 'border border-transparent text-muted hover:bg-surface-2 hover:text-ink',
        danger: 'bg-danger text-on-danger hover:bg-danger-hover'
      },
      size: {
        sm: 'h-7 px-2.5',
        md: 'h-8 px-3',
        lg: 'h-10 px-4 text-[14px]',
        icon: 'size-8'
      }
    },
    defaultVariants: { variant: 'default', size: 'md' }
  }
)

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants>): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

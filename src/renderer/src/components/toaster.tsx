import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore, type ToastType } from '../stores/toast-store'
import { cn } from '../lib/utils'

const ICON: Record<ToastType, typeof Info> = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle2
}
const TONE: Record<ToastType, string> = {
  error: 'border-danger/40 text-danger',
  info: 'border-line text-ink',
  success: 'border-success/40 text-success'
}

/** 하단 중앙 토스트 스택 — 모든 알림을 한 곳에서 처리 */
export function Toaster(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[200] flex flex-col items-center gap-2">
      <AnimatePresence initial={true}>
        {toasts.map((t) => {
          const Icon = ICON[t.type]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                'pointer-events-auto flex max-w-[420px] items-center gap-2.5 rounded-lg border bg-surface/95 py-2 pl-3 pr-2 text-[12.5px] shadow-xl backdrop-blur',
                TONE[t.type]
              )}
            >
              <Icon size={15} className="shrink-0" />
              <span className="min-w-0 flex-1 break-words text-ink">{t.message}</span>
              <button
                className="shrink-0 rounded p-1 text-faint transition-colors hover:text-ink"
                onClick={() => dismiss(t.id)}
              >
                <X size={13} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

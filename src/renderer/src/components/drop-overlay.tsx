import { AnimatePresence, motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'

/** 드래그 오버 시 드롭존 위에 얹는 안내 오버레이 (프리뷰·디렉터 공용) */
export function DropOverlay({
  show,
  icon: Icon,
  label,
  sub
}: {
  show: boolean
  icon: LucideIcon
  label: string
  sub?: string
}): React.JSX.Element {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-accent bg-paper/85 backdrop-blur-sm"
        >
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
            className="grid size-16 place-items-center rounded-full bg-accent/12 text-accent ring-8 ring-accent/5"
          >
            <Icon size={28} strokeWidth={1.6} />
          </motion.div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[13px] font-semibold text-ink">{label}</span>
            {sub && <span className="text-[11px] text-muted">{sub}</span>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

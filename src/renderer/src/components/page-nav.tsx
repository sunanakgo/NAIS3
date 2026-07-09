import { Image, LayoutGrid, Library, Wand2, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '../lib/utils'
import { useLayoutStore } from '../stores/layout-store'

type Page = 'main' | 'scene' | 'director' | 'library'

const PAGES: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'main', label: '메인', icon: Image },
  { id: 'scene', label: '씬', icon: LayoutGrid },
  { id: 'director', label: '디렉터', icon: Wand2 },
  { id: 'library', label: '라이브러리', icon: Library }
]

/**
 * 상단 중앙 페이지 네비게이션 (NAIS2 AnimatedNavBar 이식).
 * 활성 탭에 layoutId 슬라이딩 pill이 부드럽게 이동한다.
 */
export function PageNav(): React.JSX.Element {
  const centerMode = useLayoutStore((s) => s.centerMode)
  const setCenterMode = useLayoutStore((s) => s.setCenterMode)

  return (
    <nav className="no-drag pointer-events-auto flex items-center gap-1 rounded-full border border-line/70 bg-surface/95 p-1 shadow-md backdrop-blur">
      {PAGES.map((page) => {
        const active = centerMode === page.id
        return (
          <button
            key={page.id}
            onClick={() => setCenterMode(page.id)}
            className={cn(
              'relative z-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors',
              active ? 'text-ink' : 'text-muted hover:text-ink'
            )}
          >
            {active && (
              <motion.div
                layoutId="pageNavActive"
                className="absolute inset-0 -z-10 rounded-full border border-ink/10 bg-ink/[0.08] shadow-sm backdrop-blur-md"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <page.icon className="size-4" />
              {page.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

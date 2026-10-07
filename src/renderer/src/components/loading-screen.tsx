import { motion } from 'motion/react'
import nais3Icon from '../assets/nais3-icon.svg'

/**
 * 시작 로딩 스플래시 (NAIS2 참고). 초기 하이드레이션 동안 표시하고 준비되면 페이드아웃.
 * 브랜드 고정 다크 배경 — 흰색 로고가 항상 보이게.
 */
export function LoadingScreen(): React.JSX.Element {
  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-brand-paper"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.img
        src={nais3Icon}
        alt="NAIS3"
        className="h-28 w-28"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      />
      {/* 로딩 진행 바 (인디터미네이트) */}
      <div className="mt-8 h-[3px] w-40 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full w-1/3 rounded-full bg-brand-accent"
          animate={{ x: ['-100%', '350%'] }}
          transition={{ duration: 1.1, ease: 'easeInOut', repeat: Infinity }}
        />
      </div>
    </motion.div>
  )
}

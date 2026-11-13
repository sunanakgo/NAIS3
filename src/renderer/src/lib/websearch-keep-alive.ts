import { useEffect, useState } from 'react'
import { useLayoutStore } from '../stores/layout-store'

/** 웹 탭을 떠난 뒤 이만큼 다시 오지 않으면 <webview>를 내려 메모리를 돌려준다 */
const KEEP_ALIVE_MS = 5 * 60_000

/**
 * 웹 탭을 계속 띄워 둘지. 떠난 직후 다시 열면 <webview>를 새로 만들지 않고 그대로 보여 주고
 * (게스트 프로세스 생성 + 페이지 재로딩이 화면을 버벅이게 함), 한동안 안 오면 내린다.
 * 설정에서 웹 페이지를 숨기면 바로 내린다.
 */
export function useWebSearchKeepAlive(active: boolean): boolean {
  const pageHidden = useLayoutStore((s) => s.hiddenPages.includes('websearch'))
  const [mounted, setMounted] = useState(false)
  if (active && !pageHidden && !mounted) setMounted(true)
  if (pageHidden && mounted) setMounted(false)

  useEffect(() => {
    if (active || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), KEEP_ALIVE_MS)
    return () => clearTimeout(timer)
  }, [active, mounted])

  return mounted
}

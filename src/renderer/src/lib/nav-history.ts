import { useLayoutStore, type CenterMode } from '../stores/layout-store'
import { useScenesStore } from '../stores/scenes-store'

/**
 * 앱 내 네비게이션 히스토리 — 마우스 4/5번(뒤로/앞으로) 버튼 지원.
 * 라우터가 없으므로 "뷰"(중앙 모드 + 선택된 씬)를 스택으로 직접 관리한다.
 * NAIS2는 react-router라 브라우저 히스토리로 공짜였던 기능.
 */

interface View {
  mode: CenterMode
  sceneId: number | null
}

const MAX = 50
let backStack: View[] = []
let fwdStack: View[] = []
let applying = false // 뒤로/앞으로 적용 중의 상태 변경은 기록하지 않음

function snapshot(): View {
  return {
    mode: useLayoutStore.getState().centerMode,
    sceneId: useScenesStore.getState().selectedId
  }
}

function sameView(a: View, b: View): boolean {
  return a.mode === b.mode && a.sceneId === b.sceneId
}

/** 뷰가 바뀌기 "직전"에 호출 — setCenterMode/씬 select에서 */
export function recordNav(): void {
  if (applying) return
  const cur = snapshot()
  const top = backStack[backStack.length - 1]
  if (top && sameView(top, cur)) return
  backStack.push(cur)
  if (backStack.length > MAX) backStack.shift()
  fwdStack = []
}

function apply(v: View): void {
  applying = true
  try {
    useLayoutStore.getState().setCenterMode(v.mode)
    useScenesStore.getState().select(v.sceneId)
  } finally {
    applying = false
  }
}

export function goBack(): void {
  const v = backStack.pop()
  if (!v) return
  fwdStack.push(snapshot())
  apply(v)
}

export function goForward(): void {
  const v = fwdStack.pop()
  if (!v) return
  backStack.push(snapshot())
  apply(v)
}

/** 마우스 4/5번 버튼 바인딩 (App 마운트 시 1회) */
export function bindNavMouse(): () => void {
  const onUp = (e: MouseEvent): void => {
    if (e.button === 3) {
      e.preventDefault()
      goBack()
    } else if (e.button === 4) {
      e.preventDefault()
      goForward()
    }
  }
  window.addEventListener('mouseup', onUp)
  return () => window.removeEventListener('mouseup', onUp)
}

import { useLayoutStore, type CenterMode } from '../stores/layout-store'
import { useScenesStore } from '../stores/scenes-store'
import { useSidePageStore } from '../stores/side-page-store'

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
const backStack: View[] = []
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
    const layout = useLayoutStore.getState()
    // 기록 뒤에 설정에서 숨긴 페이지로는 돌아가지 않는다 — 숨긴 웹 탭은 <webview>가 내려가 있어 빈 화면이 된다
    layout.setCenterMode(v.mode !== 'main' && layout.hiddenPages.includes(v.mode) ? 'main' : v.mode)
    useScenesStore.getState().select(v.sceneId)
  } finally {
    applying = false
  }
}

export function goBack(): void {
  // 옆으로 넘겨 놓은 편집 페이지는 현재 뷰 위의 한 장 — 뒤로 가기는 먼저 그 페이지를 덮는다
  const sidePage = useSidePageStore.getState()
  if (sidePage.page) {
    sidePage.close()
    return
  }
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

import { ArrowLeft, ArrowRight, Home, Loader2, Minus, Plus, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'
import { askText } from '../stores/dialog-store'
import { HOME_URL, useWebSearchStore } from '../stores/websearch-store'
import { Button } from './ui/button'
import { Input } from './ui/input'

/**
 * 웹 검색 — 인앱 태그 검색 브라우저 (NAIS2의 Tauri 자식 웹뷰 이식).
 * Electron이므로 <webview> 태그 하나로 끝 — 좌표 동기화/모달 z-index 트릭 전부 불필요.
 * 세션은 persist:websearch 파티션으로 앱과 격리 (로그인 유지, 쿠키 분리).
 */

// <webview> JSX 타입은 React에 내장 — 메서드(Electron WebviewTag)만 최소로 선언
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  goBack(): void
  goForward(): void
  reload(): void
  canGoBack(): boolean
  canGoForward(): boolean
  setZoomFactor(factor: number): void
  getURL(): string
}

/** 주소창 입력 → URL (스킴 없으면 https, 도메인 형태가 아니면 단부루 태그 검색) */
function toUrl(input: string): string {
  const t = input.trim()
  if (!t) return HOME_URL
  if (/^https?:\/\//i.test(t)) return t
  if (t.includes('.') && !t.includes(' ')) return `https://${t}`
  return `${HOME_URL}/posts?tags=${encodeURIComponent(t.replace(/\s+/g, '_'))}`
}

export function WebSearchMode(): React.JSX.Element {
  const url = useWebSearchStore((s) => s.url)
  const zoom = useWebSearchStore((s) => s.zoom)
  const quickLinks = useWebSearchStore((s) => s.quickLinks)
  const loaded = useWebSearchStore((s) => s.loaded)
  const setUrl = useWebSearchStore((s) => s.setUrl)
  const setZoom = useWebSearchStore((s) => s.setZoom)
  const addQuickLink = useWebSearchStore((s) => s.addQuickLink)
  const removeQuickLink = useWebSearchStore((s) => s.removeQuickLink)

  const webviewRef = useRef<WebviewElement | null>(null)
  const [inputUrl, setInputUrl] = useState(url)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editLinks, setEditLinks] = useState(false)
  // src는 마운트 시 한 번만 — 이후 이동은 loadURL (src 갱신은 리로드를 유발)
  const [initialSrc] = useState(() => useWebSearchStore.getState().url)

  useEffect(() => {
    if (!loaded) void useWebSearchStore.getState().hydrate()
  }, [loaded])

  // webview 이벤트 — 주소창/뒤로·앞으로/로딩 동기화 + 마지막 URL persist
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onNavigate = (): void => {
      const current = wv.getURL()
      setInputUrl(current)
      setCanBack(wv.canGoBack())
      setCanForward(wv.canGoForward())
      setUrl(current)
    }
    const onStart = (): void => setLoading(true)
    const onStop = (): void => setLoading(false)
    const onDomReady = (): void => wv.setZoomFactor(useWebSearchStore.getState().zoom)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigate)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('dom-ready', onDomReady)
    return () => {
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigate)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('dom-ready', onDomReady)
    }
  }, [setUrl])

  function navigate(to: string): void {
    void webviewRef.current?.loadURL(toUrl(to))
  }
  function changeZoom(next: number): void {
    setZoom(next)
    webviewRef.current?.setZoomFactor(Math.min(3, Math.max(0.25, next)))
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      {/* 주소창 + 네비게이션 */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <NavBtn tip="뒤로" disabled={!canBack} onClick={() => webviewRef.current?.goBack()}>
          <ArrowLeft size={15} />
        </NavBtn>
        <NavBtn tip="앞으로" disabled={!canForward} onClick={() => webviewRef.current?.goForward()}>
          <ArrowRight size={15} />
        </NavBtn>
        <NavBtn tip="새로고침" onClick={() => webviewRef.current?.reload()}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />}
        </NavBtn>
        <NavBtn tip="홈 (Danbooru)" onClick={() => navigate(HOME_URL)}>
          <Home size={15} />
        </NavBtn>
        <Input
          className="h-8 flex-1 font-mono text-[12px]"
          value={inputUrl}
          placeholder="URL 또는 태그 검색 (도메인이 아니면 단부루 태그로 검색)"
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(inputUrl)
          }}
        />
        {/* 줌 */}
        <div className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
          <NavBtn tip="축소" onClick={() => changeZoom(zoom - 0.1)}>
            <Minus size={13} />
          </NavBtn>
          <button
            className="min-w-11 text-center font-mono text-[11px] text-muted hover:text-ink"
            title="100%로"
            onClick={() => changeZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <NavBtn tip="확대" onClick={() => changeZoom(zoom + 0.1)}>
            <Plus size={13} />
          </NavBtn>
        </div>
      </div>

      {/* 퀵링크 바 */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {quickLinks.map((link, i) => (
          <span key={`${link.url}-${i}`} className="group relative">
            <button
              className="rounded-full border border-line bg-surface-2/60 px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-ink"
              onClick={() => navigate(link.url)}
            >
              {link.name}
            </button>
            {editLinks && (
              <button
                className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-danger text-white"
                title="삭제"
                onClick={() => removeQuickLink(i)}
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-[12px]"
          onClick={async () => {
            const input = await askText('퀵링크 추가', '', 'https://... 또는 도메인')
            if (!input?.trim()) return
            const linkUrl = toUrl(input)
            const name = await askText('퀵링크 이름', new URL(linkUrl).hostname)
            if (name) addQuickLink({ name, url: linkUrl })
          }}
        >
          <Plus size={13} /> 추가
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className={cn('h-7 px-2 text-[12px]', editLinks && 'text-accent')}
          onClick={() => setEditLinks(!editLinks)}
        >
          {editLinks ? '완료' : '편집'}
        </Button>
      </div>

      {/* 브라우저 — <webview>는 그냥 DOM 요소라 레이아웃/모달과 충돌 없음 */}
      <div className="min-h-0 flex-1 bg-white">
        <webview
          ref={(el) => {
            webviewRef.current = el as WebviewElement | null
          }}
          src={initialSrc}
          // eslint-disable-next-line react/no-unknown-property -- Electron webview 전용 속성
          partition="persist:websearch"
          className="h-full w-full"
        />
      </div>
    </div>
  )
}

function NavBtn({
  tip,
  disabled,
  onClick,
  children
}: {
  tip: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={tip}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-35"
    >
      {children}
    </button>
  )
}

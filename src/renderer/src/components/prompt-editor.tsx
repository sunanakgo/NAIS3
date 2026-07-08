import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/utils'
import { caretCoords } from '../lib/caret'
import { highlightRanges } from '../lib/prompt-weights'
import { fragmentPaths } from '../stores/fragments-store'

/**
 * 프롬프트 에디터.
 *
 * 하이라이트 구조 (NAIS2의 커서/드래그 어긋남 문제를 피하는 설계):
 * - 글자는 textarea가 "단독으로" 그린다 — 선택·커서·IME 전부 네이티브 동작
 * - 미러(div)는 동일 타이포로 투명 글자를 깔고 배경색만 칠한다
 * - 테두리는 컨테이너가 가진다 (textarea/미러 metrics 완전 동일 보장)
 *
 * 색: 강조({}·양수 가중치)=붉은색, 약화([]·1 미만·음수)=파란색, <조각>=녹색
 * 자동완성: 커서 바로 아래 팝업. `<`는 조각, 그 외 토큰은 단부루 태그(IPC 검색)
 */

// 폰트 크기는 설정값(--prompt-size)을 따름. mirror/textarea가 동일해야 배경 정렬이 맞는다.
// scrollbar-gutter:stable — 스크롤바 자리를 미리 배정(mirror도 동일해야 정렬 유지)
const TYPO =
  'whitespace-pre-wrap break-words p-2.5 font-mono text-[length:var(--prompt-size,15px)] leading-relaxed [scrollbar-gutter:stable]'

type Suggestion =
  | { kind: 'frag'; path: string }
  | { kind: 'tag'; tag: string; count: number; type: string }

const TAG_TOKEN_SEPARATORS = /[,\n{}[\]|<>:/]/

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`
  return String(count)
}

const TYPE_COLORS: Record<string, string> = {
  artist: 'text-[#e05c50]',
  character: 'text-[#5c9e6e]',
  copyright: 'text-[#b07fd8]',
  meta: 'text-[#c9a34f]'
}

const TOKEN_LIMIT = 512

export function PromptEditor({
  value,
  onValueChange,
  placeholder,
  className,
  negative = false,
  tokensOverride
}: {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
  negative?: boolean
  /** 외부에서 합산한 토큰 수 (기본+캐릭터 합산 등). undefined면 자체 카운트, null이면 숨김 */
  tokensOverride?: number | null
}): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  // 검색 세대 — 이미 날아간(in-flight) 태그 검색의 스테일 결과가 뒤늦게 패널을 다시 여는 것 방지.
  // (패널이 남으면 Enter가 줄바꿈 대신 자동완성 삽입으로 먹혀 "줄바꿈이 안 된다"로 나타남)
  const searchSeqRef = useRef(0)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selected, setSelected] = useState(0)
  const [tokenStart, setTokenStart] = useState(-1)
  const [popupPos, setPopupPos] = useState<{ left: number; top: number } | null>(null)

  const ranges = useMemo(() => highlightRanges(value), [value])

  // 토큰 카운트 (V4.5 = T5, 한도 512 — NAI 웹과 동일: 원문 기준, 가중치 문법 제거 후)
  const [ownTokens, setOwnTokens] = useState<number | null>(null)
  const external = tokensOverride !== undefined
  useEffect(() => {
    if (external) return
    if (!value.trim()) {
      setOwnTokens(null)
      return
    }
    const timer = setTimeout(() => {
      void window.nais
        .invoke('tokens:count', { texts: [value] })
        .then(({ counts }) => setOwnTokens(counts[0]))
    }, 250)
    return () => clearTimeout(timer)
  }, [value, external])
  const tokens = external ? tokensOverride : ownTokens

  // 세로 스크롤바가 생기면 textarea 콘텐츠 폭이 줄어 줄바꿈이 달라진다 —
  // 미러의 오른쪽을 스크롤바 폭만큼 좁혀 두 레이어의 줄바꿈을 항상 일치시킨다
  // 스크롤바 폭 보정은 하지 않는다 — mirror·textarea 둘 다 scrollbar-gutter:stable(TYPO)이라
  // 콘텐츠 폭이 항상 동일. 수동 right 보정을 더하면 이중 인셋으로 줄바꿈이 어긋난다(배경 오정렬).
  const syncScroll = (): void => {
    const ta = textareaRef.current
    const mirror = mirrorRef.current
    if (ta && mirror) {
      mirror.scrollTop = ta.scrollTop
      mirror.scrollLeft = ta.scrollLeft
    }
  }
  useEffect(syncScroll, [value])
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const observer = new ResizeObserver(syncScroll)
    observer.observe(ta)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 커서 아래 팝업 좌표 (뷰포트 기준, 화면 밖으로 나가지 않게 클램프) */
  function placePopup(itemCount: number): void {
    const ta = textareaRef.current
    if (!ta) return
    const caret = caretCoords(ta, ta.selectionStart)
    const rect = ta.getBoundingClientRect()
    const estimatedHeight = Math.min(itemCount, 8) * 27 + 10
    let left = rect.left + caret.left - ta.scrollLeft
    let top = rect.top + caret.top - ta.scrollTop + caret.height + 4
    left = Math.max(8, Math.min(left, window.innerWidth - 288))
    if (top + estimatedHeight > window.innerHeight - 8) {
      top = rect.top + caret.top - ta.scrollTop - estimatedHeight - 4
    }
    setPopupPos({ left, top })
  }

  function refreshSuggestions(text: string, cursor: number): void {
    clearTimeout(debounceRef.current)
    const seq = ++searchSeqRef.current // 이 시점 이전에 발사된 검색 결과는 전부 무효
    const before = text.slice(0, cursor)

    // 주석 구간(# 뒤)에서는 추천 안 함 — 어차피 전송 안 되는 텍스트
    const lineStart = before.lastIndexOf('\n') + 1
    if (before.slice(lineStart).includes('#')) {
      setSuggestions([])
      return
    }

    const frag = /<([^<>|]*)$/.exec(before)
    if (frag) {
      const paths = fragmentPaths(frag[1])
      setTokenStart(cursor - frag[1].length)
      setSuggestions(paths.map((path) => ({ kind: 'frag', path })))
      setSelected(0)
      if (paths.length > 0) placePopup(paths.length)
      return
    }

    let sepIdx = -1
    for (let i = before.length - 1; i >= 0; i--) {
      if (TAG_TOKEN_SEPARATORS.test(before[i])) {
        sepIdx = i
        break
      }
    }
    const rawToken = before.slice(sepIdx + 1)
    const token = rawToken.trimStart()
    const start = sepIdx + 1 + (rawToken.length - token.length)
    if (token.trim().length < 2) {
      setSuggestions([])
      return
    }
    setTokenStart(start)
    debounceRef.current = setTimeout(() => {
      void window.nais.invoke('tags:search', { query: token.trim(), limit: 8 }).then(({ items }) => {
        if (searchSeqRef.current !== seq) return // 스테일 — 그 사이 입력이 바뀜
        setSuggestions(items.map((t) => ({ kind: 'tag' as const, ...t })))
        setSelected(0)
        if (items.length > 0) placePopup(items.length)
      })
    }, 90)
  }

  function complete(s: Suggestion): void {
    const ta = textareaRef.current
    if (!ta || tokenStart < 0) return
    const cursor = ta.selectionStart
    let insert = s.kind === 'frag' ? s.path + '>' : s.tag
    // 완성 후 바로 다음 태그를 이어 칠 수 있게 ", " 부착 (뒤에 이미 쉼표가 있으면 생략)
    if (!value.slice(cursor).trimStart().startsWith(',')) insert += ', '
    const next = value.slice(0, tokenStart) + insert + value.slice(cursor)
    onValueChange(next)
    setSuggestions([])
    requestAnimationFrame(() => {
      const pos = tokenStart + insert.length
      ta.setSelectionRange(pos, pos)
      ta.focus()
    })
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-line bg-paper transition-colors',
        negative && 'border-danger/25',
        className
      )}
    >
      <div
        ref={mirrorRef}
        aria-hidden
        className={cn(TYPO, 'pointer-events-none absolute inset-0 overflow-hidden text-transparent')}
      >
        {ranges.map((r) =>
          r.bg ? (
            <span key={r.start} style={{ background: r.bg, borderRadius: 3 }}>
              {value.slice(r.start, r.end)}
            </span>
          ) : (
            <span key={r.start}>{value.slice(r.start, r.end)}</span>
          )
        )}
        {value.endsWith('\n') && '​'}
      </div>

      <textarea
        ref={textareaRef}
        className={cn(
          TYPO,
          'relative block h-full w-full resize-none bg-transparent text-ink outline-none placeholder:text-faint'
        )}
        style={{ caretColor: 'var(--ink)' }}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onValueChange(e.target.value)
          refreshSuggestions(e.target.value, e.target.selectionStart)
        }}
        onScroll={syncScroll}
        onKeyDown={(e) => {
          if (suggestions.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelected((selected + 1) % suggestions.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelected((selected - 1 + suggestions.length) % suggestions.length)
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            complete(suggestions[selected])
          } else if (e.key === 'Escape') {
            setSuggestions([])
          }
        }}
        onBlur={() => setTimeout(() => setSuggestions([]), 150)}
      />

      {tokens !== null && (
        <span
          className={cn(
            'pointer-events-none absolute bottom-1 right-1.5 rounded bg-paper/85 px-1 font-mono text-[10.5px] backdrop-blur-sm',
            tokens > TOKEN_LIMIT ? 'text-danger' : 'text-faint'
          )}
          title={
            tokens > TOKEN_LIMIT
              ? `한도 초과 — ${tokens}/${TOKEN_LIMIT} 토큰. 초과분은 잘려서 반영되지 않습니다`
              : `${tokens}/${TOKEN_LIMIT} 토큰`
          }
        >
          {tokens}/{TOKEN_LIMIT}
        </span>
      )}

      {suggestions.length > 0 &&
        popupPos &&
        createPortal(
          <div
            className="fixed z-50 min-w-52 max-w-72 overflow-hidden rounded-md border border-line bg-surface shadow-xl"
            style={{ left: popupPos.left, top: popupPos.top }}
          >
            {suggestions.map((s, i) => (
              <button
                key={s.kind === 'frag' ? `f:${s.path}` : `t:${s.tag}`}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1 text-left font-mono text-[12px] text-muted',
                  i === selected && 'bg-surface-2 text-ink'
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  complete(s)
                }}
              >
                {s.kind === 'frag' ? (
                  <span className="truncate text-[#5cbe7d]">{`<${s.path}>`}</span>
                ) : (
                  <>
                    <span className={cn('min-w-0 flex-1 truncate', TYPE_COLORS[s.type])}>{s.tag}</span>
                    <span className="shrink-0 text-[10.5px] text-faint">{formatCount(s.count)}</span>
                  </>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}

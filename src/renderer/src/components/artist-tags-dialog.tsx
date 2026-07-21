import { Copy, ImageOff, Loader2, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useArtistTagsStore } from '../stores/artist-tags-store'
import { toast } from '../stores/toast-store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

/**
 * 작가 태그 분석 팝업 — 좌: 이미지 / 우: artist: 태그 칩 목록(클릭 = 제외/포함).
 * 선택된 태그만 하단 텍스트로 모아 복사한다.
 */
export function ArtistTagsDialog(): React.JSX.Element {
  const open = useArtistTagsStore((s) => s.open)
  const loading = useArtistTagsStore((s) => s.loading)
  const tags = useArtistTagsStore((s) => s.tags)
  const error = useArtistTagsStore((s) => s.error)
  const imageSrc = useArtistTagsStore((s) => s.imageSrc)
  const close = useArtistTagsStore((s) => s.close)

  // 기본: 유사도 10% 초과만 선택 (NAIS2와 동일 컷) — 나머지는 칩 클릭으로 추가
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  useEffect(() => {
    const timer = setTimeout(() => {
      setExcluded(new Set(tags.filter((t) => t.score <= 0.1).map((t) => t.label)))
    })
    return () => clearTimeout(timer)
  }, [tags])
  const toggle = (label: string): void =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })

  const selectedText = tags
    .filter((t) => !excluded.has(t.label))
    .map((t) => t.label)
    .join(', ')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[85vh] max-w-[680px] flex-col p-0">
        <DialogTitle className="border-b border-line px-5 py-3.5 text-[15px]">
          작가 태그 분석{' '}
          <span className="text-[12px] font-normal text-faint">
            — 그림체가 닮은 작가 추정 (Kaloscope)
          </span>
        </DialogTitle>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted">
            <Loader2 size={18} className="animate-spin" />
            <p className="text-[13px]">스타일 분석 중… (수 초 걸릴 수 있습니다)</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-14 text-danger">
            <ImageOff size={30} strokeWidth={1.4} />
            <p className="max-w-[80%] text-center text-[13px]">{error}</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-5">
            {/* 좌: 이미지 */}
            <div className="flex w-[42%] shrink-0 flex-col gap-3">
              <div className="flex items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2/40">
                {imageSrc ? (
                  <img src={imageSrc} className="max-h-[300px] w-full object-contain" alt="" />
                ) : (
                  <div className="flex h-40 items-center justify-center text-faint">
                    <ImageOff size={28} strokeWidth={1.3} />
                  </div>
                )}
              </div>
            </div>

            {/* 우: 태그 칩 + 선택 결과 */}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap content-start items-start gap-1.5 overflow-y-auto">
                {tags.map((t) => {
                  const off = excluded.has(t.label)
                  return (
                    <button
                      key={t.label}
                      onClick={() => toggle(t.label)}
                      title={off ? '클릭해서 포함' : '클릭해서 제외'}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors',
                        off
                          ? 'border-line text-faint opacity-55 hover:opacity-80'
                          : 'border-accent/50 bg-accent/10 text-ink'
                      )}
                    >
                      <Palette size={11} className={off ? 'text-faint' : 'text-accent'} />
                      <span className="max-w-44 truncate">{t.label}</span>
                      <span className="font-mono text-[10px] text-faint">
                        {Math.round(t.score * 100)}%
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex min-h-0 flex-none flex-col">
                <p className="mb-1 text-[12px] font-medium text-muted">선택된 태그</p>
                <textarea
                  readOnly
                  value={selectedText}
                  placeholder="(선택된 태그 없음)"
                  className="block h-24 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-2/40 p-2 font-mono text-[12px] leading-relaxed text-ink outline-none placeholder:font-sans placeholder:text-faint"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={close}>
            닫기
          </Button>
          <Button
            variant="accent"
            className="gap-1.5"
            disabled={!selectedText}
            onClick={() => {
              void navigator.clipboard.writeText(selectedText)
              toast('작가 태그가 복사되었습니다', 'success')
            }}
          >
            <Copy size={13} /> 복사
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { Copy, ImageOff, Loader2, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useArtistTagsStore } from '../stores/artist-tags-store'
import { toast } from '../stores/toast-store'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

/** 유사도 표시 — 10% 이상은 정수, 미만은 소수 한 자리 (낮은 점수끼리 구분되게) */
function formatScore(score: number): string {
  const pct = score * 100
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
}

/**
 * 작가 태그 분석 팝업 — 좌: 이미지 / 우: artist: 태그 칩 목록(클릭 = 제외/포함).
 * 선택된 태그만 하단 텍스트로 모아 복사한다.
 */
export function ArtistTagsDialog(): React.JSX.Element {
  const t = useT()
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
          {t('ui.artistTagAnalysis')}{' '}
          <span className="text-[12px] font-normal text-faint">
            {t('ui.artistsWithASimilarArtStyleKaloscope')}
          </span>
        </DialogTitle>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted">
            <Loader2 size={18} className="animate-spin" />
            <p className="text-[13px]">{t('ui.analyzingStyleMayTakeAFewSeconds')}</p>
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
              {/* 한 줄에 하나씩 — 이름 길이와 무관하게 정렬이 흐트러지지 않게 */}
              <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
                {tags.map((tag) => {
                  const off = excluded.has(tag.label)
                  return (
                    <button
                      key={tag.label}
                      onClick={() => toggle(tag.label)}
                      title={off ? t('ui.clickToInclude') : t('ui.clickToExclude')}
                      className={cn(
                        'flex w-full shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors',
                        off
                          ? 'border-line text-faint opacity-55 hover:opacity-80'
                          : 'border-accent/50 bg-accent/10 text-ink'
                      )}
                    >
                      <Palette
                        size={11}
                        className={cn('shrink-0', off ? 'text-faint' : 'text-accent')}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{tag.label}</span>
                      <span className="shrink-0 font-mono text-[10px] text-faint">
                        {formatScore(tag.score)}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex min-h-0 flex-none flex-col">
                <p className="mb-1 text-[12px] font-medium text-muted">{t('ui.selectedTags')}</p>
                <textarea
                  readOnly
                  value={selectedText}
                  placeholder={t('ui.noTagsSelected')}
                  className="block h-24 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-2/40 p-2 font-mono text-[12px] leading-relaxed text-ink outline-none placeholder:font-sans placeholder:text-faint"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={close}>
            {t('ui.close')}
          </Button>
          <Button
            variant="accent"
            className="gap-1.5"
            disabled={!selectedText}
            onClick={() => {
              void navigator.clipboard.writeText(selectedText)
              toast(t('ui.artistTagsCopied'), 'success')
            }}
          >
            <Copy size={13} /> {t('ui.copy')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

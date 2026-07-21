import { Check, Copy, ImageOff, Loader2, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ImageMetadata } from '@shared/types'
import { useArtistTagsStore } from '../stores/artist-tags-store'
import { isSplitMeta, useMetadataStore } from '../stores/metadata-store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

const UC_LABELS: Record<number, string> = { 0: 'Heavy', 1: 'Light', 3: 'Human Focus', 4: 'None' }

/** 이미지 메타데이터 팝업 — 좌: 이미지+파라미터 / 우: 프롬프트. 체크한 요소만 적용 */
export function MetadataDialog(): React.JSX.Element {
  const open = useMetadataStore((s) => s.open)
  const loading = useMetadataStore((s) => s.loading)
  const meta = useMetadataStore((s) => s.meta)
  const error = useMetadataStore((s) => s.error)
  const imageSrc = useMetadataStore((s) => s.imageSrc)
  const src = useMetadataStore((s) => s.src)
  const close = useMetadataStore((s) => s.close)
  const applyToMain = useMetadataStore((s) => s.applyToMain)
  const showArtists = useArtistTagsStore((s) => s.show)

  // 기본 전부 체크, 시드만 해제
  const [sel, setSel] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!meta) return
    const timer = setTimeout(() => {
      setSel({
        prompt: true,
        negativePrompt: true,
        characters: true,
        quality: true,
        ucPreset: true,
        seed: false,
        steps: true,
        cfgScale: true,
        cfgRescale: true,
        sampler: true,
        noiseSchedule: true,
        resolution: true,
        variety: true
      })
    })
    return () => clearTimeout(timer)
  }, [meta])
  const toggle = (k: string): void => setSel((s) => ({ ...s, [k]: !s[k] }))

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      {/* max-h + 내부 스크롤 — 작은 창에서 다이얼로그가 화면을 넘어 버튼이 가려지는 것 방지 */}
      <DialogContent className="flex max-h-[85vh] max-w-[760px] flex-col p-0">
        <DialogTitle className="border-b border-line px-5 py-3.5 text-[15px]">
          이미지 메타데이터{' '}
          <span className="text-[12px] font-normal text-faint">— 체크한 항목만 적용</span>
        </DialogTitle>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted">
            <Loader2 size={18} className="animate-spin" /> 읽는 중…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-14 text-danger">
            <ImageOff size={30} strokeWidth={1.4} />
            <p className="text-[13px]">{error}</p>
          </div>
        ) : meta ? (
          <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-5">
            {/* 좌: 이미지(상) + 파라미터(하) */}
            <div className="flex w-[46%] shrink-0 flex-col gap-3">
              <div className="flex items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2/40">
                {imageSrc ? (
                  <img src={imageSrc} className="max-h-[240px] w-full object-contain" alt="" />
                ) : (
                  <div className="flex h-40 items-center justify-center text-faint">
                    <ImageOff size={28} strokeWidth={1.3} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Stat k="seed" label="시드" value={meta.seed} sel={sel} toggle={toggle} />
                <Stat k="steps" label="스텝" value={meta.steps} sel={sel} toggle={toggle} />
                <Stat k="cfgScale" label="CFG" value={meta.cfgScale} sel={sel} toggle={toggle} />
                <Stat
                  k="cfgRescale"
                  label="CFG Rescale"
                  value={meta.cfgRescale}
                  sel={sel}
                  toggle={toggle}
                />
                <Stat k="sampler" label="샘플러" value={meta.sampler} sel={sel} toggle={toggle} />
                <Stat
                  k="noiseSchedule"
                  label="스케줄"
                  value={meta.noiseSchedule}
                  sel={sel}
                  toggle={toggle}
                />
                <Stat
                  k="resolution"
                  label="해상도"
                  value={meta.width && meta.height ? `${meta.width}×${meta.height}` : undefined}
                  sel={sel}
                  toggle={toggle}
                />
                <Stat
                  k="variety"
                  label="Variety+"
                  value={meta.variety ? 'ON' : undefined}
                  sel={sel}
                  toggle={toggle}
                />
                <Stat
                  k="quality"
                  label="퀄리티 태그"
                  value={
                    meta.qualityToggle ? 'ON' : meta.qualityToggle === false ? 'OFF' : undefined
                  }
                  sel={sel}
                  toggle={toggle}
                />
                <Stat
                  k="ucPreset"
                  label="UC 프리셋"
                  value={
                    meta.ucPreset != null
                      ? (UC_LABELS[meta.ucPreset] ?? `#${meta.ucPreset}`)
                      : undefined
                  }
                  sel={sel}
                  toggle={toggle}
                />
                {/* 모델은 표시만 (적용 대상 아님) */}
                {meta.model && (
                  <div className="col-span-2 rounded-md border border-line bg-surface-2/40 px-2.5 py-1.5">
                    <p className="text-[10.5px] text-faint">모델</p>
                    <p className="truncate font-mono text-[12.5px] text-ink">{meta.model}</p>
                  </div>
                )}
              </div>
            </div>

            {/* 우: 프롬프트 */}
            <div className="flex min-w-0 flex-1 flex-col gap-3 self-stretch">
              {isSplitMeta(meta) ? (
                <SplitPreview meta={meta} sel={sel} toggle={toggle} />
              ) : (
                <Field
                  k="prompt"
                  label="프롬프트"
                  value={meta.prompt}
                  sel={sel}
                  toggle={toggle}
                  grow
                />
              )}
              <Field
                k="negativePrompt"
                label="네거티브"
                value={meta.negativePrompt}
                sel={sel}
                toggle={toggle}
              />
              {meta.characterPrompts && meta.characterPrompts.length > 0 && (
                <div>
                  <CheckLabel
                    checked={sel.characters}
                    onClick={() => toggle('characters')}
                    label={`캐릭터 ${meta.characterPrompts.length}`}
                  />
                  <div
                    className={cn(
                      'mt-1.5 max-h-36 space-y-1.5 overflow-y-auto',
                      !sel.characters && 'opacity-40'
                    )}
                  >
                    {meta.characterPrompts.map((c, i) => (
                      <div key={i} className="rounded-md border border-line bg-surface-2/40 p-2">
                        <p className="break-words font-mono text-[11.5px] text-ink">{c.prompt}</p>
                        {c.negativePrompt && (
                          <p className="mt-1 break-words font-mono text-[11px] text-faint">
                            uc: {c.negativePrompt}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {/* 메타데이터 없는 외부 이미지도 그림체 분석은 가능 — 좌측에 배치 */}
          <Button
            variant="ghost"
            className="gap-1.5 text-muted"
            disabled={!src}
            onClick={() => {
              close()
              if (src) void showArtists(src)
            }}
          >
            <Palette size={13} className="text-orange-400" /> 작가 태그 분석
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close}>
            닫기
          </Button>
          <Button variant="accent" disabled={!meta} onClick={() => applyToMain(sel)}>
            메인에 적용
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SplitPreview({
  meta,
  sel,
  toggle
}: {
  meta: ImageMetadata
  sel: Record<string, boolean>
  toggle: (k: string) => void
}): React.JSX.Element {
  const parts = meta.promptParts
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1">
        <CheckLabel checked={sel.prompt} onClick={() => toggle('prompt')} label="프롬프트 3분할" />
      </div>
      <div className={cn('flex min-h-0 flex-1 flex-col gap-1.5', !sel.prompt && 'opacity-40')}>
        <Part label="고정" value={parts?.base ?? ''} />
        <Part label="가변" value={parts?.additional ?? ''} />
        <Part label="디테일" value={parts?.detail ?? ''} />
      </div>
    </div>
  )
}

function Part({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-md border border-line bg-surface-2/40 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10.5px] font-medium text-faint">{label}</p>
        <CopyButton value={value} label={`${label} 복사`} />
      </div>
      <ReadonlyPrompt value={value} className="min-h-24 flex-1 text-[12px]" />
    </div>
  )
}

/** 체크 표시 + 라벨 (클릭 토글) */
function CheckLabel({
  checked,
  onClick,
  label
}: {
  checked?: boolean
  onClick: () => void
  label: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink"
    >
      <span
        className={cn(
          'grid size-4 place-items-center rounded border transition-colors',
          checked ? 'border-accent bg-accent text-white' : 'border-line bg-surface'
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      {label}
    </button>
  )
}

function Field({
  k,
  label,
  value,
  sel,
  toggle,
  grow
}: {
  k: string
  label: string
  value: string
  sel: Record<string, boolean>
  toggle: (k: string) => void
  grow?: boolean
}): React.JSX.Element {
  return (
    <div className={grow ? 'flex min-h-0 flex-1 flex-col' : 'flex flex-none flex-col'}>
      <div className="mb-1">
        <div className="flex items-center justify-between gap-2">
          <CheckLabel checked={sel[k]} onClick={() => toggle(k)} label={label} />
          <CopyButton value={value} label={`${label} 복사`} />
        </div>
      </div>
      <ReadonlyPrompt
        value={value}
        className={cn(
          'rounded-md border border-line bg-surface-2/40 p-2 text-[12.5px]',
          grow ? 'min-h-[180px] flex-1' : 'h-36',
          !sel[k] && 'opacity-40'
        )}
      />
    </div>
  )
}

function ReadonlyPrompt({
  value,
  className
}: {
  value: string
  className?: string
}): React.JSX.Element {
  return (
    <textarea
      readOnly
      value={value}
      placeholder="(없음)"
      className={cn(
        'block w-full resize-none overflow-y-auto whitespace-pre-wrap break-words bg-transparent font-mono leading-relaxed text-ink outline-none placeholder:font-sans placeholder:text-faint',
        'cursor-text select-text',
        className
      )}
    />
  )
}

function CopyButton({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <button
      className="grid size-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-35"
      title={label}
      disabled={!value}
      onClick={() => {
        if (value) void navigator.clipboard.writeText(value)
      }}
    >
      <Copy size={13} />
    </button>
  )
}

function Stat({
  k,
  label,
  value,
  sel,
  toggle
}: {
  k: string
  label: string
  value?: string | number
  sel: Record<string, boolean>
  toggle: (k: string) => void
}): React.JSX.Element | null {
  if (value == null || value === '') return null
  const checked = sel[k]
  return (
    <button
      onClick={() => toggle(k)}
      className={cn(
        'flex items-center gap-2 rounded-md border bg-surface-2/40 px-2 py-1.5 text-left transition-colors',
        checked ? 'border-accent/50' : 'border-line opacity-50'
      )}
    >
      <span
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded border transition-colors',
          checked ? 'border-accent bg-accent text-white' : 'border-line bg-surface'
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[10.5px] text-faint">{label}</span>
        <span className="block truncate font-mono text-[12.5px] text-ink">{value}</span>
      </span>
    </button>
  )
}

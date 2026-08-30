import { Check, Copy, ImageOff, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ImageMetadata } from '@shared/types'
import { isSplitMeta, useMetadataStore } from '../stores/metadata-store'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

const UC_LABELS: Record<number, string> = { 0: 'Heavy', 1: 'Light', 3: 'Human Focus', 4: 'None' }

/** 이미지 메타데이터 팝업 — 좌: 이미지+파라미터 / 우: 프롬프트. 체크한 요소만 적용 */
export function MetadataDialog(): React.JSX.Element {
  const t = useT()
  const open = useMetadataStore((s) => s.open)
  const loading = useMetadataStore((s) => s.loading)
  const meta = useMetadataStore((s) => s.meta)
  const error = useMetadataStore((s) => s.error)
  const imageSrc = useMetadataStore((s) => s.imageSrc)
  const close = useMetadataStore((s) => s.close)
  const applyToMain = useMetadataStore((s) => s.applyToMain)

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
          {t('ui.imageMetadata')}{' '}
          <span className="text-[12px] font-normal text-faint">
            {t('ui.onlyCheckedItemsAreApplied')}
          </span>
        </DialogTitle>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted">
            <Loader2 size={18} className="animate-spin" /> {t('ui.reading')}
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
                <Stat k="seed" label={t('ui.seed')} value={meta.seed} sel={sel} toggle={toggle} />
                <Stat
                  k="steps"
                  label={t('ui.steps')}
                  value={meta.steps}
                  sel={sel}
                  toggle={toggle}
                />
                <Stat k="cfgScale" label="CFG" value={meta.cfgScale} sel={sel} toggle={toggle} />
                <Stat
                  k="cfgRescale"
                  label="CFG Rescale"
                  value={meta.cfgRescale}
                  sel={sel}
                  toggle={toggle}
                />
                <Stat
                  k="sampler"
                  label={t('ui.sampler')}
                  value={meta.sampler}
                  sel={sel}
                  toggle={toggle}
                />
                <Stat
                  k="noiseSchedule"
                  label={t('ui.schedule')}
                  value={meta.noiseSchedule}
                  sel={sel}
                  toggle={toggle}
                />
                <Stat
                  k="resolution"
                  label={t('ui.resolution')}
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
                  label={t('ui.qualityTags')}
                  value={
                    meta.qualityToggle ? 'ON' : meta.qualityToggle === false ? 'OFF' : undefined
                  }
                  sel={sel}
                  toggle={toggle}
                />
                <Stat
                  k="ucPreset"
                  label={t('ui.ucPreset')}
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
                    <p className="text-[10.5px] text-faint">{t('ui.model')}</p>
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
                  label={t('ui.prompt')}
                  value={meta.prompt}
                  sel={sel}
                  toggle={toggle}
                  grow
                />
              )}
              <Field
                k="negativePrompt"
                label={t('ui.negative')}
                value={meta.negativePrompt}
                sel={sel}
                toggle={toggle}
              />
              {meta.characterPrompts && meta.characterPrompts.length > 0 && (
                <div>
                  <CheckLabel
                    checked={sel.characters}
                    onClick={() => toggle('characters')}
                    label={t('ui.characterValue', meta.characterPrompts.length)}
                  />
                  <div
                    className={cn(
                      'mt-1.5 max-h-48 space-y-1.5 overflow-y-auto',
                      !sel.characters && 'opacity-40'
                    )}
                  >
                    {meta.characterPrompts.map((c, i) => (
                      <div key={i} className="rounded-md border border-line bg-surface-2/40 p-2">
                        <div className="mb-0.5 flex items-center justify-between gap-2">
                          <p className="text-[10.5px] font-medium text-faint">
                            {t('ui.characterValue', i + 1)}
                          </p>
                          <CopyButton
                            value={c.prompt}
                            label={t('ui.copyCharacterValuePrompt', i + 1)}
                          />
                        </div>
                        {/* body의 user-select:none 때문에 <p>는 드래그 선택이 막힌다 — textarea여야 선택·스크롤 가능 */}
                        <ReadonlyPrompt value={c.prompt} className="h-14 text-[11.5px]" />
                        {c.negativePrompt && (
                          <>
                            <div className="mb-0.5 mt-1 flex items-center justify-between gap-2">
                              <p className="text-[10.5px] font-medium text-faint">uc</p>
                              <CopyButton
                                value={c.negativePrompt}
                                label={t('ui.copyCharacterValueNegative', i + 1)}
                              />
                            </div>
                            <ReadonlyPrompt value={c.negativePrompt} className="h-10 text-[11px]" />
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={close}>
            {t('ui.close')}
          </Button>
          <Button variant="accent" disabled={!meta} onClick={() => applyToMain(sel)}>
            {t('ui.applyToMain')}
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
  const t = useT()
  const parts = meta.promptParts
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-1">
        <CheckLabel
          checked={sel.prompt}
          onClick={() => toggle('prompt')}
          label={t('ui.value3PartPromptSplit')}
        />
      </div>
      <div className={cn('flex flex-1 flex-col gap-1.5', !sel.prompt && 'opacity-40')}>
        <Part label={t('ui.fixed')} value={parts?.base ?? ''} />
        <Part label={t('ui.variable')} value={parts?.additional ?? ''} />
        <Part label={t('ui.detail')} value={parts?.detail ?? ''} />
      </div>
    </div>
  )
}

// 래퍼에 min-h-0을 주면 안 된다 — 래퍼만 0까지 눌리고 안쪽 textarea는 자기 min-height를 지켜서
// 박스 밖으로 삐져나와 아래 섹션 위에 그려진다(작은 화면에서 UI 깨짐). min-height:auto로 두면
// 대신 바깥 본문(overflow-y-auto)이 스크롤된다.
function Part({ label, value }: { label: string; value: string }): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-1 flex-col rounded-md border border-line bg-surface-2/40 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10.5px] font-medium text-faint">{label}</p>
        <CopyButton value={value} label={t('ui.copyValue', label)} />
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
  const t = useT()
  return (
    <div className={grow ? 'flex flex-1 flex-col' : 'flex flex-none flex-col'}>
      <div className="mb-1">
        <div className="flex items-center justify-between gap-2">
          <CheckLabel checked={sel[k]} onClick={() => toggle(k)} label={label} />
          <CopyButton value={value} label={t('ui.copyValue', label)} />
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
  const t = useT()
  return (
    <textarea
      readOnly
      value={value}
      placeholder={t('ui.none')}
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

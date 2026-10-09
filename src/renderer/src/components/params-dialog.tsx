import { Dice5, Lock, LockOpen } from 'lucide-react'
import type { UcPresetIndex } from '@shared/types'
import { NOISE_SCHEDULES, SAMPLERS, UC_PRESET_OPTIONS } from '../lib/constants'
import { useT } from '../lib/i18n'
import {
  baseModelForSelect,
  effortOf,
  generationDefaultsForModel,
  hasEffortToggle,
  inpaintingModelFor,
  isMediumEffortModel,
  MEDIUM_EFFORT_FIXED,
  modelCapabilities,
  withEffort,
  type GenerationEffort
} from '@shared/nai-models'
import { cn } from '../lib/utils'
import { ResolutionPicker } from './resolution-picker'
import { useGenerationStore } from '../stores/generation-store'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      {children}
    </div>
  )
}

export function ParamsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const request = useGenerationStore((s) => s.request)
  const source = useGenerationStore((s) => s.source)
  const patch = useGenerationStore((s) => s.patchRequest)
  const seedLocked = useGenerationStore((s) => s.seedLocked)
  const setSeedLocked = useGenerationStore((s) => s.setSeedLocked)
  const capabilities = modelCapabilities(request.model)
  const effectiveModel = source?.maskBase64 ? inpaintingModelFor(request.model) : request.model
  const supportsTransparency = modelCapabilities(effectiveModel).transparency
  // Medium effort는 steps·sampler·UC 프리셋을 고정하고 CFG Rescale이 없다.
  // 사용자의 High 값은 그대로 보존하고 화면에만 고정값을 보여 준다.
  const medium = isMediumEffortModel(request.model)
  const fixedTitle = medium ? t('ui.fixedAtMediumEffort') : undefined
  const shownSteps = medium ? MEDIUM_EFFORT_FIXED.steps : request.steps
  const shownSampler = medium ? MEDIUM_EFFORT_FIXED.sampler : request.sampler
  const shownUcPreset = medium ? MEDIUM_EFFORT_FIXED.ucPreset : request.ucPreset

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] p-5">
        <DialogTitle className="mb-4">{t('ui.generationParameters')}</DialogTitle>
        <div className="grid gap-4">
          <Row label={t('ui.model')}>
            <Select
              value={baseModelForSelect(request.model)}
              onValueChange={(model) => patch({ model, ...generationDefaultsForModel(model) })}
            >
              <SelectTrigger className="w-52" aria-label={t('ui.model')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nai-diffusion-5-curated">V5 Curated</SelectItem>
                <SelectItem value="nai-diffusion-5-full">V5 Full</SelectItem>
                <SelectItem value="nai-diffusion-4-5-full">V4.5 Full</SelectItem>
                <SelectItem value="nai-diffusion-4-5-curated">V4.5 Curated</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          {hasEffortToggle(request.model) && (
            <div className="grid gap-1.5">
              <Row label={t('ui.effort')}>
                <ToggleGroup
                  type="single"
                  value={effortOf(request.model)}
                  onValueChange={(v) => {
                    if (v) patch({ model: withEffort(request.model, v as GenerationEffort) })
                  }}
                  className="inline-flex w-52 rounded-md bg-surface-2 p-0.5"
                  aria-label={t('ui.effort')}
                  title={t('ui.effortTooltip')}
                >
                  {(['medium', 'high'] as const).map((level) => (
                    <ToggleGroupItem
                      key={level}
                      value={level}
                      // 다크 테마에서 bg-paper는 바탕보다 어두워 선택 상태가 뒤집혀 보이므로,
                      // 앱의 다른 선택 표시(탭·디렉터 카드)와 같은 accent 계열로 표시한다.
                      className={cn(
                        'h-7 flex-1 rounded-[5px] border border-transparent text-[12.5px] text-muted hover:text-ink',
                        'data-[state=on]:border-accent/40 data-[state=on]:bg-accent-soft data-[state=on]:font-medium data-[state=on]:text-accent'
                      )}
                    >
                      {t(level === 'medium' ? 'ui.effortMedium' : 'ui.effortHigh')}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Row>
              {medium && (
                <p className="text-[11.5px] leading-snug text-faint">{t('ui.effortMediumHint')}</p>
              )}
            </div>
          )}

          <Row label={t('ui.resolution')}>
            <ResolutionPicker
              className="w-52"
              width={request.width}
              height={request.height}
              ariaLabel={t('ui.resolution')}
              onPick={(width, height) => patch({ width, height })}
            />
          </Row>

          <Row label={t('ui.seed')}>
            <div className="flex w-52 items-center gap-1.5">
              <Input
                className="font-mono"
                aria-label={t('ui.seed')}
                value={request.seed < 0 ? '' : String(request.seed)}
                placeholder={t('ui.random')}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  patch({ seed: e.target.value === '' || Number.isNaN(n) ? -1 : n })
                }}
              />
              <Button
                size="icon"
                variant={seedLocked ? 'accent' : 'ghost'}
                title={seedLocked ? t('ui.seedLocked') : t('ui.lockSeed')}
                onClick={() => setSeedLocked(!seedLocked)}
              >
                {seedLocked ? <Lock size={14} /> : <LockOpen size={14} />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title={t('ui.randomSeed')}
                onClick={() => patch({ seed: -1 })}
              >
                <Dice5 size={14} />
              </Button>
            </div>
          </Row>

          <Row label={t('ui.stepsValue', shownSteps)}>
            <Slider
              className="w-52"
              aria-label={t('ui.stepsValue', shownSteps)}
              title={fixedTitle}
              disabled={medium}
              min={1}
              max={50}
              step={1}
              value={[shownSteps]}
              onValueChange={([v]) => patch({ steps: v })}
            />
          </Row>

          <Row label={`CFG ${request.cfgScale}`}>
            <Slider
              className="w-52"
              aria-label={`CFG ${request.cfgScale}`}
              min={1}
              max={10}
              step={0.1}
              value={[request.cfgScale]}
              onValueChange={([v]) => patch({ cfgScale: Math.round(v * 10) / 10 })}
            />
          </Row>

          <Row label={medium ? `Rescale —` : `Rescale ${request.cfgRescale}`}>
            <Slider
              className="w-52"
              aria-label={`Rescale ${request.cfgRescale}`}
              title={medium ? t('ui.unavailableAtMediumEffort') : undefined}
              disabled={medium}
              min={0}
              max={1}
              step={0.02}
              value={[medium ? 0 : request.cfgRescale]}
              onValueChange={([v]) => patch({ cfgRescale: Math.round(v * 100) / 100 })}
            />
          </Row>

          <Row label={t('ui.sampler')}>
            <Select
              value={shownSampler}
              disabled={medium}
              onValueChange={(v) => patch({ sampler: v })}
            >
              <SelectTrigger className="w-52" aria-label={t('ui.sampler')} title={fixedTitle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SAMPLERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          {capabilities.noiseScheduleSelection && (
            <Row label={t('ui.noiseSchedule')}>
              <Select
                value={request.noiseSchedule}
                onValueChange={(v) => patch({ noiseSchedule: v })}
              >
                <SelectTrigger className="w-52" aria-label={t('ui.noiseSchedule')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOISE_SCHEDULES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          )}

          <Row label={t('ui.ucPreset')}>
            <Select
              value={String(shownUcPreset)}
              disabled={medium}
              onValueChange={(v) => patch({ ucPreset: Number(v) as UcPresetIndex })}
            >
              <SelectTrigger className="w-52" aria-label={t('ui.ucPreset')} title={fixedTitle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UC_PRESET_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Row label={t('ui.qualityTags')}>
            <Switch
              aria-label={t('ui.qualityTags')}
              checked={request.qualityToggle}
              onCheckedChange={(v) => patch({ qualityToggle: v })}
            />
          </Row>

          {capabilities.variety && (
            <Row label="Variety+">
              <Switch
                aria-label="Variety+"
                checked={request.variety}
                onCheckedChange={(v) => patch({ variety: v })}
              />
            </Row>
          )}

          {supportsTransparency && (
            <Row label={t('ui.transparentBackground')}>
              <Switch
                aria-label={t('ui.transparentBackground')}
                checked={request.transparentBackground ?? false}
                onCheckedChange={(v) => patch({ transparentBackground: v })}
              />
            </Row>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

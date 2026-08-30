import { Minus, Pencil, Plus, X } from 'lucide-react'
import { effectiveGenerationStrength } from '@shared/anlas'
import { kindMeta } from '../lib/kind-icon'
import { useT } from '../lib/i18n'
import { useGenerationStore } from '../stores/generation-store'
import { Slider } from './ui/slider'

/** i2i/인페인트 배너의 고정 높이(px) — 프롬프트 위치 보존용 (NAIS2 크기감) */
export const SOURCE_BANNER_HEIGHT = 340

/**
 * i2i/인페인트 소스 배너 — NAIS2 스타일: 제목바 + 큰 이미지(꽉 차게) + 파라미터.
 */
export function SourceBanner(): React.JSX.Element | null {
  const t = useT()
  const source = useGenerationStore((s) => s.source)
  const setSource = useGenerationStore((s) => s.setSource)
  const editSourceMask = useGenerationStore((s) => s.editSourceMask)
  const request = useGenerationStore((s) => s.request)
  const patch = useGenerationStore((s) => s.patchRequest)
  if (!source) return null

  const isInpaint = Boolean(source.maskBase64)
  const { Icon, className } = kindMeta(isInpaint ? 'inpaint' : 'i2i')
  const strength = effectiveGenerationStrength(true, isInpaint, request.i2iStrength)
  const noise = request.i2iNoise ?? 0

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border border-line bg-paper"
      style={{ height: SOURCE_BANNER_HEIGHT }}
    >
      {/* 제목바 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2/50 px-2.5">
        <Icon size={15} className={className} />
        <span className="text-[12.5px] font-medium text-ink">
          {isInpaint ? t('ui.inpaintMode') : t('ui.i2iMode')}
        </span>
        <div className="flex-1" />
        {/* 마스크 재편집 (NAIS2와 동일 위치 — X 왼쪽). 기존에 칠한 영역을 그대로 불러와 다듬는다 */}
        <button
          className="grid size-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          title={isInpaint ? t('ui.editMaskAgain') : t('ui.drawAMaskToSwitchToInpaint')}
          onClick={editSourceMask}
        >
          <Pencil size={14} />
        </button>
        <button
          className="grid size-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          title={t('ui.clearSource')}
          onClick={() => setSource(null)}
        >
          <X size={15} />
        </button>
      </div>

      {/* 이미지 — 전체가 보이게(object-contain), 남는 여백은 테마 배경색 */}
      <div className="relative min-h-0 flex-1 bg-surface-2">
        <img
          src={`data:image/png;base64,${source.imageBase64}`}
          className="size-full object-contain"
          draggable={false}
          alt=""
        />
        {isInpaint && source.maskBase64 && (
          // 마스크(흰=칠한 영역)를 luminance 마스크로 써서 칠한 부분만 빨갛게 표시
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundColor: 'rgba(233, 94, 80, 0.55)',
              maskImage: `url(data:image/png;base64,${source.maskBase64})`,
              maskSize: 'contain',
              maskRepeat: 'no-repeat',
              maskPosition: 'center',
              maskMode: 'luminance'
            }}
          />
        )}
      </div>

      {/* 파라미터 — 이미지 여백과 같은 배경색으로 이어지게. i2i·인페인트 모두 strength/noise 사용 */}
      <div className="flex flex-col gap-1.5 bg-surface-2 px-2.5 py-2">
        <ParamRow
          label="Strength"
          value={strength}
          onChange={(v) => patch({ i2iStrength: v })}
          min={0.01}
        />
        <ParamRow label="Noise" value={noise} onChange={(v) => patch({ i2iNoise: v })} min={0} />
      </div>
    </div>
  )
}

function ParamRow({
  label,
  value,
  min,
  onChange
}: {
  label: string
  value: number
  min: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const step = 0.01
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[11.5px] text-muted">{label}</span>
      <button
        className="grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink"
        onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))}
      >
        <Minus size={12} />
      </button>
      <Slider
        className="flex-1"
        min={min}
        max={1}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(Math.round(v * 100) / 100)}
      />
      <button
        className="grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink"
        onClick={() => onChange(Math.min(1, Math.round((value + step) * 100) / 100))}
      >
        <Plus size={12} />
      </button>
      <span className="w-8 shrink-0 text-right font-mono text-[11.5px] text-ink">
        {value.toFixed(2)}
      </span>
    </div>
  )
}

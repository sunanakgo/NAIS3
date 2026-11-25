import type { ImageMetadata } from './types'
import { QUALITY_TAGS_SUFFIX, UC_PRESETS_V45_FULL } from './nai-presets'
import { parseMetadataVibes, vibeModelFor } from './metadata-vibes'

/** NAI 요청 parameters / PNG Comment 중 메타데이터로 쓰는 필드 */
export interface NaiMetadataParams {
  steps?: number
  scale?: number
  cfg_rescale?: number
  sampler?: string
  noise_schedule?: string
  seed?: number
  width?: number
  height?: number
  skip_cfg_above_sigma?: number | null
  negative_prompt?: string
  ucPreset?: number
  qualityToggle?: boolean
  use_coords?: boolean
  straight_alpha?: boolean
  v4_prompt?: {
    use_coords?: boolean
    caption?: { char_captions?: { char_caption?: string; centers?: { x: number; y: number }[] }[] }
  }
  v4_negative_prompt?: { caption?: { char_captions?: { char_caption?: string }[] } }
}

/** NAIS3가 PNG 청크·payload_json에 따로 남기는 로컬 메타데이터 */
export interface LocalMetadataParams {
  promptParts?: ImageMetadata['promptParts']
}

/** 병합된 네거티브에서 UC 프리셋 인덱스 역추적 (프리셋 텍스트가 접두인 것 중 가장 긴 것) */
function inferUcPreset(uc: string): number | undefined {
  let best: number | undefined
  let bestLen = -1
  for (const [k, preset] of Object.entries(UC_PRESETS_V45_FULL)) {
    if (!preset) continue
    if ((uc === preset || uc.startsWith(preset + ', ')) && preset.length > bestLen) {
      best = Number(k)
      bestLen = preset.length
    }
  }
  return best
}

/** 파라미터 객체 + 프롬프트/모델 → 정규화 메타 */
export function normalizeImageMetadata(
  params: NaiMetadataParams,
  extra: {
    prompt: string
    uc: string
    model?: string
    software?: string
    local?: LocalMetadataParams
  }
): ImageMetadata {
  const posChars = params.v4_prompt?.caption?.char_captions ?? []
  const negChars = params.v4_negative_prompt?.caption?.char_captions ?? []
  const characterPrompts = posChars.map((c, i) => ({
    prompt: c?.char_caption ?? '',
    negativePrompt: negChars[i]?.char_caption ?? '',
    center: c?.centers?.[0]
  }))
  const vibes = parseMetadataVibes(params as Record<string, unknown>)
  return {
    prompt: extra.prompt,
    promptParts: extra.local?.promptParts,
    negativePrompt: extra.uc,
    seed: params.seed,
    steps: params.steps,
    cfgScale: params.scale,
    cfgRescale: params.cfg_rescale,
    sampler: params.sampler,
    noiseSchedule: params.noise_schedule,
    width: params.width,
    height: params.height,
    model: extra.model,
    software: extra.software,
    variety: params.skip_cfg_above_sigma != null,
    useCoords: params.v4_prompt?.use_coords ?? params.use_coords ?? false,
    // ucPreset·qualityToggle: 직접 필드 우선, 없으면 병합 문자열에서 역추적
    qualityToggle: params.qualityToggle ?? extra.prompt.endsWith(QUALITY_TAGS_SUFFIX),
    ucPreset: params.ucPreset ?? inferUcPreset(extra.uc),
    ...(params.straight_alpha != null ? { transparentBackground: params.straight_alpha } : {}),
    characterPrompts: characterPrompts.length > 0 ? characterPrompts : undefined,
    ...(vibes ? { vibes, vibeModel: vibeModelFor(extra.model) } : {})
  }
}

const GENERATION_ACTIONS = new Set(['generate', 'img2img', 'infill'])

/**
 * 우리 payload_json({action, input, model, parameters, nais3}) → 정규화 메타.
 * 데스크톱(DB)과 브라우저 작업 공간(IndexedDB)이 같이 쓴다.
 */
export function metadataFromPayloadJson(json: string): ImageMetadata | null {
  try {
    const p = JSON.parse(json) as {
      action?: string
      input?: string
      model?: string
      parameters?: NaiMetadataParams
      nais3?: LocalMetadataParams
    }
    if (!p.parameters) return null
    const meta = normalizeImageMetadata(p.parameters, {
      prompt: p.input ?? '',
      uc: p.parameters.negative_prompt ?? '',
      model: p.model,
      software: 'NAIS3',
      local: p.nais3
    })
    return {
      ...meta,
      ...(p.model ? { modelId: p.model } : {}),
      ...(p.action && GENERATION_ACTIONS.has(p.action)
        ? { generationAction: p.action as NonNullable<ImageMetadata['generationAction']> }
        : {})
    }
  } catch {
    return null
  }
}

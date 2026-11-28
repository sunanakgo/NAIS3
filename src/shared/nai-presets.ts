import type { UcPresetIndex } from './types'
import { stripDisabledTags } from './prompt-tags'

/**
 * NAI 웹이 클라이언트에서 병합하는 프리셋 텍스트.
 * payload 조립(메인)과 토큰 카운트 표시(렌더러)가 공유한다.
 */

/** V4.5 Full과 V5 Standard: 프롬프트 뒤에 그대로 이어 붙는다. */
export const QUALITY_TAGS_SUFFIX = ', very aesthetic, masterpiece, no text'
export const V5_QUALITY_STANDARD_SUFFIX = QUALITY_TAGS_SUFFIX
export const V5_QUALITY_LIGHT_SUFFIX = ', very aesthetic, amazing quality, no text'

const UC_HEAVY =
  'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'
const V5_UC_HEAVY = UC_HEAVY.replace(/^nsfw, /, '')

/** 인덱스 매핑 (V4.5 실캡처): 0=Heavy, 1=Light, 3=Human Focus, 4=None. */
export const UC_PRESETS_V45_FULL: Record<UcPresetIndex, string> = {
  0: UC_HEAVY,
  1: 'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
  2: '',
  3: UC_HEAVY + ', @_@, mismatched pupils, glowing eyes, bad anatomy',
  4: ''
}

/** V5 출시 웹 번들. 기존 UI 숫자 인덱스를 프리셋 ID에 대응시킨다. */
export const UC_PRESETS_V5: Record<UcPresetIndex, string> = {
  0: V5_UC_HEAVY,
  1: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
  2: V5_UC_HEAVY,
  3: V5_UC_HEAVY + ', @_@, mismatched pupils, glowing eyes, bad anatomy',
  4: ''
}

/** 웹 메타데이터/API가 쓰는 공통 preset hint 숫자. */
export const QUALITY_PRESET_HINT = { none: 0, standard: 1, light: 3 } as const
export const UC_PRESET_HINT: Record<UcPresetIndex, number> = { 0: 2, 1: 3, 2: 2, 3: 4, 4: 0 }

/** #로 시작하는 줄만 통째로 주석으로 취급한다. */
export function removeComments(prompt: string): string {
  return stripDisabledTags(prompt)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

export function mergeQualityTags(prompt: string, qualityToggle: boolean): string {
  if (!qualityToggle) return prompt
  return prompt + QUALITY_TAGS_SUFFIX
}

/** V4.5 호환 공개 함수. */
export function mergeUcPreset(negativePrompt: string, ucPreset: UcPresetIndex): string {
  const preset = UC_PRESETS_V45_FULL[ucPreset]
  if (!preset) return negativePrompt
  return negativePrompt ? preset + ', ' + negativePrompt : preset
}

export function mergeUcPresetForModel(
  negativePrompt: string,
  ucPreset: UcPresetIndex,
  model: string,
  positivePrompt = ''
): string {
  const preset = model.startsWith('nai-diffusion-5-')
    ? UC_PRESETS_V5[ucPreset]
    : UC_PRESETS_V45_FULL[ucPreset]
  if (!preset) return negativePrompt
  let merged = negativePrompt ? preset + ', ' + negativePrompt : preset
  const fullNeedsNsfw =
    model.startsWith('nai-diffusion-5-full') && !positivePrompt.toLowerCase().includes('nsfw')
  if (fullNeedsNsfw) merged = `nsfw, ${merged}`
  return merged
}

import type { UcPresetIndex } from './types'

/**
 * NAI 웹이 클라이언트에서 병합하는 프리셋 텍스트 (실캡처 확정).
 * payload 조립(메인)과 토큰 카운트 표시(렌더러)가 공유한다 —
 * 카운트는 병합 "후" 텍스트 기준이어야 웹 표시와 일치한다.
 */

/** 실캡처 확정 (V4.5 full): 프롬프트 "뒤"에 그대로 이어 붙는다 */
export const QUALITY_TAGS_SUFFIX = ', very aesthetic, masterpiece, no text'

const UC_HEAVY =
  'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'

/** 인덱스 매핑 (실캡처): 0=Heavy, 1=Light, 3=Human Focus, 4=None. 2는 미사용 */
export const UC_PRESETS_V45_FULL: Record<UcPresetIndex, string> = {
  0: UC_HEAVY,
  1: 'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
  2: '',
  3: UC_HEAVY + ', @_@, mismatched pupils, glowing eyes, bad anatomy',
  4: ''
}

/**
 * 주석 제거 — NAIS2와 동일: #로 "시작하는 줄"만 통째로 주석.
 * 줄 중간의 #는 태그의 일부로 유지 (예: sours#OOO 같은 아티스트 태그)
 */
export function removeComments(prompt: string): string {
  return prompt
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

export function mergeQualityTags(prompt: string, qualityToggle: boolean): string {
  if (!qualityToggle) return prompt
  return prompt + QUALITY_TAGS_SUFFIX
}

/** 캡처 확정: 프리셋 텍스트 + ", " + 유저 네거티브 순서로 병합 */
export function mergeUcPreset(negativePrompt: string, ucPreset: UcPresetIndex): string {
  const preset = UC_PRESETS_V45_FULL[ucPreset]
  if (!preset) return negativePrompt
  return negativePrompt ? preset + ', ' + negativePrompt : preset
}

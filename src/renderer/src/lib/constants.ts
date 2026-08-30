import type { UcPresetIndex } from '@shared/types'
import type { MessageId } from '@shared/i18n'

export const SAMPLERS = [
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { value: 'ddim_v3', label: 'DDIM' }
] as const

export const NOISE_SCHEDULES = [
  { value: 'karras', label: 'Karras' },
  { value: 'native', label: 'Native' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'polyexponential', label: 'Polyexponential' }
] as const

export const RESOLUTIONS: readonly { label: MessageId; width: number; height: number }[] = [
  { label: 'ui.portrait8321216', width: 832, height: 1216 },
  { label: 'ui.landscape1216832', width: 1216, height: 832 },
  { label: 'ui.square10241024', width: 1024, height: 1024 },
  { label: 'ui.largePortrait10241536', width: 1024, height: 1536 },
  { label: 'ui.largeLandscape15361024', width: 1536, height: 1024 },
  { label: 'ui.largeSquare14721472', width: 1472, height: 1472 },
  { label: 'ui.portraitWallpaper10881920', width: 1088, height: 1920 },
  { label: 'ui.landscapeWallpaper19201088', width: 1920, height: 1088 },
  { label: 'ui.smallPortrait512768', width: 512, height: 768 },
  { label: 'ui.smallLandscape768512', width: 768, height: 512 },
  { label: 'ui.smallSquare640640', width: 640, height: 640 }
]

/** 실캡처 확정 매핑 — 2는 미사용이라 UI에 노출하지 않는다 */
export const UC_PRESET_OPTIONS: { value: UcPresetIndex; label: string }[] = [
  { value: 0, label: 'Heavy' },
  { value: 1, label: 'Light' },
  { value: 3, label: 'Human Focus' },
  { value: 4, label: 'None' }
]

export function imageUrl(filePath: string): string {
  return `nais-image://local/?path=${encodeURIComponent(filePath)}`
}

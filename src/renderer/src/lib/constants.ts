import type { UcPresetIndex } from '@shared/types'

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

export const RESOLUTIONS = [
  { label: '세로 (832×1216)', width: 832, height: 1216 },
  { label: '가로 (1216×832)', width: 1216, height: 832 },
  { label: '정사각 (1024×1024)', width: 1024, height: 1024 },
  { label: '세로 대형 (1024×1536)', width: 1024, height: 1536 },
  { label: '가로 대형 (1536×1024)', width: 1536, height: 1024 },
  { label: '정사각 대형 (1472×1472)', width: 1472, height: 1472 },
  { label: '세로 배경화면 (1088×1920)', width: 1088, height: 1920 },
  { label: '가로 배경화면 (1920×1088)', width: 1920, height: 1088 },
  { label: '세로 소형 (512×768)', width: 512, height: 768 },
  { label: '가로 소형 (768×512)', width: 768, height: 512 },
  { label: '정사각 소형 (640×640)', width: 640, height: 640 }
] as const

/** 실캡처 확정 매핑 — 2는 미사용이라 UI에 노출하지 않는다 */
export const UC_PRESET_OPTIONS: { value: UcPresetIndex; label: string }[] = [
  { value: 0, label: 'Heavy' },
  { value: 1, label: 'Light' },
  { value: 3, label: 'Human Focus' },
  { value: 4, label: 'None' }
]

export function imageUrl(filePath: string): string {
  if (filePath.startsWith('data:') || filePath.startsWith('blob:')) return filePath
  return `nais-image://local/?path=${encodeURIComponent(filePath)}`
}

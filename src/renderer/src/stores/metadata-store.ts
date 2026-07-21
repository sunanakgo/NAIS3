import { create } from 'zustand'
import type { ImageMetadata, UcPresetIndex } from '@shared/types'
import { QUALITY_TAGS_SUFFIX, UC_PRESETS_V45_FULL } from '@shared/nai-presets'
import { imageUrl } from '../lib/constants'
import { useCharactersStore } from './characters-store'
import { mergePromptParts, useGenerationStore } from './generation-store'
import { useLayoutStore } from './layout-store'
import { usePromptPresetsStore } from './prompt-presets-store'
import { toast } from './toast-store'

/** 실질적으로 3분할인지 — base만 있고 가변/디테일이 비었으면 단일 프롬프트로 취급 */
export function isSplitMeta(meta: ImageMetadata): boolean {
  const p = meta.promptParts
  return !!p && !!(p.additional?.trim() || p.detail?.trim())
}

/** 병합된 프롬프트/네거티브에서 프리셋을 벗겨 원본(raw)만 남긴다 → 재병합으로 동일 재현 */
function stripQuality(prompt: string): string {
  return prompt.endsWith(QUALITY_TAGS_SUFFIX)
    ? prompt.slice(0, -QUALITY_TAGS_SUFFIX.length)
    : prompt
}
function stripUcPreset(uc: string, idx: number): string {
  const preset = UC_PRESETS_V45_FULL[idx as keyof typeof UC_PRESETS_V45_FULL]
  if (!preset) return uc
  if (uc === preset) return ''
  return uc.startsWith(preset + ', ') ? uc.slice(preset.length + 2) : uc
}

interface MetadataState {
  open: boolean
  loading: boolean
  meta: ImageMetadata | null
  error: string | null
  /** 팝업에 표시할 이미지 src (파일=nais-image, 드롭=data URL) */
  imageSrc: string | null
  /** 파일 경로 또는 base64(외부 드롭)로 메타데이터 팝업 열기 */
  show: (src: { filePath?: string; base64?: string }) => Promise<void>
  close: () => void
  /** 선택된 요소만 메인 생성 설정으로 불러오기 */
  applyToMain: (sel: Record<string, boolean>) => void
}

export const useMetadataStore = create<MetadataState>((set, get) => ({
  open: false,
  loading: false,
  meta: null,
  error: null,
  imageSrc: null,

  show: async (src) => {
    const imageSrc = src.base64
      ? src.base64.startsWith('data:')
        ? src.base64
        : `data:image/png;base64,${src.base64}`
      : src.filePath
        ? imageUrl(src.filePath)
        : null
    set({ open: true, loading: true, meta: null, error: null, imageSrc })
    const res = await window.nais.invoke('images:readMetadata', src)
    if ('error' in res) {
      set({ open: false, loading: false })
      toast(res.error, 'error')
    } else set({ loading: false, meta: res.meta })
  },
  close: () => set({ open: false }),

  applyToMain: (sel) => {
    const m = get().meta
    if (!m) return
    const gen = useGenerationStore.getState()
    const patch: Parameters<typeof gen.patchRequest>[0] = {}

    // 퀄리티 태그: 체크 시 원본 프롬프트+토글로(재병합), 미체크 시 병합본 그대로+토글 off
    const q = sel.quality ? !!m.qualityToggle : false
    if (sel.prompt) {
      // 실질 분할일 때만 parts 경로 — 다이얼로그 표시(isSplitMeta)와 동일 판정
      if (m.promptParts && isSplitMeta(m)) {
        const promptParts = {
          base: m.promptParts.base,
          additional: m.promptParts.additional,
          detail: m.promptParts.detail
        }
        patch.prompt = mergePromptParts(promptParts)
        if (gen.promptSplitEnabled) patch.promptParts = promptParts
      } else {
        const prompt = q ? stripQuality(m.prompt) : m.prompt
        if (gen.promptSplitEnabled) {
          patch.promptParts = { base: prompt, additional: '', detail: '' }
          patch.prompt = mergePromptParts(patch.promptParts)
        } else {
          patch.prompt = prompt
        }
      }
      patch.qualityToggle = q
    } else if (sel.quality && m.qualityToggle != null) {
      patch.qualityToggle = q
    }

    // UC 프리셋: 체크 시 원본 네거티브+프리셋으로(재병합), 미체크 시 병합본 그대로+None
    const uc = (sel.ucPreset && m.ucPreset != null ? m.ucPreset : 0) as UcPresetIndex
    if (sel.negativePrompt) {
      const rawNegative = m.promptParts?.negative ?? m.negativePrompt
      patch.negativePrompt =
        m.ucPreset != null ? stripUcPreset(rawNegative, m.ucPreset) : rawNegative
      patch.ucPreset = uc
    } else if (sel.ucPreset && m.ucPreset != null) {
      patch.ucPreset = uc
    }
    if (sel.seed && m.seed != null) patch.seed = m.seed
    if (sel.steps && m.steps != null) patch.steps = m.steps
    if (sel.cfgScale && m.cfgScale != null) patch.cfgScale = m.cfgScale
    if (sel.cfgRescale && m.cfgRescale != null) patch.cfgRescale = m.cfgRescale
    if (sel.sampler && m.sampler) patch.sampler = m.sampler
    if (sel.noiseSchedule && m.noiseSchedule) patch.noiseSchedule = m.noiseSchedule
    if (sel.resolution && m.width && m.height) {
      patch.width = m.width
      patch.height = m.height
    }
    if (sel.variety && m.variety != null) patch.variety = m.variety
    if (sel.characters && m.useCoords != null) patch.useCoords = m.useCoords

    gen.patchRequest(patch)
    // 프롬프트를 적용하면 새 프리셋으로 담는다 — 활성 프리셋을 덮어쓰지 않게 (자동 저장 구조)
    if (patch.prompt !== undefined || patch.negativePrompt !== undefined) {
      const req = useGenerationStore.getState().request
      void usePromptPresetsStore
        .getState()
        .create('가져온 프리셋', req.prompt, req.negativePrompt)
        .then((id) => usePromptPresetsStore.getState().setActive(id))
    }
    if (sel.seed && m.seed != null) gen.setSeedLocked(true)
    if (sel.characters) {
      void useCharactersStore.getState().importFromMetadata(m.characterPrompts ?? [])
    }
    useLayoutStore.getState().setCenterMode('main')
    set({ open: false })
  }
}))

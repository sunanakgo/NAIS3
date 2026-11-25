import { create } from 'zustand'
import type { GenerationRequest, ImageMetadata, UcPresetIndex } from '@shared/types'
import { QUALITY_TAGS_SUFFIX, UC_PRESETS_V45_FULL, UC_PRESETS_V5 } from '@shared/nai-presets'
import { modelCapabilities } from '@shared/nai-models'
import { stripAutoText } from '@shared/nai-auto-text'
import { imageUrl } from '../lib/constants'
import { t } from '../lib/i18n'
import { useCharactersStore } from './characters-store'
import { mergePromptParts, useGenerationStore } from './generation-store'
import { useLayoutStore } from './layout-store'
import { pickPresetParams, usePromptPresetsStore } from './prompt-presets-store'
import { useVibesStore } from './refs-store'
import { toast } from './toast-store'

/** 메타데이터 바이브의 모델을 모를 때 사용자가 고를 수 있는 모델 (바이브를 쓰는 모델만) */
export const METADATA_VIBE_MODEL_CHOICES = [
  { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full' },
  { id: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated' }
] as const

/**
 * 메타데이터 바이브를 어느 모델의 인코딩으로 저장할지와, 현재 모델과 비교한 안내.
 * 모델을 알면 그 모델 그대로, 모르면 사용자가 고른 모델(chosen). 둘 다 없으면 model은
 * undefined — 추측해서 저장하면 다른 모델용 인코딩이 그 모델 것으로 남는다.
 */
export function metadataVibeModel(
  vibeModel: string | undefined,
  currentModel: string,
  chosen?: string
): { model: string | undefined; known: boolean; mismatch: boolean } {
  const current = currentModel.replace(/-inpainting$/, '')
  const model = vibeModel || chosen || undefined
  return { model, known: !!vibeModel, mismatch: !!model && model !== current }
}

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

/**
 * 전송된 프롬프트에서 생성 시 자동으로 붙은 부분을 붙인 역순으로 벗긴다.
 * V5 Auto Text의 `teXt:` 블록은 퀄리티 태그 뒤(첫 구역 끝)에 붙으므로 먼저 떼야 퀄리티 접미사가 보인다.
 */
export function sentPromptWithoutAddons(m: ImageMetadata): string {
  const withoutAutoText = stripAutoText(
    m.prompt,
    (m.characterPrompts ?? []).map((c) => ({ prompt: c.prompt, center: c.center })),
    !!m.useCoords
  )
  return m.qualityToggle ? stripQuality(withoutAutoText) : withoutAutoText
}
function stripUcPreset(uc: string, idx: number): string {
  // V4.5·V5 프리셋 텍스트가 다르고, V5 Full은 앞에 "nsfw, "를 더 붙인다 — 가장 긴 접두부터 벗긴다
  const key = idx as UcPresetIndex
  const v5 = UC_PRESETS_V5[key]
  const candidates = [UC_PRESETS_V45_FULL[key], v5, v5 && `nsfw, ${v5}`]
    .filter((preset): preset is string => !!preset)
    .sort((a, b) => b.length - a.length)
  for (const preset of candidates) {
    if (uc === preset) return ''
    if (uc.startsWith(preset + ', ')) return uc.slice(preset.length + 2)
  }
  return uc
}

/**
 * 메타데이터에서 선택된 요소만 생성 요청 패치로 변환 (부수효과 없음).
 * 메타데이터 다이얼로그의 "메인에 적용"과 히스토리 "재생성"이 같이 쓴다.
 */
export function metadataRequestPatch(
  m: ImageMetadata,
  sel: Record<string, boolean>,
  promptSplitEnabled: boolean
): Partial<GenerationRequest> {
  const patch: Partial<GenerationRequest> = {}

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
      if (promptSplitEnabled) patch.promptParts = promptParts
    } else {
      // NAIS3가 남긴 promptParts.base는 퀄리티·투명 배경·Auto Text 병합 전 원문이다
      const prompt = q ? (m.promptParts?.base ?? sentPromptWithoutAddons(m)) : m.prompt
      if (promptSplitEnabled) {
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
    // NAIS3가 남긴 promptParts.negative는 프리셋 병합 전 원문 — 벗기면 사용자 글까지 잘린다.
    // 프리셋 제거는 PNG의 병합본에만 한다
    const rawNegative = m.promptParts?.negative
    patch.negativePrompt =
      rawNegative != null
        ? rawNegative
        : m.ucPreset != null
          ? stripUcPreset(m.negativePrompt, m.ucPreset)
          : m.negativePrompt
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
  return patch
}

interface MetadataState {
  open: boolean
  loading: boolean
  meta: ImageMetadata | null
  error: string | null
  /** 팝업에 표시할 이미지 src (파일=nais-image, 드롭=data URL) */
  imageSrc: string | null
  /** 메타데이터를 읽은 원본 (바이브 카드 썸네일용) */
  source: { filePath?: string; base64?: string } | null
  /** 파일 경로 또는 base64(외부 드롭)로 메타데이터 팝업 열기 */
  show: (src: { filePath?: string; base64?: string }) => Promise<void>
  close: () => void
  /** 선택된 요소만 메인 생성 설정으로 불러오기 */
  /** vibeModel: 메타데이터에 모델이 없을 때 사용자가 고른 바이브 인코딩 모델 */
  applyToMain: (sel: Record<string, boolean>, options?: { vibeModel?: string }) => void
}

export const useMetadataStore = create<MetadataState>((set, get) => ({
  open: false,
  loading: false,
  meta: null,
  error: null,
  imageSrc: null,
  source: null,

  show: async (src) => {
    const imageSrc = src.base64
      ? src.base64.startsWith('data:')
        ? src.base64
        : `data:image/png;base64,${src.base64}`
      : src.filePath
        ? imageUrl(src.filePath)
        : null
    set({ open: true, loading: true, meta: null, error: null, imageSrc, source: src })
    const res = await window.nais.invoke('images:readMetadata', src)
    if ('error' in res) {
      set({ open: false, loading: false })
      toast(res.error, 'error')
    } else set({ loading: false, meta: res.meta })
  },
  close: () => set({ open: false }),

  applyToMain: (sel, options) => {
    const m = get().meta
    if (!m) return
    const gen = useGenerationStore.getState()
    const patch = metadataRequestPatch(m, sel, gen.promptSplitEnabled)

    // 프롬프트를 적용하면 새 프리셋으로 담는다 — 활성 프리셋을 덮어쓰지 않게 (자동 저장 구조).
    // 새 프리셋이 만들어지기 전에 자동 저장이 돌 수 있으니 활성 프리셋부터 해제한다
    const asNewPreset = patch.prompt !== undefined || patch.negativePrompt !== undefined
    if (asNewPreset) usePromptPresetsStore.getState().setActive(null)
    gen.patchRequest(patch)
    if (asNewPreset) {
      const req = useGenerationStore.getState().request
      void usePromptPresetsStore
        .getState()
        .create(t('ui.importedPreset'), req.prompt, req.negativePrompt, pickPresetParams(req))
        .then((id) => usePromptPresetsStore.getState().setActive(id))
    }
    if (sel.seed && m.seed != null) gen.setSeedLocked(true)
    if (sel.characters) {
      const model = useGenerationStore.getState().request.model
      void useCharactersStore
        .getState()
        .importFromMetadata(m.characterPrompts ?? [], modelCapabilities(model).maxCharacters)
    }
    // 바이브(사용자가 고른 경우만): 인코딩이 있는 것만 라이브러리에 넣고 그것만 켠다
    // (기존 켜진 바이브는 해제 — 메타 재현). 인코딩 모델을 모르고 고르지도 않았으면 넣지 않는다
    const vibes = m.vibes?.filter((v) => v.encoded) ?? []
    if (sel.vibes && vibes.length > 0) {
      const { model } = metadataVibeModel(
        m.vibeModel,
        useGenerationStore.getState().request.model,
        options?.vibeModel
      )
      if (!model) {
        toast(t('ui.metadataVibesSkippedModelUnknown'), 'error')
      } else {
        void window.nais
          .invoke('vibes:importFromMetadata', { vibes, model, source: get().source ?? {} })
          .then(async ({ ids }) => {
            await useVibesStore.getState().load()
            toast(t('ui.metadataVibesAppliedValue', ids.length), 'success')
          })
          .catch((e: unknown) =>
            toast(
              t('ui.metadataVibesApplyFailedValue', e instanceof Error ? e.message : String(e)),
              'error'
            )
          )
      }
    }
    useLayoutStore.getState().setCenterMode('main')
    set({ open: false })
  }
}))

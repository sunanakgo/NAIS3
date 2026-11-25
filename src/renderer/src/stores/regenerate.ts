import type { MessageId } from '@shared/i18n'
import type { GenerationRequest, ImageMetadata, IpcInvokeMap, QueueStatus } from '@shared/types'
import { generationModelFor, isV5Model } from '@shared/nai-models'
import { t } from '../lib/i18n'
import { randomSeed, useGenerationStore } from './generation-store'
import { isSplitMeta, metadataRequestPatch, sentPromptWithoutAddons } from './metadata-store'
import { toast } from './toast-store'

/**
 * 히스토리 이미지 "재생성" — 이미지 메타데이터 그대로 새 랜덤 시드로 한 장 더 뽑는다.
 * 메인 에디터(프롬프트·파라미터·캐릭터·프리셋·i2i 소스)는 건드리지 않는다.
 */

const TRANSPARENT_TAG = 'transparent background'

export type ImageMetadataResult = { meta: ImageMetadata } | { error: string }

/** 메타데이터 다이얼로그의 "전부 적용"과 같은 선택 (시드는 새로 뽑으므로 제외) */
const REGENERATE_SELECTION: Record<string, boolean> = {
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
}

/** 생성 버튼과 같은 판정 — 대기/생성 중인 항목이 있으면 생성 중 */
export function isGenerationActive(queue: QueueStatus | null): boolean {
  return queue?.items.some((i) => i.state === 'pending' || i.state === 'generating') ?? false
}

function storedModelId(meta: ImageMetadata): string | undefined {
  return meta.modelId ?? (meta.model?.startsWith('nai-diffusion-') ? meta.model : undefined)
}

/**
 * 재생성할 수 없는 이미지면 그 이유(메시지 id). 재생성은 txt2img로만 보내므로
 * i2i·인페인트 결과를 원본 이미지 없이 다시 뽑으면 전혀 다른 그림이 된다.
 */
export function regenerateBlockReason(meta: ImageMetadata): MessageId | null {
  if (meta.generationAction === 'img2img') return 'ui.regenerateUnavailableForI2i'
  if (meta.generationAction === 'infill') return 'ui.regenerateUnavailableForInpaint'
  // action이 없는 PNG 메타데이터라도 인페인트 모델이면 인페인트 결과다
  if (storedModelId(meta)?.endsWith('-inpainting')) return 'ui.regenerateUnavailableForInpaint'
  return null
}

/**
 * 메타데이터의 모델 → API 모델 id. DB 요청의 id가 우선이고, PNG Source 같은 표시용 이름이면
 * 모델을 알 수 없으니 현재 선택된 모델을 쓴다. 인페인트 모델은 그 인페인트를 요청한 생성 모델로 되돌린다.
 */
export function regenerateModel(meta: ImageMetadata, fallback: string): string {
  const id = storedModelId(meta)
  return id ? generationModelFor(id, fallback) : fallback
}

/** 메타데이터 + 현재 요청(메타데이터에 없는 값의 기본) → 새 시드의 생성 요청 */
export function regenerateRequestFromMetadata(
  meta: ImageMetadata,
  base: GenerationRequest,
  seed: number
): GenerationRequest {
  const request: GenerationRequest = {
    ...base,
    ...metadataRequestPatch(meta, REGENERATE_SELECTION, isSplitMeta(meta)),
    model: regenerateModel(meta, base.model),
    seed,
    characterPrompts: (meta.characterPrompts ?? []).map((c) => ({
      prompt: c.prompt,
      negativePrompt: c.negativePrompt,
      center: c.center,
      enabled: true
    }))
  }
  // 에디터 쪽 일시 상태(i2i 소스·3분할·씬)는 원본 이미지와 무관하다
  delete request.source
  delete request.sceneId
  // 레퍼런스는 빈 목록으로 고정 — id가 없으면 메인이 지금 켜 둔 바이브·캐릭레퍼를 붙인다.
  // 원본에 쓰인 레퍼런스는 메타데이터로 복원할 수 없으니 레퍼런스 없이 재생성한다
  request.vibeIds = []
  request.charRefIds = []
  if (!isSplitMeta(meta)) delete request.promptParts
  // V5 투명 배경: 요청의 straight_alpha가 있으면 그것, 없으면 전송 프롬프트 끝(퀄리티 태그 앞)의 태그로 판정.
  // Auto Text 블록은 퀄리티 태그 뒤에 붙으므로 sentPromptWithoutAddons로 둘 다 벗긴 뒤 본다
  const sent = sentPromptWithoutAddons(meta)
  request.transparentBackground =
    isV5Model(request.model) &&
    (meta.transparentBackground ??
      (sent === TRANSPARENT_TAG || sent.endsWith(`, ${TRANSPARENT_TAG}`)))
  // 프롬프트를 전송본에서 되살렸을 때만 태그가 들어 있다 (promptParts 원문에는 없다)
  if (request.transparentBackground && !meta.promptParts) {
    request.prompt =
      request.prompt === TRANSPARENT_TAG
        ? ''
        : request.prompt.replace(new RegExp(`, ${TRANSPARENT_TAG}$`), '')
  }
  return request
}

export function readImageMetadata(filePath: string): Promise<ImageMetadataResult> {
  return window.nais.invoke('images:readMetadata', { filePath })
}

/** 이미지 메타데이터로 바로 재생성. metadata는 메뉴가 열릴 때 미리 읽어둔 결과 */
export async function regenerateFromImage(
  filePath: string,
  metadata: Promise<ImageMetadataResult> = readImageMetadata(filePath)
): Promise<void> {
  if (isGenerationActive(useGenerationStore.getState().queue)) {
    toast(t('ui.cannotRegenerateWhileGenerating'), 'error')
    return
  }
  const res = await metadata
  if ('error' in res) {
    toast(res.error, 'error')
    return
  }
  const blocked = regenerateBlockReason(res.meta)
  if (blocked) {
    toast(t(blocked), 'error')
    return
  }
  const gen = useGenerationStore.getState()
  // 메타데이터를 읽는 사이 다른 생성이 시작됐을 수 있다
  if (isGenerationActive(gen.queue)) {
    toast(t('ui.cannotRegenerateWhileGenerating'), 'error')
    return
  }
  const request = regenerateRequestFromMetadata(res.meta, gen.request, randomSeed())
  // 생성 버튼과 같이 스트리밍 미리보기를 보이게 하고, 막히거나 실패하면 보던 이미지를 되돌린다
  const viewing = gen.viewingFilePath
  const restoreViewing = (): void => {
    if (useGenerationStore.getState().viewingFilePath === null) {
      useGenerationStore.setState({ viewingFilePath: viewing })
    }
  }
  useGenerationStore.setState({ previewPng: null, progress: null, viewingFilePath: null })
  let enqueued: IpcInvokeMap['queue:enqueue']['res']
  try {
    enqueued = await window.nais.invoke('queue:enqueue', { request, count: 1 })
  } catch (e) {
    restoreViewing()
    toast(t('ui.regenerateFailed', e instanceof Error ? e.message : String(e)), 'error')
    return
  }
  if (enqueued?.blocked) {
    toast(enqueued.blocked, 'error')
    restoreViewing()
  }
}

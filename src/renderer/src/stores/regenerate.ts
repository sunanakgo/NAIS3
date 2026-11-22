import type { GenerationRequest, ImageMetadata, QueueStatus } from '@shared/types'
import { isV5Model } from '@shared/nai-models'
import { QUALITY_TAGS_SUFFIX } from '@shared/nai-presets'
import { t } from '../lib/i18n'
import { randomSeed, useGenerationStore } from './generation-store'
import { isSplitMeta, metadataRequestPatch } from './metadata-store'
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

/**
 * 메타데이터의 모델 → API 모델 id. DB 요청의 id가 우선이고, PNG Source 같은 표시용 이름이면
 * 모델을 알 수 없으니 현재 선택된 모델을 쓴다. 인페인트 모델은 일반 생성 모델로 되돌린다.
 */
export function regenerateModel(meta: ImageMetadata, fallback: string): string {
  const id = meta.modelId ?? (meta.model?.startsWith('nai-diffusion-') ? meta.model : undefined)
  return id ? id.replace(/-inpainting$/, '') : fallback
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
  // V5 투명 배경은 전송 프롬프트 끝(퀄리티 태그 앞)의 태그로만 남는다 — 토글로 되돌린다
  const sent = meta.prompt.endsWith(QUALITY_TAGS_SUFFIX)
    ? meta.prompt.slice(0, -QUALITY_TAGS_SUFFIX.length)
    : meta.prompt
  request.transparentBackground =
    isV5Model(request.model) && (sent === TRANSPARENT_TAG || sent.endsWith(`, ${TRANSPARENT_TAG}`))
  if (request.transparentBackground && !request.promptParts) {
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
  const gen = useGenerationStore.getState()
  // 메타데이터를 읽는 사이 다른 생성이 시작됐을 수 있다
  if (isGenerationActive(gen.queue)) {
    toast(t('ui.cannotRegenerateWhileGenerating'), 'error')
    return
  }
  const request = regenerateRequestFromMetadata(res.meta, gen.request, randomSeed())
  // 생성 버튼과 같이 스트리밍 미리보기를 보이게 하고, 막히면 보던 이미지를 되돌린다
  const viewing = gen.viewingFilePath
  useGenerationStore.setState({ previewPng: null, progress: null, viewingFilePath: null })
  const enqueued = await window.nais.invoke('queue:enqueue', { request, count: 1 })
  if (enqueued?.blocked) {
    toast(enqueued.blocked, 'error')
    if (useGenerationStore.getState().viewingFilePath === null) {
      useGenerationStore.setState({ viewingFilePath: viewing })
    }
  }
}

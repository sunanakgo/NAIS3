// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationRequest, ImageMetadata, QueueStatus } from '../src/shared/types'
import { QUALITY_TAGS_SUFFIX, UC_PRESETS_V45_FULL, UC_PRESETS_V5 } from '../src/shared/nai-presets'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import { DEFAULT_REQUEST, useGenerationStore } from '../src/renderer/src/stores/generation-store'
import { metadataRequestPatch } from '../src/renderer/src/stores/metadata-store'
import {
  regenerateBlockReason,
  regenerateFromImage,
  regenerateModel,
  regenerateRequestFromMetadata
} from '../src/renderer/src/stores/regenerate'
import { buildGenerateImagePayload, localPromptMetadata } from '../src/main/nai/payload'
import { metadataFromPayloadJson } from '../src/shared/image-metadata'
import { generationModelFor } from '../src/shared/nai-models'
import { stripAutoText } from '../src/shared/nai-auto-text'
import { useToastStore } from '../src/renderer/src/stores/toast-store'

const EDITOR: GenerationRequest = {
  ...DEFAULT_REQUEST,
  prompt: 'unsaved editor prompt',
  negativePrompt: 'editor negative',
  model: 'nai-diffusion-5-curated',
  seed: 123,
  promptParts: { base: 'unsaved editor prompt', additional: '', detail: '' },
  sceneId: 9,
  vibeIds: [1],
  transparentBackground: true,
  source: { imageBase64: 'abc', strength: 0.7, noise: 0 }
}

const META: ImageMetadata = {
  prompt: `1girl, solo${QUALITY_TAGS_SUFFIX}`,
  negativePrompt: `${UC_PRESETS_V45_FULL[0]}, blurry`,
  seed: 42,
  steps: 28,
  cfgScale: 5,
  cfgRescale: 0.2,
  sampler: 'k_dpmpp_2m',
  noiseSchedule: 'exponential',
  width: 1024,
  height: 1024,
  model: 'NovelAI Diffusion V4.5 4BDE2A90',
  modelId: 'nai-diffusion-4-5-full',
  variety: true,
  useCoords: true,
  qualityToggle: true,
  ucPreset: 0,
  characterPrompts: [{ prompt: 'girl', negativePrompt: 'bad', center: { x: 0.3, y: 0.5 } }]
}

describe('regenerate request from image metadata', () => {
  it('uses every stored parameter with a new seed and drops editor-only state', () => {
    const request = regenerateRequestFromMetadata(META, EDITOR, 777)

    expect(request).toMatchObject({
      prompt: '1girl, solo',
      negativePrompt: 'blurry',
      qualityToggle: true,
      ucPreset: 0,
      model: 'nai-diffusion-4-5-full',
      seed: 777,
      steps: 28,
      cfgScale: 5,
      cfgRescale: 0.2,
      sampler: 'k_dpmpp_2m',
      noiseSchedule: 'exponential',
      width: 1024,
      height: 1024,
      variety: true,
      useCoords: true,
      transparentBackground: false,
      characterPrompts: [
        { prompt: 'girl', negativePrompt: 'bad', center: { x: 0.3, y: 0.5 }, enabled: true }
      ]
    })
    for (const key of ['source', 'sceneId', 'promptParts'] as const) {
      expect(request).not.toHaveProperty(key)
    }
    // 빈 목록이어야 메인이 지금 켜 둔 레퍼런스로 대신 채우지 않는다
    expect(request.vibeIds).toEqual([])
    expect(request.charRefIds).toEqual([])
  })

  it('keeps a real three-part prompt split', () => {
    const request = regenerateRequestFromMetadata(
      {
        ...META,
        prompt: `a, b, c${QUALITY_TAGS_SUFFIX}`,
        promptParts: { base: 'a', additional: 'b', detail: 'c' }
      },
      EDITOR,
      1
    )

    expect(request.prompt).toBe('a, b, c')
    expect(request.promptParts).toEqual({ base: 'a', additional: 'b', detail: 'c' })
  })

  it('restores V5 transparent background from the sent prompt', () => {
    const request = regenerateRequestFromMetadata(
      {
        ...META,
        modelId: 'nai-diffusion-5-curated',
        prompt: `1girl, transparent background${QUALITY_TAGS_SUFFIX}`
      },
      { ...EDITOR, transparentBackground: false },
      1
    )

    expect(request.prompt).toBe('1girl')
    expect(request.transparentBackground).toBe(true)
  })

  it('does not reuse editor characters when the image has none', () => {
    const request = regenerateRequestFromMetadata(
      { ...META, characterPrompts: undefined },
      {
        ...EDITOR,
        characterPrompts: [{ prompt: 'editor', negativePrompt: '', enabled: true }]
      },
      1
    )

    expect(request.characterPrompts).toEqual([])
  })

  it('resolves an API model id or falls back to the current model', () => {
    expect(regenerateModel({ ...META, modelId: undefined }, 'current')).toBe('current')
    expect(
      regenerateModel({ ...META, modelId: undefined, model: 'nai-diffusion-4-5-curated' }, 'x')
    ).toBe('nai-diffusion-4-5-curated')
    expect(
      regenerateModel({ ...META, modelId: 'nai-diffusion-5-full-inpainting' }, 'current')
    ).toBe('nai-diffusion-5-full')
  })

  it('maps inpainting models back to the model that requested them', () => {
    const curatedInpaint = 'nai-diffusion-4-5-curated-inpainting'
    // V4.5 Curated와 V5 Curated가 같은 인페인트 모델을 쓴다 — 원래 요청 모델이 있으면 그것
    expect(generationModelFor(curatedInpaint, 'nai-diffusion-5-curated')).toBe(
      'nai-diffusion-5-curated'
    )
    expect(generationModelFor(curatedInpaint, 'nai-diffusion-4-5-full')).toBe(
      'nai-diffusion-4-5-curated'
    )
    expect(generationModelFor('nai-diffusion-5-full-medium-inpainting')).toBe(
      'nai-diffusion-5-full-medium'
    )
    expect(generationModelFor('nai-diffusion-5-full')).toBe('nai-diffusion-5-full')
  })

  it('blocks i2i and inpainting results, which txt2img cannot reproduce', () => {
    expect(regenerateBlockReason(META)).toBeNull()
    expect(regenerateBlockReason({ ...META, generationAction: 'generate' })).toBeNull()
    expect(regenerateBlockReason({ ...META, generationAction: 'img2img' })).toBe(
      'ui.regenerateUnavailableForI2i'
    )
    expect(regenerateBlockReason({ ...META, generationAction: 'infill' })).toBe(
      'ui.regenerateUnavailableForInpaint'
    )
    // action이 없는 PNG 메타데이터도 인페인트 모델이면 막는다
    expect(
      regenerateBlockReason({ ...META, modelId: 'nai-diffusion-4-5-curated-inpainting' })
    ).toBe('ui.regenerateUnavailableForInpaint')
  })

  it('strips V5 UC presets, including the V5 Full nsfw prefix', () => {
    const sel = { negativePrompt: true, ucPreset: true }
    const v5 = UC_PRESETS_V5[1]
    expect(
      metadataRequestPatch({ ...META, negativePrompt: `${v5}, blurry`, ucPreset: 1 }, sel, false)
        .negativePrompt
    ).toBe('blurry')
    expect(
      metadataRequestPatch(
        { ...META, negativePrompt: `nsfw, ${v5}, blurry`, ucPreset: 1 },
        sel,
        false
      ).negativePrompt
    ).toBe('blurry')
  })

  it('keeps the raw NAIS3 negative as written, even if it starts like a preset', () => {
    const sel = { negativePrompt: true, ucPreset: true }
    const raw = `${UC_PRESETS_V5[1]}, blurry`
    expect(
      metadataRequestPatch(
        {
          ...META,
          negativePrompt: `${UC_PRESETS_V45_FULL[1]}, ${raw}`,
          ucPreset: 1,
          promptParts: { base: '1girl', additional: '', detail: '', negative: raw }
        },
        sel,
        false
      ).negativePrompt
    ).toBe(raw)
  })
})

describe('V5 Auto Text round trip', () => {
  const V5_REQUEST: GenerationRequest = {
    ...DEFAULT_REQUEST,
    model: 'nai-diffusion-5-curated',
    prompt: '1girl, holding a sign, "hello"',
    negativePrompt: 'blurry',
    qualityToggle: true,
    ucPreset: 0,
    transparentBackground: true,
    characterPrompts: [],
    promptParts: undefined,
    vibeIds: [],
    charRefIds: []
  }

  function storedMetadata(request: GenerationRequest): ImageMetadata {
    const payload = buildGenerateImagePayload(request)
    const local = localPromptMetadata(request)
    const meta = metadataFromPayloadJson(
      JSON.stringify(local ? { ...payload, nais3: local } : payload)
    )
    if (!meta) throw new Error('no metadata')
    return meta
  }

  it('the sent prompt ends with the teXt block, after the quality tags', () => {
    const meta = storedMetadata(V5_REQUEST)
    expect(meta.prompt.endsWith(QUALITY_TAGS_SUFFIX)).toBe(false)
    expect(stripAutoText(meta.prompt)).toBe(
      `1girl, holding a sign, "hello", transparent background${QUALITY_TAGS_SUFFIX}`
    )
  })

  it.each([
    ['straight_alpha', (m: ImageMetadata) => m],
    ['the prompt tag', (m: ImageMetadata) => ({ ...m, transparentBackground: undefined })]
  ])('regenerates without duplicating tags (transparency from %s)', (_, adjust) => {
    const meta = adjust(storedMetadata(V5_REQUEST))
    const request = regenerateRequestFromMetadata(meta, EDITOR, V5_REQUEST.seed)

    expect(request.prompt).toBe(V5_REQUEST.prompt)
    expect(request.transparentBackground).toBe(true)
    expect(buildGenerateImagePayload(request).input).toBe(
      buildGenerateImagePayload(V5_REQUEST).input
    )
  })

  it('uses the stored base prompt when NAIS3 kept prompt parts', () => {
    const original: GenerationRequest = {
      ...V5_REQUEST,
      promptParts: { base: V5_REQUEST.prompt, additional: '', detail: '' }
    }
    const request = regenerateRequestFromMetadata(storedMetadata(original), EDITOR, 1)

    expect(request.prompt).toBe(V5_REQUEST.prompt)
    expect(request.transparentBackground).toBe(true)
    expect(buildGenerateImagePayload(request).input).toBe(buildGenerateImagePayload(original).input)
  })

  it('keeps a teXt: block the user wrote by hand', () => {
    const prompt = '1girl, teXt: hello'
    expect(stripAutoText(prompt)).toBe(prompt)
  })

  it('restores every stored parameter from the payload (desktop and browser share it)', () => {
    const meta = storedMetadata({ ...V5_REQUEST, steps: 23, cfgScale: 4.5 })
    expect(meta).toMatchObject({
      negativePrompt: expect.stringContaining('blurry'),
      ucPreset: 0,
      steps: 23,
      cfgScale: 4.5,
      modelId: 'nai-diffusion-5-curated',
      generationAction: 'generate',
      transparentBackground: true
    })
  })
})

describe('regenerate from image', () => {
  const invoke = vi.fn()
  const generating: QueueStatus = {
    items: [{ id: 'a', state: 'generating', request: DEFAULT_REQUEST }]
  } as QueueStatus

  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'images:readMetadata') return { meta: META }
      if (channel === 'queue:enqueue') return { ids: ['new'] }
      return undefined
    })
    Object.defineProperty(window, 'nais', { configurable: true, value: { invoke } })
    useLanguageStore.setState({ lang: 'en' })
    useToastStore.setState({ toasts: [] })
    useGenerationStore.setState({
      request: EDITOR,
      seedLocked: true,
      batchCount: 5,
      queue: null,
      viewingFilePath: '/images/a.png'
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enqueues one image with a random seed without touching the editor', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    await regenerateFromImage('/images/a.png')

    const enqueue = invoke.mock.calls.find(([channel]) => channel === 'queue:enqueue')
    expect(enqueue?.[1]).toMatchObject({
      count: 1,
      request: { prompt: '1girl, solo', seed: Math.floor(0.5 * 4294967295) }
    })
    expect(invoke).not.toHaveBeenCalledWith('settings:set', expect.anything())
    expect(useGenerationStore.getState().request).toBe(EDITOR)
    expect(useGenerationStore.getState().seedLocked).toBe(true)
    expect(useGenerationStore.getState().viewingFilePath).toBeNull()
  })

  it('does not enqueue while a generation is in progress', async () => {
    useGenerationStore.setState({ queue: generating })

    await regenerateFromImage('/images/a.png')

    expect(invoke).not.toHaveBeenCalledWith('queue:enqueue', expect.anything())
    expect(useToastStore.getState().toasts).toMatchObject([
      { message: 'Cannot regenerate while images are generating', type: 'error' }
    ])
  })

  it('reports unreadable metadata', async () => {
    await regenerateFromImage('/images/a.png', Promise.resolve({ error: 'Metadata not found' }))

    expect(invoke).not.toHaveBeenCalledWith('queue:enqueue', expect.anything())
    expect(useToastStore.getState().toasts).toMatchObject([
      { message: 'Metadata not found', type: 'error' }
    ])
  })

  it('restores the viewed image when the Anlas guard blocks the request', async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === 'queue:enqueue' ? { ids: [], blocked: 'blocked' } : undefined
    )

    await regenerateFromImage('/images/a.png', Promise.resolve({ meta: META }))

    expect(useGenerationStore.getState().viewingFilePath).toBe('/images/a.png')
    expect(useToastStore.getState().toasts).toMatchObject([{ message: 'blocked', type: 'error' }])
  })

  it('restores the viewed image and reports a failed enqueue', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'queue:enqueue') throw new Error('IPC down')
      return undefined
    })

    await regenerateFromImage('/images/a.png', Promise.resolve({ meta: META }))

    expect(useGenerationStore.getState().viewingFilePath).toBe('/images/a.png')
    expect(useToastStore.getState().toasts).toMatchObject([
      { message: 'Could not start regenerating (IPC down)', type: 'error' }
    ])
  })

  it('refuses to regenerate an i2i result as txt2img', async () => {
    await regenerateFromImage(
      '/images/a.png',
      Promise.resolve({ meta: { ...META, generationAction: 'img2img' } })
    )

    expect(invoke).not.toHaveBeenCalledWith('queue:enqueue', expect.anything())
    expect(useToastStore.getState().toasts).toMatchObject([
      { message: 'I2I results cannot be regenerated without the source image', type: 'error' }
    ])
  })
})

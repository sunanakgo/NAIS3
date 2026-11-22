// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationRequest, ImageMetadata, QueueStatus } from '../src/shared/types'
import { QUALITY_TAGS_SUFFIX, UC_PRESETS_V45_FULL, UC_PRESETS_V5 } from '../src/shared/nai-presets'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import { DEFAULT_REQUEST, useGenerationStore } from '../src/renderer/src/stores/generation-store'
import { metadataRequestPatch } from '../src/renderer/src/stores/metadata-store'
import {
  regenerateFromImage,
  regenerateModel,
  regenerateRequestFromMetadata
} from '../src/renderer/src/stores/regenerate'
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
    for (const key of ['source', 'sceneId', 'vibeIds', 'promptParts'] as const) {
      expect(request).not.toHaveProperty(key)
    }
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
})

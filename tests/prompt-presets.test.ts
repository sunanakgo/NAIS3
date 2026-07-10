import { describe, expect, it, beforeAll } from 'vitest'
import type { PresetParams, PromptPreset } from '../src/shared/types'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key)
    },
    configurable: true
  })
})

type Helpers = typeof import('../src/renderer/src/stores/prompt-presets-store')
async function helpers(): Promise<Helpers> {
  return await import('../src/renderer/src/stores/prompt-presets-store')
}

describe('prompt preset sync guards', () => {
  const base: Pick<PromptPreset, 'prompt' | 'negativePrompt' | 'params'> = {
    prompt: 'old prompt',
    negativePrompt: 'old neg',
    params: null
  }

  it('does not backfill legacy null params during preset apply/no-op sync', async () => {
    const { shouldSyncPromptPreset } = await helpers()
    expect(
      shouldSyncPromptPreset(base, {
        prompt: 'old prompt',
        negativePrompt: 'old neg',
        params: { steps: 28, cfgScale: 6, cfgRescale: 0.56, sampler: 'k_euler', ucPreset: 0 }
      })
    ).toBe(false)
  })

  it('still syncs explicit prompt edits for legacy presets', async () => {
    const { shouldSyncPromptPreset } = await helpers()
    expect(
      shouldSyncPromptPreset(base, {
        prompt: 'new prompt',
        negativePrompt: 'old neg',
        params: { steps: 28 }
      })
    ).toBe(true)
  })

  it('syncs params for presets that already own params', async () => {
    const { shouldSyncPromptPreset } = await helpers()
    expect(
      shouldSyncPromptPreset(
        { ...base, params: { steps: 20, cfgScale: 5 } satisfies PresetParams },
        { prompt: 'old prompt', negativePrompt: 'old neg', params: { steps: 30, cfgScale: 7 } }
      )
    ).toBe(true)
  })

  it('resets split prompt parts when applying another preset', async () => {
    const { splitPromptForPreset } = await helpers()
    expect(splitPromptForPreset('1girl, blue hair')).toEqual({
      base: '1girl, blue hair',
      additional: '',
      detail: ''
    })
  })
})

describe('prompt preset split parts (3분할 보존)', () => {
  const parts = { base: '1girl', additional: 'smile', detail: 'cafe' }
  const merged = '1girl, smile, cafe'

  it('restores stored parts when they match the preset prompt', async () => {
    const { partsForApply } = await helpers()
    expect(partsForApply({ prompt: merged, promptParts: parts })).toEqual(parts)
  })

  it('reseeds when stored parts are stale (prompt edited while split off)', async () => {
    const { partsForApply } = await helpers()
    expect(partsForApply({ prompt: '1girl, edited', promptParts: parts })).toEqual({
      base: '1girl, edited',
      additional: '',
      detail: ''
    })
  })

  it('reseeds when no parts are stored', async () => {
    const { partsForApply } = await helpers()
    expect(partsForApply({ prompt: 'solo', promptParts: null })).toEqual({
      base: 'solo',
      additional: '',
      detail: ''
    })
  })

  it('normalizes trivial parts (base only) to null', async () => {
    const { normalizePresetParts } = await helpers()
    expect(normalizePresetParts({ base: '1girl', additional: '', detail: ' ' })).toBeNull()
    expect(normalizePresetParts({ base: '1girl', additional: 'smile', detail: '' })).toEqual({
      base: '1girl',
      additional: 'smile',
      detail: ''
    })
  })

  it('syncs when split parts change but merged prompt stays the same', async () => {
    const { shouldSyncPromptPreset } = await helpers()
    expect(
      shouldSyncPromptPreset(
        { prompt: merged, negativePrompt: '', params: { steps: 28 }, promptParts: parts },
        {
          prompt: merged,
          negativePrompt: '',
          params: { steps: 28 },
          promptParts: { base: '1girl, smile', additional: 'cafe', detail: '' }
        }
      )
    ).toBe(true)
  })

  it('does not touch stored parts when split is off (promptParts undefined)', async () => {
    const { shouldSyncPromptPreset } = await helpers()
    expect(
      shouldSyncPromptPreset(
        { prompt: merged, negativePrompt: '', params: { steps: 28 }, promptParts: parts },
        { prompt: merged, negativePrompt: '', params: { steps: 28 } }
      )
    ).toBe(false)
  })

  it('legacy preset guard still holds with trivial parts', async () => {
    const { shouldSyncPromptPreset } = await helpers()
    expect(
      shouldSyncPromptPreset(
        { prompt: 'old', negativePrompt: '', params: null, promptParts: null },
        {
          prompt: 'old',
          negativePrompt: '',
          params: { steps: 28 },
          promptParts: { base: 'old', additional: '', detail: '' }
        }
      )
    ).toBe(false)
  })
})

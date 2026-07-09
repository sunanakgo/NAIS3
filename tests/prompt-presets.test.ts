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

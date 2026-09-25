// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterCard } from '../src/shared/types'
import { useCharactersStore } from '../src/renderer/src/stores/characters-store'
import { DEFAULT_REQUEST, useGenerationStore } from '../src/renderer/src/stores/generation-store'

function character(id: number, prompt: string): CharacterCard {
  return {
    id,
    name: `Character ${id}`,
    prompt,
    negativePrompt: '',
    thumbnail: '',
    enabled: false,
    center: { x: 0.5, y: 0.5 },
    folderId: null
  }
}

describe('random character generation handoff', () => {
  const invoke = vi.fn(async (channel: string) =>
    channel === 'queue:enqueue' ? { ids: [] } : undefined
  )

  beforeEach(() => {
    invoke.mockClear()
    Object.defineProperty(window, 'nais', {
      configurable: true,
      value: { invoke }
    })
    useCharactersStore.setState({
      folders: [],
      items: [character(1, 'alpha'), character(2, 'beta')],
      loaded: true,
      randomCandidateIds: []
    })
    useGenerationStore.setState({
      request: { ...DEFAULT_REQUEST, seed: 42 },
      seedLocked: true,
      batchCount: 3,
      source: null
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hands the selected random candidate range to one consecutive generation queue', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0)
    useCharactersStore.getState().activateRandom(new Set([1, 2]))

    await useGenerationStore.getState().generate()

    const enqueue = invoke.mock.calls.find(([channel]) => channel === 'queue:enqueue')
    expect(enqueue?.[1]).toMatchObject({
      count: 3,
      randomCharacterPrompts: [
        { prompt: 'alpha', enabled: true },
        { prompt: 'beta', enabled: true }
      ]
    })
  })

  it('stops randomizing after the user manually changes character activation', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0)
    useCharactersStore.getState().activateRandom(new Set([1, 2]))
    useCharactersStore.getState().updateCard(1, { enabled: false })

    await useGenerationStore.getState().generate()

    const enqueue = invoke.mock.calls.find(([channel]) => channel === 'queue:enqueue')
    expect(enqueue?.[1]).not.toHaveProperty('randomCharacterPrompts')
  })

  it('stops randomizing after all active characters are disabled', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0)
    useCharactersStore.getState().activateRandom(new Set([1, 2]))
    useCharactersStore.getState().disableAll()

    await useGenerationStore.getState().generate()

    const enqueue = invoke.mock.calls.find(([channel]) => channel === 'queue:enqueue')
    expect(enqueue?.[1]).not.toHaveProperty('randomCharacterPrompts')
  })
})

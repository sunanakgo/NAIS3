import { describe, expect, it } from 'vitest'
import type { CharacterCard } from '../src/shared/types'
import { planRandomCharacterActivation } from '../src/shared/random-character'

function character(id: number, prompt: string, enabled = false): CharacterCard {
  return {
    id,
    name: `Character ${id}`,
    prompt,
    negativePrompt: '',
    thumbnail: '',
    enabled,
    center: { x: 0.5, y: 0.5 },
    folderId: null
  }
}

describe('planRandomCharacterActivation', () => {
  it('picks uniformly by candidate order and makes the result exclusively active', () => {
    const items = [character(1, 'one', true), character(2, 'two'), character(3, 'three', true)]
    const plan = planRandomCharacterActivation(items, new Set([1, 2, 3]), () => 0.5)

    expect(plan.picked?.id).toBe(2)
    expect(plan.items.map(({ id, enabled }) => ({ id, enabled }))).toEqual([
      { id: 1, enabled: false },
      { id: 2, enabled: true },
      { id: 3, enabled: false }
    ])
    expect(plan.changed).toEqual([
      { id: 1, enabled: false },
      { id: 2, enabled: true },
      { id: 3, enabled: false }
    ])
  })

  it('ignores empty prompts and clamps a random source at its boundaries', () => {
    const items = [character(1, '  '), character(2, 'two'), character(3, 'three')]

    expect(planRandomCharacterActivation(items, new Set([1, 2, 3]), () => -1).picked?.id).toBe(2)
    expect(planRandomCharacterActivation(items, new Set([1, 2, 3]), () => 1).picked?.id).toBe(3)
  })

  it('does nothing when the selected range has no usable character', () => {
    const items = [character(1, '', true), character(2, 'two')]
    const plan = planRandomCharacterActivation(items, new Set([1]))

    expect(plan).toEqual({ picked: null, items, changed: [] })
    expect(plan.items).toBe(items)
  })
})

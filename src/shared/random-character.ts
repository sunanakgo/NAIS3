import type { CharacterCard, CharacterPromptInput, GenerationRequest } from './types'

export interface RandomCharacterActivation {
  picked: CharacterCard | null
  items: CharacterCard[]
  changed: { id: number; enabled: boolean }[]
}

function randomIndex(length: number, random: () => number): number {
  const sample = random()
  return Math.min(length - 1, Math.max(0, Math.floor(sample * length)))
}

/**
 * Select one usable character from the user-selected candidate range and make it
 * the only active character. Keeping this pure makes the random boundary and
 * persistence patch set independently testable.
 */
export function planRandomCharacterActivation(
  items: CharacterCard[],
  candidateIds: ReadonlySet<number>,
  random: () => number = Math.random
): RandomCharacterActivation {
  const candidates = items.filter((item) => candidateIds.has(item.id) && item.prompt.trim())
  if (candidates.length === 0) return { picked: null, items, changed: [] }

  const picked = candidates[randomIndex(candidates.length, random)]
  const changed: RandomCharacterActivation['changed'] = []
  const nextItems = items.map((item) => {
    const enabled = item.id === picked.id
    if (item.enabled === enabled) return item
    changed.push({ id: item.id, enabled })
    return { ...item, enabled }
  })

  return { picked, items: nextItems, changed }
}

/** Resolve a queue item to one random character while keeping the base request immutable. */
export function applyRandomCharacterPrompt(
  request: GenerationRequest,
  candidates: readonly CharacterPromptInput[],
  random: () => number = Math.random
): GenerationRequest {
  if (candidates.length === 0) return request
  const picked = candidates[randomIndex(candidates.length, random)]
  return {
    ...request,
    characterPrompts: [
      {
        ...picked,
        center: picked.center ? { ...picked.center } : undefined
      }
    ]
  }
}

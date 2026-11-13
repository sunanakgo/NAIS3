import type { GenerationRequest, Scene, SceneReservation } from './types'

export function appendPrompt(base: string, add: string): string {
  const b = base.trim().replace(/,\s*$/, '')
  const a = add.trim().replace(/^,\s*/, '')
  if (!b) return a
  if (!a) return b
  return `${b}, ${a}`
}

export function applySceneRequest(
  base: GenerationRequest,
  scene: Pick<Scene, 'id' | 'prompt' | 'negativePrompt' | 'width' | 'height'>
): GenerationRequest {
  return {
    ...base,
    prompt: appendPrompt(base.prompt, scene.prompt),
    negativePrompt: appendPrompt(base.negativePrompt, scene.negativePrompt),
    promptParts: base.promptParts
      ? { ...base.promptParts, detail: appendPrompt(base.promptParts.detail, scene.prompt) }
      : undefined,
    width: base.source ? base.width : scene.width,
    height: base.source ? base.height : scene.height,
    sceneId: scene.id
  }
}

/** Preserve cast-major ordering and reset the locked seed offset for each scene. */
export function planSceneReservations(
  scenes: Scene[],
  casts: { castId: string; request: GenerationRequest }[],
  seedLocked: boolean,
  randomSeed: () => number
): {
  requests: GenerationRequest[]
  reservations: SceneReservation[]
  remaining: Map<number, Record<string, number>>
} {
  const requests: GenerationRequest[] = []
  const reservations: SceneReservation[] = []
  const remaining = new Map(scenes.map((scene) => [scene.id, { ...scene.reserves }]))
  const seen = new Set<string>()
  for (const { castId, request } of casts) {
    if (seen.has(castId)) throw new Error('Duplicate reservation cast')
    seen.add(castId)
    for (const scene of scenes) {
      const count = scene.reserves[castId] ?? 0
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid reservation count')
      const base = applySceneRequest(request, scene)
      for (let i = 0; i < count; i++) {
        requests.push({
          ...base,
          seed: seedLocked && request.seed >= 0 ? (request.seed + i) % 4294967296 : randomSeed()
        })
        reservations.push({ sceneId: scene.id, castId })
      }
      delete remaining.get(scene.id)![castId]
    }
  }
  return { requests, reservations, remaining }
}

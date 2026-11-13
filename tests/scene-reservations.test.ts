import { describe, expect, it, vi } from 'vitest'
import { applySceneRequest, planSceneReservations } from '../src/shared/scene-request'
import { GenerationQueue } from '../src/main/queue/generation-queue'
import type { GenerationRequest, Scene } from '../src/shared/types'

const request = {
  prompt: 'base, ',
  negativePrompt: 'bad',
  width: 832,
  height: 1216,
  seed: 4294967295,
  promptParts: { detail: 'detail' }
} as GenerationRequest
const scene = (id: number, reserves: Record<string, number>): Scene =>
  ({
    id,
    prompt: ', scene',
    negativePrompt: 'worse',
    width: 1024,
    height: 1024,
    reserves
  }) as Scene

describe('scene reservation handoff', () => {
  it('keeps cast and scene order, locked seed wrapping, and unmatched reservations', () => {
    const scenes = [scene(2, { '': 2, cast: 1, deleted: 3 }), scene(1, { '': 1 })]
    const plan = planSceneReservations(
      scenes,
      [
        { castId: '', request },
        { castId: 'cast', request: { ...request, prompt: 'cast' } }
      ],
      true,
      () => 7
    )
    expect(plan.requests.map((r) => [r.sceneId, r.seed, r.prompt])).toEqual([
      [2, 4294967295, 'base, scene'],
      [2, 0, 'base, scene'],
      [1, 4294967295, 'base, scene'],
      [2, 4294967295, 'cast, scene']
    ])
    expect(plan.remaining.get(2)).toEqual({ deleted: 3 })
    expect(plan.remaining.get(1)).toEqual({})
    expect(plan.reservations).toEqual([
      { sceneId: 2, castId: '' },
      { sceneId: 2, castId: '' },
      { sceneId: 1, castId: '' },
      { sceneId: 2, castId: 'cast' }
    ])
    expect(scenes[0].reserves).toEqual({ '': 2, cast: 1, deleted: 3 })
    expect(plan.requests[0].promptParts?.detail).toBe('detail, scene')
    expect(plan.requests[0].negativePrompt).toBe('bad, worse')
  })

  it('keeps source resolution and chooses a fresh random seed per image when unlocked', () => {
    const source = { ...request, source: { imageBase64: 'image' } } as GenerationRequest
    expect(applySceneRequest(source, scene(1, {}))).toMatchObject({ width: 832, height: 1216 })
    expect(applySceneRequest(request, scene(1, {}))).toMatchObject({ width: 1024, height: 1024 })
    const random = vi.fn().mockReturnValueOnce(9).mockReturnValueOnce(10)
    expect(
      planSceneReservations(
        [scene(1, { '': 2 })],
        [{ castId: '', request }],
        false,
        random
      ).requests.map((r) => r.seed)
    ).toEqual([9, 10])
  })

  it('does not publish or start a batch when the reservation transaction fails', () => {
    const generate = vi.fn(async () => '/image.png')
    const queue = new GenerationQueue(generate)
    const changed = vi.fn()
    queue.on('changed', changed)
    expect(() =>
      queue.enqueueRequests([request, request], () => {
        throw new Error('database full')
      })
    ).toThrow('database full')
    expect(queue.status().items).toEqual([])
    expect(changed).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })

  it('starts only after commit and a second handoff cannot replay consumed reservations', async () => {
    let committed = false
    const generate = vi.fn(async () => {
      expect(committed).toBe(true)
      return '/image.png'
    })
    const queue = new GenerationQueue(generate)
    const scenes = [scene(1, { '': 1 })]
    const casts = [{ castId: '', request }]
    const first = planSceneReservations(scenes, casts, true, () => 1)
    const ids = queue.enqueueRequests(first.requests, () => {
      scenes[0].reserves = first.remaining.get(1)!
      committed = true
    })
    const second = planSceneReservations(scenes, casts, true, () => 1)
    expect(queue.enqueueRequests(second.requests, () => {})).toEqual([])
    await vi.waitFor(() => expect(queue.status().items[0].state).toBe('done'))
    expect(ids).toHaveLength(1)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate casts and invalid counts without changing reservations', () => {
    const casts = [
      { castId: '', request },
      { castId: '', request }
    ]
    expect(() => planSceneReservations([scene(1, { '': 1 })], casts, true, () => 0)).toThrow(
      'Duplicate'
    )
    expect(() =>
      planSceneReservations([scene(1, { '': 1.5 })], casts.slice(0, 1), true, () => 0)
    ).toThrow('Invalid')
  })
})

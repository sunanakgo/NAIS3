// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueItem, QueueItemState, QueueStatus } from '../src/shared/types'

const queueDoneAlert = vi.fn(async () => {})
vi.mock('../src/renderer/src/lib/completion-alert', () => ({ queueDoneAlert }))

const { bindGenerationEvents, useGenerationStore } =
  await import('../src/renderer/src/stores/generation-store')

function item(id: string, state: QueueItemState): QueueItem {
  return { id, state, request: {} as QueueItem['request'], filePath: `/${id}.png` }
}

function status(items: QueueItem[]): QueueStatus {
  return { items, running: items.some((i) => i.state === 'pending'), delayMs: 0 }
}

describe('bindGenerationEvents batch completion alert', () => {
  let emitQueue: (queue: QueueStatus) => void
  let unbind: () => void

  beforeEach(() => {
    queueDoneAlert.mockClear()
    Object.defineProperty(window, 'nais', {
      configurable: true,
      value: {
        invoke: vi.fn(async () => ({ items: [], total: 0 })),
        on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
          if (channel === 'queue:changed') emitQueue = handler
          return () => {}
        })
      }
    })
    useGenerationStore.setState({ queue: status([item('old', 'done')]) })
    unbind = bindGenerationEvents()
  })

  afterEach(() => unbind())

  it("counts only this batch's done/failed items even after old finished items are pruned", () => {
    emitQueue(status([item('old', 'done'), item('a', 'pending'), item('b', 'pending')]))
    emitQueue(status([item('old', 'done'), item('a', 'generating'), item('b', 'pending')]))
    // Broadcast after main pruned 'old' — cumulative counting would go wrong here
    emitQueue(status([item('a', 'done'), item('b', 'pending')]))
    emitQueue(status([item('a', 'done'), item('b', 'generating')]))
    emitQueue(status([item('b', 'failed')]))

    expect(queueDoneAlert).toHaveBeenCalledTimes(1)
    expect(queueDoneAlert).toHaveBeenCalledWith(1, 1)
  })

  it('restarts the count from zero for the next batch', () => {
    emitQueue(status([item('a', 'pending')]))
    emitQueue(status([item('a', 'done')]))
    emitQueue(status([item('a', 'done'), item('b', 'pending')]))
    emitQueue(status([item('a', 'done'), item('b', 'done')]))

    expect(queueDoneAlert.mock.calls).toEqual([
      [1, 0],
      [1, 0]
    ])
  })
})

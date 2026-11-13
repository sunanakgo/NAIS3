// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import type { Scene } from '../src/shared/types'
import { bindSceneEvents, useScenesStore } from '../src/renderer/src/stores/scenes-store'

afterEach(() => vi.restoreAllMocks())

it('refreshes restored reservations without treating cancellation as a new image', async () => {
  const listeners = new Map<string, (payload: never) => void>()
  const scene = {
    id: 1,
    presetId: 1,
    imageCount: 3,
    thumbnail: 'existing image',
    reserves: { 'cast-a': 2 },
    reserveCount: 2
  } as Scene
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'scenes:list') return { items: [scene] }
    if (channel === 'scenes:reservedTotal') return { total: 7 }
    throw new Error(`Unexpected invocation: ${channel}`)
  })
  window.nais = {
    invoke,
    on: (channel: string, listener: (payload: never) => void) => {
      listeners.set(channel, listener)
      return () => listeners.delete(channel)
    }
  } as NaisApi
  useScenesStore.setState({
    activePresetId: 1,
    scenes: [{ ...scene, reserves: {}, reserveCount: 0 }],
    reservedTotal: 0,
    selectedId: null
  })
  const unbind = bindSceneEvents()
  try {
    expect(listeners.has('scenes:reservationsChanged')).toBe(true)
    listeners.get('scenes:reservationsChanged')!({} as never)
    await vi.waitFor(() => expect(useScenesStore.getState().reservedTotal).toBe(7))
    expect(useScenesStore.getState().scenes[0]).toMatchObject({
      reserves: { 'cast-a': 2 },
      reserveCount: 2,
      imageCount: 3,
      thumbnail: 'existing image'
    })
  } finally {
    unbind()
  }
  expect(listeners.size).toBe(0)
})

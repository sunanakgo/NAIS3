import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, initDb } from '../src/main/db'
import { restoreBackupDatabase } from '../src/main/backup/repo'
import type { BackupDatabaseV1 } from '../src/main/backup/types'
import { GenerationQueue } from '../src/main/queue/generation-queue'
import {
  bindSceneReservationRecovery,
  bulkDelete,
  createPreset,
  createScene,
  deletePreset,
  deleteScene,
  enqueueReservedScenes,
  getScene,
  reservedTotal,
  setSceneReserves
} from '../src/main/scenes/repo'
import type { GenerationRequest } from '../src/shared/types'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: {},
  dialog: {}
}))

const request = {
  prompt: 'base',
  negativePrompt: '',
  width: 832,
  height: 1216,
  seed: 7
} as GenerationRequest
const options = {
  casts: [
    { castId: '', request },
    { castId: 'cast-a', request }
  ],
  seedLocked: true
}

const unbindRecovery: (() => void)[] = []
function bindRecovery(queue: GenerationQueue, onRestored: () => void): void {
  unbindRecovery.push(bindSceneReservationRecovery(queue, onRestored))
}

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-scene-cancel-'))
  initDb()
})
afterEach(() => {
  unbindRecovery.splice(0).forEach((unbind) => unbind())
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
  vi.useRealTimers()
})

function pendingGeneration(
  _request: GenerationRequest,
  _id: string,
  signal: AbortSignal
): Promise<string> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
      once: true
    })
  })
}

describe('cancelled scene reservations', () => {
  it('restores unfinished reservations by scene and cast, adds to new reservations, and resumes only the remainder', async () => {
    vi.useFakeTimers()
    const first = createScene(1, 'First')
    const second = createScene(createPreset('Second preset'), 'Second')
    setSceneReserves(first, { '': 3, 'cast-a': 2 })
    setSceneReserves(second, { 'cast-a': 1 })
    let resume = false
    let attempts = 0
    const queue = new GenerationQueue((...args) => {
      attempts++
      return attempts === 1 || resume ? Promise.resolve('/image.png') : pendingGeneration(...args)
    })
    queue.setDelayMs(0)
    const restored = vi.fn()
    bindRecovery(queue, restored)
    const ids = enqueueReservedScenes(queue, options)
    await vi.advanceTimersByTimeAsync(1)
    expect(queue.status().items.map((item) => item.state)).toEqual([
      'done',
      'generating',
      'pending',
      'pending',
      'pending',
      'pending'
    ])
    expect(reservedTotal()).toBe(0)
    // A separate reservation added while generation runs must not be overwritten.
    setSceneReserves(first, { '': 4 })
    queue.cancel(ids)
    queue.cancel(ids)
    await vi.runAllTimersAsync()
    expect(getScene(first)?.reserves).toEqual({ '': 6, 'cast-a': 2 })
    expect(getScene(second)?.reserves).toEqual({ 'cast-a': 1 })
    expect(reservedTotal()).toBe(9)
    expect(restored).toHaveBeenCalled()
    // Repeated cancellation must not add reservations again.
    queue.cancel(ids)
    expect(reservedTotal()).toBe(9)
    resume = true
    const resumedIds = enqueueReservedScenes(queue, options)
    expect(resumedIds).toHaveLength(9)
    expect(enqueueReservedScenes(queue, options)).toEqual([])
    await vi.runAllTimersAsync()
    expect(reservedTotal()).toBe(0)
    expect(queue.status().items.filter((item) => item.state === 'done')).toHaveLength(10)
  })

  it('does not restore an image that finishes successfully despite an abort request', async () => {
    const sceneId = createScene(1, 'Finishing')
    setSceneReserves(sceneId, { '': 1 })
    let finish!: (path: string) => void
    const queue = new GenerationQueue(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    bindRecovery(queue, () => {})
    const ids = enqueueReservedScenes(queue, options)
    queue.cancel(ids)
    finish('/already-saved.png')
    await vi.waitFor(() => expect(queue.status().running).toBe(false))
    expect(queue.status().items[0].state).toBe('done')
    expect(reservedTotal()).toBe(0)
  })

  it('does not create reservations for ad-hoc scene or main generations, or recreate deleted scenes', async () => {
    const sceneId = createScene(1, 'Deleted')
    const liveSceneId = createScene(1, 'Ad-hoc')
    setSceneReserves(sceneId, { '': 2 })
    const queue = new GenerationQueue(pendingGeneration)
    bindRecovery(queue, () => {})
    const reservedIds = enqueueReservedScenes(queue, options)
    const sceneIds = queue.enqueue({ ...request, sceneId: liveSceneId }, 1)
    const mainIds = queue.enqueue(request, 1)
    deleteScene(sceneId)
    queue.cancel([...reservedIds, ...sceneIds, ...mainIds])
    await vi.waitFor(() => expect(queue.status().running).toBe(false))
    expect(getScene(sceneId)).toBeNull()
    expect(getScene(liveSceneId)?.reserves).toEqual({})
    expect(reservedTotal()).toBe(0)
  })

  it('restores a reservation cancelled during retry backoff exactly once', async () => {
    vi.useFakeTimers()
    const sceneId = createScene(1, 'Retry')
    setSceneReserves(sceneId, { 'cast-a': 1 })
    const generate = vi.fn(async () => {
      throw Object.assign(new Error('rate limited'), { status: 429 })
    })
    const queue = new GenerationQueue(generate)
    bindRecovery(queue, () => {})
    const ids = enqueueReservedScenes(queue, options)
    await vi.advanceTimersByTimeAsync(1)
    expect(queue.status().items[0].retrying).toBe(true)
    queue.cancel(ids)
    await vi.runAllTimersAsync()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(getScene(sceneId)?.reserves).toEqual({ 'cast-a': 1 })
    closeDb()
    initDb()
    expect(getScene(sceneId)?.reserves).toEqual({ 'cast-a': 1 })
  })

  it('keeps the queue usable when restoring a cancelled reservation fails', async () => {
    const sceneId = createScene(1, 'Closing')
    setSceneReserves(sceneId, { '': 1 })
    const queue = new GenerationQueue(pendingGeneration)
    const restored = vi.fn()
    bindRecovery(queue, restored)
    const ids = enqueueReservedScenes(queue, options)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    closeDb() // e.g. the app is shutting down
    expect(() => queue.cancel(ids)).not.toThrow()
    await vi.waitFor(() => expect(queue.status().running).toBe(false))
    expect(queue.status().items.every((item) => item.state === 'cancelled')).toBe(true)
    expect(error).toHaveBeenCalled()
    expect(restored).not.toHaveBeenCalled()
    error.mockRestore()
    initDb()
  })

  it.each(['scene', 'bulk', 'preset'] as const)(
    'does not restore deleted reservations to a reused scene ID after %s deletion',
    async (deletion) => {
      const presetId = createPreset('Temporary')
      const sceneId = createScene(presetId, 'Deleted')
      setSceneReserves(sceneId, { '': 2 })
      const queue = new GenerationQueue(pendingGeneration)
      bindRecovery(queue, () => {})
      const oldIds = enqueueReservedScenes(queue, options)
      if (deletion === 'scene') deleteScene(sceneId)
      else if (deletion === 'bulk') bulkDelete([sceneId])
      else deletePreset(presetId)
      const replacement = createScene(1, 'Replacement')
      expect(replacement).toBe(sceneId)
      setSceneReserves(replacement, { 'cast-a': 1 })
      const newIds = enqueueReservedScenes(queue, options)
      queue.cancel([...oldIds, ...newIds])
      await vi.waitFor(() => expect(queue.status().running).toBe(false))
      expect(getScene(replacement)?.reserves).toEqual({ 'cast-a': 1 })
    }
  )

  it.each(['replaced', 'failed', 'unrelated'] as const)(
    'invalidates old reservations only when a backup successfully replaces scenes (%s)',
    async (result) => {
      const sceneId = createScene(1, 'Original')
      setSceneReserves(sceneId, { '': 2 })
      const queue = new GenerationQueue(pendingGeneration)
      bindRecovery(queue, () => {})
      const ids = enqueueReservedScenes(queue, options)
      const row = {
        id: sceneId,
        preset_id: 1,
        name: 'Imported',
        reserve_count: 3,
        reserve_json: JSON.stringify({ 'cast-a': 3 })
      }
      const backup: BackupDatabaseV1 = {
        version: 1,
        includedTables: result === 'unrelated' ? [] : ['gen_scenes'],
        tables: { gen_scenes: result === 'failed' ? [row, row] : [row] },
        files: []
      }
      if (result === 'failed') expect(() => restoreBackupDatabase(backup)).toThrow()
      else restoreBackupDatabase(backup)
      queue.cancel(ids)
      await vi.waitFor(() => expect(queue.status().running).toBe(false))
      expect(getScene(sceneId)?.reserves).toEqual(
        result === 'replaced' ? { 'cast-a': 3 } : { '': 2 }
      )
    }
  )
})

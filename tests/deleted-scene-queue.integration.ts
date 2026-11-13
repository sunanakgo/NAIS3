import { mkdtempSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import { restoreBackupDatabase } from '../src/main/backup/repo'
import type { BackupDatabaseV1 } from '../src/main/backup/types'
import { saveGeneratedImage } from '../src/main/images/storage'
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
  setSceneReserves
} from '../src/main/scenes/repo'
import sharp from '../src/main/sharp'
import type { GenerationRequest } from '../src/shared/types'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: {},
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const request = {
  prompt: 'base',
  negativePrompt: '',
  width: 832,
  height: 1216,
  seed: 7
} as GenerationRequest

const unbind: (() => void)[] = []
beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-deleted-scene-'))
  initDb()
})
afterEach(() => {
  unbind.splice(0).forEach((fn) => fn())
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

/** A generator that records which scene each job targeted and finishes only when told to. */
function controlledGenerator(): {
  queue: GenerationQueue
  started: (number | undefined)[]
  finishNext: () => void
  savedSceneIds: (number | undefined)[]
} {
  const started: (number | undefined)[] = []
  const savedSceneIds: (number | undefined)[] = []
  const waiting: (() => void)[] = []
  const queue = new GenerationQueue(async (req) => {
    started.push(req.sceneId)
    await new Promise<void>((resolve) => waiting.push(resolve))
    // Like the main-process callback: the scene is read from the request at save time.
    savedSceneIds.push(req.sceneId)
    return '/image.png'
  })
  queue.setDelayMs(0)
  unbind.push(bindSceneReservationRecovery(queue, () => {}))
  return {
    queue,
    started,
    savedSceneIds,
    finishNext: () => waiting.shift()?.()
  }
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter((entry) =>
    statSync(join(directory, entry)).isFile()
  )
}

describe('queued generation for deleted scenes', () => {
  it.each(['scene', 'bulk', 'preset'] as const)(
    'cancels pending jobs and detaches the running job after %s deletion',
    async (deletion) => {
      const kept = createScene(1, 'Kept')
      const presetId = createPreset('Temporary')
      const doomed = createScene(presetId, 'Doomed')
      const { queue, started, savedSceneIds, finishNext } = controlledGenerator()
      const cancelled = vi.fn()
      queue.on('cancelled', cancelled)
      const doomedIds = queue.enqueue({ ...request, sceneId: doomed }, 3)
      const keptIds = queue.enqueue({ ...request, sceneId: kept }, 1)
      await vi.waitFor(() => expect(started).toEqual([doomed]))

      if (deletion === 'scene') deleteScene(doomed)
      else if (deletion === 'bulk') bulkDelete([doomed])
      else deletePreset(presetId)
      // SQLite reuses the highest deleted ID for the next scene.
      const replacement = createScene(1, 'Replacement')
      expect(replacement).toBe(doomed)

      const states = (ids: string[]): string[] =>
        queue
          .status()
          .items.filter((item) => ids.includes(item.id))
          .map((item) => item.state)
      expect(states(doomedIds)).toEqual(['generating', 'cancelled', 'cancelled'])
      expect(cancelled).toHaveBeenCalledTimes(1)
      expect(queue.status().items.find((item) => item.id === doomedIds[0])?.request.sceneId).toBe(
        undefined
      )

      finishNext()
      await vi.waitFor(() => expect(started).toHaveLength(2))
      finishNext()
      await vi.waitFor(() => expect(queue.status().running).toBe(false))
      // The paid image is no longer attached to the scene that reused the ID.
      expect(savedSceneIds).toEqual([undefined, kept])
      expect(started).toEqual([doomed, kept])
      expect(states(doomedIds)).toEqual(['done', 'cancelled', 'cancelled'])
      expect(states(keptIds)).toEqual(['done'])
    }
  )

  it('does not give cancelled reservations to a scene that reused the deleted ID', async () => {
    const doomed = createScene(1, 'Doomed')
    setSceneReserves(doomed, { '': 2 })
    const { queue, started, finishNext } = controlledGenerator()
    enqueueReservedScenes(queue, { casts: [{ castId: '', request }], seedLocked: true })
    await vi.waitFor(() => expect(started).toHaveLength(1))
    deleteScene(doomed)
    const replacement = createScene(1, 'Replacement')
    expect(replacement).toBe(doomed)
    finishNext()
    await vi.waitFor(() => expect(queue.status().running).toBe(false))
    expect(started).toHaveLength(1)
    expect(getScene(replacement)?.reserves).toEqual({})
  })

  it('does not change the caller-owned request when detaching a running job', async () => {
    const sceneId = createScene(1, 'Shared')
    const { queue, started, finishNext } = controlledGenerator()
    const shared = { ...request, sceneId }
    queue.enqueue(shared, 1)
    await vi.waitFor(() => expect(started).toHaveLength(1))
    deleteScene(sceneId)
    expect(shared.sceneId).toBe(sceneId)
    finishNext()
    await vi.waitFor(() => expect(queue.status().running).toBe(false))
  })

  it.each(['replaced', 'failed', 'unrelated'] as const)(
    'cancels jobs for replaced scenes only after a successful restore (%s)',
    async (result) => {
      const sceneId = createScene(1, 'Original')
      const { queue, started, finishNext } = controlledGenerator()
      queue.enqueue(request, 1) // keeps the queue busy so scene jobs stay pending
      const ids = queue.enqueue({ ...request, sceneId }, 2)
      await vi.waitFor(() => expect(started).toHaveLength(1))
      const row = {
        id: sceneId,
        preset_id: 1,
        name: 'Imported',
        created_at: '2001-01-01 00:00:00' // an unrelated scene that reuses the id
      }
      const backup: BackupDatabaseV1 = {
        version: 1,
        includedTables: result === 'unrelated' ? [] : ['gen_scenes'],
        tables: { gen_scenes: result === 'failed' ? [row, row] : [row] },
        files: []
      }
      if (result === 'failed') {
        expect(() => restoreBackupDatabase(backup)).toThrow()
      } else restoreBackupDatabase(backup)
      const states = queue
        .status()
        .items.filter((item) => ids.includes(item.id))
        .map((item) => item.state)
      expect(states).toEqual(
        result === 'replaced' ? ['cancelled', 'cancelled'] : ['pending', 'pending']
      )
      queue.cancel(queue.status().items.map((item) => item.id))
      finishNext()
      await vi.waitFor(() => expect(queue.status().running).toBe(false))
    }
  )
})

describe('saving a generated image for a deleted scene', () => {
  async function pixel(): Promise<Buffer> {
    return sharp({ create: { width: 1, height: 1, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer()
  }

  it('saves to plain history instead of failing on the scene foreign key', async () => {
    const sceneId = createScene(1, 'Gone')
    deleteScene(sceneId)
    const saved = await saveGeneratedImage({
      png: await pixel(),
      sentPayload: '{}',
      seed: 1,
      kind: 'scene',
      sceneId
    })
    expect(saved.sceneId).toBeUndefined()
    const row = getDb().prepare('SELECT scene_id, file_path FROM images WHERE id = ?').get(saved.id)
    expect(row).toEqual({ scene_id: null, file_path: saved.filePath })
  })

  it('still links an existing scene', async () => {
    const sceneId = createScene(1, 'Alive')
    const saved = await saveGeneratedImage({
      png: await pixel(),
      sentPayload: '{}',
      seed: 1,
      kind: 'scene',
      sceneId,
      sceneName: 'Alive'
    })
    expect(saved.sceneId).toBe(sceneId)
    expect(getDb().prepare('SELECT scene_id FROM images').pluck().get()).toBe(sceneId)
  })

  it('keeps the paid original on disk when the history INSERT fails', async () => {
    getDb().exec(
      `CREATE TEMP TRIGGER reject_images BEFORE INSERT ON images
       BEGIN SELECT RAISE(ABORT, 'insert rejected'); END`
    )
    await expect(
      saveGeneratedImage({ png: await pixel(), sentPayload: '{}', seed: 1, kind: 't2i' })
    ).rejects.toThrow('insert rejected')
    const picturesRoot = join(environment.directory, 'NAIS3')
    expect(filesUnder(picturesRoot)).toHaveLength(1)
    expect(getDb().prepare('SELECT COUNT(*) FROM images').pluck().get()).toBe(0)
  })

  it('links the scene resolved at INSERT time, not the one passed before the thumbnail', async () => {
    const sceneId = createScene(1, 'Before')
    let current: number | undefined = sceneId
    const saving = saveGeneratedImage({
      png: await pixel(),
      sentPayload: '{}',
      seed: 1,
      kind: 'scene',
      sceneId,
      sceneName: 'Before',
      resolveSceneId: () => current
    })
    // Deleted while the thumbnail is made: the queue clears the job's sceneId
    current = undefined
    const saved = await saving
    expect(saved.sceneId).toBeUndefined()
    expect(getDb().prepare('SELECT scene_id FROM images').pluck().get()).toBeNull()
  })
})

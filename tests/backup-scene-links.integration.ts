import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import {
  captureBackupDatabase,
  exportLegacyJson,
  exportNais,
  importLegacyJson,
  importNais,
  restoreBackupDatabase
} from '../src/main/backup/repo'
import { sceneEvents } from '../src/main/scenes/events'
import { createPreset, createScene, listScenes } from '../src/main/scenes/repo'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: {},
  dialog: {}
}))

let presetId: number
let sceneA: number
let sceneB: number
let imagesA: number[]
let imageB: number
let unlinkedImage: number

function insertImage(sceneId: number | null, favorite = 0): number {
  return Number(
    getDb()
      .prepare(
        `INSERT INTO images (file_path, thumbnail, kind, seed, payload_json, scene_id, favorite)
         VALUES (?, ?, 'scene', 1, '{}', ?, ?)`
      )
      .run(
        join(environment.directory, `img-${Math.random()}.png`),
        Buffer.from('t'),
        sceneId,
        favorite
      ).lastInsertRowid
  )
}

function sceneOf(imageId: number): number | null {
  return getDb().prepare('SELECT scene_id FROM images WHERE id = ?').pluck().get(imageId) as
    number | null
}

function sceneSummary(): { id: number; name: string; imageCount: number; cover: string }[] {
  return listScenes(presetId).map((scene) => ({
    id: scene.id,
    name: scene.name,
    imageCount: scene.imageCount,
    cover: scene.thumbnailUrl ?? ''
  }))
}

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-backup-scene-links-'))
  initDb()
  presetId = createPreset('Preset')
  sceneA = createScene(presetId, 'Scene A')
  sceneB = createScene(presetId, 'Scene B')
  imagesA = [insertImage(sceneA), insertImage(sceneA, 1), insertImage(sceneA)]
  imageB = insertImage(sceneB)
  unlinkedImage = insertImage(null)
})

afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

describe('backup restore keeps generation history linked to scenes', () => {
  it('re-links every image when the same data is restored', () => {
    const before = sceneSummary()
    expect(before.map((scene) => scene.imageCount)).toEqual([3, 1])

    restoreBackupDatabase(captureBackupDatabase().database)

    for (const id of imagesA) expect(sceneOf(id)).toBe(sceneA)
    expect(sceneOf(imageB)).toBe(sceneB)
    expect(sceneOf(unlinkedImage)).toBeNull()
    // Counts and covers (the favorite image of scene A) are derived from the links.
    expect(sceneSummary()).toEqual(before)
  })

  it('re-links images through the .nais archive import', async () => {
    const before = sceneSummary()
    const { archive } = await exportNais('test')

    await importNais(archive)

    for (const id of imagesA) expect(sceneOf(id)).toBe(sceneA)
    expect(sceneOf(imageB)).toBe(sceneB)
    expect(sceneSummary()).toEqual(before)
  })

  it('re-links images through the legacy NAIS3 JSON import', () => {
    const before = sceneSummary()

    importLegacyJson(JSON.parse(JSON.stringify(exportLegacyJson())) as Record<string, unknown>)

    for (const id of imagesA) expect(sceneOf(id)).toBe(sceneA)
    expect(sceneOf(imageB)).toBe(sceneB)
    expect(sceneSummary()).toEqual(before)
  })

  it('keeps the links of a scene renamed after the backup was taken', () => {
    const { database } = captureBackupDatabase()
    const scenes = database.tables.gen_scenes ?? []
    const row = scenes.find((scene) => scene.id === sceneA)
    expect(row).toBeDefined()
    row!.name = 'Old name'

    restoreBackupDatabase(database)

    for (const id of imagesA) expect(sceneOf(id)).toBe(sceneA)
    expect(sceneOf(imageB)).toBe(sceneB)
    const renamed = sceneSummary().find((scene) => scene.id === sceneA)
    expect(renamed).toMatchObject({ name: 'Old name', imageCount: 3 })
  })

  it('does not re-link images to an unrelated scene that only shares the id and names', () => {
    // Another workspace's backup: its first scene has the same id, name and preset name,
    // but was created at another time.
    const { database } = captureBackupDatabase()
    const row = (database.tables.gen_scenes ?? []).find((scene) => scene.id === sceneA)
    expect(row).toBeDefined()
    row!.created_at = '2001-01-01 00:00:00'

    restoreBackupDatabase(database)

    for (const id of imagesA) expect(sceneOf(id)).toBeNull()
    expect(sceneOf(imageB)).toBe(sceneB)
  })

  it('keeps the links when the scene preset was renamed after the backup', () => {
    const { database } = captureBackupDatabase()
    const preset = (database.tables.scene_presets ?? []).find((row) => row.id === presetId)
    expect(preset).toBeDefined()
    preset!.name = 'Other preset'

    restoreBackupDatabase(database)

    for (const id of imagesA) expect(sceneOf(id)).toBe(sceneA)
    expect(sceneOf(imageB)).toBe(sceneB)
  })

  it('reports only the scenes that were really replaced as deleted', () => {
    const { database } = captureBackupDatabase()
    const row = (database.tables.gen_scenes ?? []).find((scene) => scene.id === sceneA)
    row!.created_at = '2001-01-01 00:00:00'
    const deleted: number[][] = []
    const onDeleted = (ids: number[]): void => void deleted.push(ids)
    sceneEvents.on('deleted', onDeleted)
    try {
      restoreBackupDatabase(database)
    } finally {
      sceneEvents.off('deleted', onDeleted)
    }
    expect(deleted).toEqual([[sceneA]])
  })

  it('leaves the link NULL when the backup lacks the scene', () => {
    const { database } = captureBackupDatabase()
    database.tables.gen_scenes = (database.tables.gen_scenes ?? []).filter(
      (scene) => scene.id !== sceneA
    )

    restoreBackupDatabase(database)

    for (const id of imagesA) expect(sceneOf(id)).toBeNull()
    expect(sceneOf(imageB)).toBe(sceneB)
    expect(sceneSummary().map((scene) => scene.id)).toEqual([sceneB])
  })
})

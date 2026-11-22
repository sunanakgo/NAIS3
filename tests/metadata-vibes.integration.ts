import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ db: null as Database.Database | null, root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => mocks.root } }))
vi.mock('../src/main/db', () => ({ getDb: () => mocks.db }))
vi.mock('../src/main/db/settings', () => ({
  getSetting: (key: string) => (key === 'ui_language' ? 'en' : null),
  setSetting: vi.fn()
}))
vi.mock('../src/main/images/storage', () => ({ libraryRoot: () => join(mocks.root, 'library') }))
vi.mock('../src/main/dialogs', () => ({ showOpenDialog: vi.fn() }))
vi.mock('../src/main/sharp', () => ({
  default: () => {
    throw new Error('sharp is not used by these tests')
  }
}))

import { migrations } from '../src/main/db/migrations'
import { captureBackupDatabase, restoreBackupDatabase } from '../src/main/backup/repo'
import { prepareVibes } from '../src/main/refs/prepare'
import {
  deleteRefImage,
  duplicateRefImage,
  importMetadataVibes,
  listVibes,
  updateRefImage
} from '../src/main/refs/repo'
import { putVibeEncoding } from '../src/main/refs/vibe-encoding-cache'

const FULL = 'nai-diffusion-4-5-full'
const CURATED = 'nai-diffusion-4-5-curated'

type VibeRow = {
  id: number
  name: string
  file_path: string
  thumbnail: Buffer | null
  enabled: number
  strength: number
  info_extracted: number
  encoded: string | null
  encoded_ie: number | null
}

function vibeRows(): VibeRow[] {
  return mocks.db!.prepare('SELECT * FROM vibe_images ORDER BY id').all() as VibeRow[]
}

beforeEach(() => {
  mocks.root = mkdtempSync(join(tmpdir(), 'nais-metadata-vibes-'))
  mocks.db = new Database(':memory:')
  mocks.db.pragma('foreign_keys = ON')
  for (const migration of migrations) migration(mocks.db)
})

afterEach(() => {
  vi.unstubAllGlobals()
  mocks.db?.close()
  mocks.db = null
  rmSync(mocks.root, { recursive: true, force: true })
})

describe('restoring vibes from image metadata', () => {
  it('creates encoded-only vibes and enables only them', () => {
    mocks
      .db!.prepare(
        `INSERT INTO vibe_images (id, name, file_path, enabled) VALUES (1, 'mine', '/x.png', 1)`
      )
      .run()

    const result = importMetadataVibes(
      [
        { encoded: 'QUJD', strength: 0.45, informationExtracted: 0.7 },
        { strength: 0.9 },
        { encoded: 'REVG', strength: 0.8 }
      ],
      FULL,
      Buffer.from('thumb')
    )

    expect(result).toMatchObject({ created: 2, reused: 0 })
    const rows = vibeRows()
    expect(rows[0].enabled).toBe(0)
    const [first, second] = rows.slice(1)
    expect(first).toMatchObject({
      name: 'Metadata vibe 1',
      enabled: 1,
      strength: 0.45,
      info_extracted: 0.7,
      encoded_ie: 0.7,
      thumbnail: Buffer.from('thumb')
    })
    // Without IE in the metadata, the NovelAI default is used as the cache key
    expect(second).toMatchObject({ name: 'Metadata vibe 2', strength: 0.8, info_extracted: 1 })
    expect(first.file_path.endsWith('.nais3vibe')).toBe(true)
    expect(first.file_path.startsWith(join(mocks.root, 'refs'))).toBe(true)
    expect(readFileSync(first.file_path, 'utf8')).toBe(first.encoded)
    expect(first.encoded).toBe(putVibeEncoding(null, null, FULL, 0.7, 'QUJD'))

    const listed = listVibes().items.filter((item) => result.ids.includes(item.id))
    expect(listed.map((item) => [item.encodedOnly, item.encodedReady, item.encodedModels])).toEqual(
      [
        [true, true, [FULL]],
        [true, true, [FULL]]
      ]
    )
    expect(listVibes().items.find((item) => item.id === 1)?.encodedOnly).toBeUndefined()
  })

  it('reuses a library vibe that already holds the same encoding', () => {
    const encoded = putVibeEncoding(null, null, FULL, 0.7, 'QUJD')
    mocks
      .db!.prepare(
        `INSERT INTO vibe_images (id, name, file_path, enabled, strength, info_extracted, encoded, encoded_ie)
       VALUES (5, 'original', '/source.png', 0, 0.2, 0.4, ?, 0.7)`
      )
      .run(encoded)

    const result = importMetadataVibes([{ encoded: 'QUJD', strength: 0.55 }], FULL, null)

    expect(result).toEqual({ ids: [5], created: 0, reused: 1 })
    expect(vibeRows()).toHaveLength(1)
    // IE goes back to the value the encoding was made with, so the cache is used again
    expect(vibeRows()[0]).toMatchObject({ enabled: 1, strength: 0.55, info_extracted: 0.7 })
  })

  it('does nothing when no vibe carries an encoding', () => {
    mocks
      .db!.prepare(
        `INSERT INTO vibe_images (id, name, file_path, enabled) VALUES (1, 'mine', '/x.png', 1)`
      )
      .run()
    expect(importMetadataVibes([{ strength: 0.5 }], FULL, null)).toEqual({
      ids: [],
      created: 0,
      reused: 0
    })
    expect(vibeRows()[0].enabled).toBe(1)
  })

  it('generates with the stored encoding and never re-encodes an encoded-only vibe', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { ids } = importMetadataVibes(
      [{ encoded: 'QUJD', strength: 0.45, informationExtracted: 0.7 }],
      FULL,
      null
    )

    await expect(prepareVibes('token', FULL)).resolves.toEqual({
      vibes: [{ strength: 0.45, encodedVibeBase64: 'QUJD' }],
      newlyEncoded: []
    })

    // The file stays the source of the encoding even if the column cache is lost
    mocks.db!.prepare('UPDATE vibe_images SET encoded = NULL, encoded_ie = NULL').run()
    await expect(prepareVibes('token', FULL, ids)).resolves.toMatchObject({
      vibes: [{ encodedVibeBase64: 'QUJD' }]
    })

    await expect(prepareVibes('token', CURATED)).rejects.toThrow(
      `It has no encoding for ${CURATED} at Info 0.7 (available: ${FULL} (IE 0.7))`
    )
    updateRefImage('vibe', ids[0], { infoExtracted: 0.3 })
    await expect(prepareVibes('token', FULL)).rejects.toThrow('restored from image metadata')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('survives backup restore, duplication and deletion like other vibe files', () => {
    const { ids } = importMetadataVibes([{ encoded: 'QUJD', strength: 0.5 }], FULL, null)
    const original = vibeRows()[0]

    const { database, skippedFiles } = captureBackupDatabase()
    expect(skippedFiles).toBe(0)
    expect(database.files).toContainEqual(
      expect.objectContaining({ table: 'vibe_images', rowId: ids[0], extension: '.nais3vibe' })
    )
    restoreBackupDatabase(database)
    const restored = vibeRows()[0]
    expect(restored.file_path).not.toBe(original.file_path)
    expect(restored.file_path.endsWith('.nais3vibe')).toBe(true)
    expect(readFileSync(restored.file_path, 'utf8')).toBe(original.encoded)
    expect(listVibes().items[0]).toMatchObject({ encodedOnly: true, encodedModels: [FULL] })

    const copyId = duplicateRefImage('vibe', ids[0])
    const copy = vibeRows().find((row) => row.id === copyId)!
    expect(copy.encoded).toBe(original.encoded)
    expect(copy.file_path.endsWith('.nais3vibe')).toBe(true)
    expect(readFileSync(copy.file_path, 'utf8')).toBe(original.encoded)

    deleteRefImage('vibe', copyId)
    expect(existsSync(copy.file_path)).toBe(false)
  })
})

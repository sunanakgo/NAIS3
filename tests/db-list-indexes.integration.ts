import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import { migrations } from '../src/main/db/migrations'
import { listLibrary } from '../src/main/library/repo'
import { listScenes, sceneImages } from '../src/main/scenes/repo'
import { thumbnailUrl } from '../src/shared/thumbnail-url'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'en-US' },
  BrowserWindow: {},
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

function plan(db: Database.Database, sql: string, ...params: unknown[]): string {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
    .map((row) => row.detail)
    .join('\n')
}

describe('v20 list indexes', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    for (const migrate of migrations) migrate(db)
  })
  afterEach(() => db.close())

  it.each([
    [
      'scene card cover',
      'SELECT id FROM images WHERE scene_id = ? ORDER BY favorite DESC, id DESC LIMIT 1',
      'idx_images_scene_favorite'
    ],
    [
      'favorites-only scene page',
      'SELECT id FROM images WHERE scene_id = ? AND favorite = 1 ORDER BY id DESC LIMIT 50 OFFSET 0',
      'idx_images_scene_favorite'
    ],
    [
      'library stack page',
      'SELECT id FROM library_images WHERE stack_id = ? ORDER BY sort_order DESC, id DESC LIMIT 50 OFFSET 0',
      'idx_library_images_stack_order'
    ],
    [
      'library root page',
      'SELECT id FROM library_images WHERE stack_id IS NULL ORDER BY sort_order DESC, id DESC LIMIT 50 OFFSET 0',
      'idx_library_images_stack_order'
    ]
  ])('serves the %s from the index without a sort', (_name, sql, index) => {
    const detail = plan(db, sql, ...(sql.includes('?') ? [1] : []))
    expect(detail).toContain(index)
    expect(detail).not.toContain('TEMP B-TREE')
  })
})

describe('listScenes cover lookup', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nais3-list-indexes-'))
    environment.directory = root
    initDb()
  })
  afterEach(() => {
    closeDb()
    rmSync(root, { recursive: true, force: true })
  })

  it('joins one cover row per scene and reads it through the new index', () => {
    const detail = plan(
      getDb(),
      `SELECT s.id, cover.thumbnail FROM gen_scenes s
       LEFT JOIN images cover ON cover.id = (
         SELECT id FROM images WHERE scene_id = s.id ORDER BY favorite DESC, id DESC LIMIT 1
       ) WHERE s.preset_id = ?`,
      1
    )
    expect(detail).toContain('idx_images_scene_favorite')
    expect(detail).toContain('INTEGER PRIMARY KEY')
  })

  it('returns the same cover, path, count and favorite flag as the previous subqueries', () => {
    const db = getDb()
    db.exec(`
      INSERT INTO scene_presets (id, name) VALUES (2, 'other');
      INSERT INTO gen_scenes (id, preset_id, name, sort_order) VALUES
        (1, 1, 'empty', 0), (2, 1, 'plain', 1), (3, 1, 'favorites', 2),
        (4, 1, 'cover without thumbnail', 3), (5, 2, 'other preset', 0);
      INSERT INTO images (id, file_path, thumbnail, payload_json, scene_id, favorite) VALUES
        (1, '/s2/1.png', X'01', '{}', 2, 0),
        (2, '/s2/2.png', X'02', '{}', 2, 0),
        (3, '/s2/3.png', X'03', '{}', 2, 0),
        (4, '/s3/4.png', X'04', '{}', 3, 1),
        (5, '/s3/5.png', X'05', '{}', 3, 0),
        (6, '/s3/6.png', X'06', '{}', 3, 1),
        (7, '/s3/7.png', X'07', '{}', 3, 0),
        (8, '/s4/8.png', NULL, '{}', 4, 0),
        (9, '/s5/9.png', X'09', '{}', 5, 1),
        (10, '/none.png', X'0A', '{}', NULL, 1);
    `)
    const previous = db
      .prepare(
        `SELECT s.id,
                (SELECT COUNT(*) FROM images WHERE scene_id = s.id) AS image_count,
                (SELECT thumbnail FROM images WHERE scene_id = s.id ORDER BY favorite DESC, id DESC LIMIT 1) AS thumb,
                (SELECT id FROM images WHERE scene_id = s.id ORDER BY favorite DESC, id DESC LIMIT 1) AS thumb_id,
                (SELECT created_at FROM images WHERE scene_id = s.id ORDER BY favorite DESC, id DESC LIMIT 1) AS thumb_created_at,
                (SELECT file_path FROM images WHERE scene_id = s.id ORDER BY favorite DESC, id DESC LIMIT 1) AS thumb_path,
                EXISTS(SELECT 1 FROM images WHERE scene_id = s.id AND favorite = 1) AS has_favorite
         FROM gen_scenes s WHERE s.preset_id = ? ORDER BY s.sort_order, s.id`
      )
      .all(1) as {
      id: number
      image_count: number
      thumb: Buffer | null
      thumb_id: number | null
      thumb_created_at: string | null
      thumb_path: string | null
      has_favorite: number
    }[]

    const scenes = listScenes(1)
    expect(scenes.map((s) => s.id)).toEqual([1, 2, 3, 4])
    expect(
      scenes.map((s) => ({
        id: s.id,
        imageCount: s.imageCount,
        thumbnailUrl: s.thumbnailUrl,
        thumbnailPath: s.thumbnailPath,
        hasFavorite: s.hasFavorite
      }))
    ).toEqual(
      previous.map((r) => ({
        id: r.id,
        imageCount: r.image_count,
        thumbnailUrl: r.thumb ? thumbnailUrl('image', r.thumb_id!, r.thumb_created_at!) : '',
        thumbnailPath: r.thumb_path ?? '',
        hasFavorite: r.has_favorite === 1
      }))
    )
    // Spot-check the expectations themselves, not only parity with the old query.
    expect(scenes[1]).toMatchObject({ thumbnailPath: '/s2/3.png', hasFavorite: false })
    expect(scenes[2]).toMatchObject({ thumbnailPath: '/s3/6.png', hasFavorite: true })
    expect(scenes[3]).toMatchObject({ thumbnailUrl: '', thumbnailPath: '/s4/8.png', imageCount: 1 })
  })

  it('keeps scene and library paging order unchanged', () => {
    const db = getDb()
    db.exec(`
      INSERT INTO gen_scenes (id, name) VALUES (1, 'scene');
      INSERT INTO images (id, file_path, payload_json, scene_id, favorite) VALUES
        (1, '/a', '{}', 1, 1), (2, '/b', '{}', 1, 0), (3, '/c', '{}', 1, 1), (4, '/d', '{}', 1, 1);
      INSERT INTO library_stacks (id, name) VALUES (1, 'stack');
      INSERT INTO library_images (id, file_path, stack_id, sort_order) VALUES
        (1, '/l1', NULL, 2), (2, '/l2', NULL, 5), (3, '/l3', NULL, 5), (4, '/l4', 1, 1), (5, '/l5', 1, 9);
    `)
    expect(sceneImages(1, 2, 0, true)).toMatchObject({ total: 3, items: [{ id: 4 }, { id: 3 }] })
    expect(sceneImages(1, 2, 2, true)).toMatchObject({ total: 3, items: [{ id: 1 }] })
    expect(listLibrary(null, 10, 0).items.map((i) => i.id)).toEqual([3, 2, 1])
    expect(listLibrary(1, 10, 0).items.map((i) => i.id)).toEqual([5, 4])
  })
})

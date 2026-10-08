import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrations } from '../src/main/db/migrations'

function plan(db: Database.Database, sql: string, ...params: unknown[]): string {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
    .map((row) => row.detail)
    .join('\n')
}

describe('images file_path index', () => {
  it('serves path lookups and the ephemeral sweep from the index', () => {
    const db = new Database(':memory:')
    try {
      for (const migrate of migrations) migrate(db)
      const insert = db.prepare('INSERT INTO images (file_path, payload_json) VALUES (?, ?)')
      insert.run('/out/a.png', '{}')
      insert.run('memory://b.png', '{}')
      insert.run('MEMORY://c.png', '{}')

      expect(plan(db, 'SELECT thumbnail FROM images WHERE file_path = ?', '/out/a.png')).toContain(
        'idx_images_file_path'
      )
      const sweep =
        "SELECT id, file_path FROM images WHERE file_path GLOB 'memory://*' ORDER BY id DESC LIMIT -1 OFFSET ?"
      expect(plan(db, sweep, 0)).toContain('idx_images_file_path')
      // GLOB은 대소문자를 구분 — 임시 이미지 마커만 정리 대상
      expect(db.prepare(sweep).all(0)).toEqual([{ id: 2, file_path: 'memory://b.png' }])
    } finally {
      db.close()
    }
  })
})

import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { BrowserWindow, dialog } from 'electron'
import sharp from 'sharp'
import type { LibraryImage, LibraryStack } from '../../shared/types'
import { getDb } from '../db'
import { libraryRoot } from '../images/storage'

/**
 * 라이브러리 — 사용자가 직접 모아두는 큐레이션 컬렉션 (NAIS2 라이브러리 이식).
 * 파일은 항상 curated/ 아래 복사본 (libraryRoot 하위라 nais-image 프로토콜·
 * 저장/복사/메타데이터 IPC의 isUnderImagesRoot 게이트를 자동 통과).
 */

function curatedDir(): string {
  const dir = join(libraryRoot(), 'curated')
  mkdirSync(dir, { recursive: true })
  return dir
}

interface ImageRow {
  id: number
  name: string
  file_path: string
  thumbnail: Buffer | null
  width: number | null
  height: number | null
  stack_id: number | null
}

function toImage(r: ImageRow): LibraryImage {
  return {
    id: r.id,
    name: r.name,
    filePath: r.file_path,
    thumbnail: r.thumbnail ? r.thumbnail.toString('base64') : '',
    width: r.width,
    height: r.height,
    stackId: r.stack_id
  }
}

/** stackId 미지정/null = 루트(스택 목록 + 미분류 이미지), 지정 = 해당 스택 내부 */
export function listLibrary(
  stackId: number | null | undefined,
  limit: number,
  offset: number
): { items: LibraryImage[]; stacks: LibraryStack[]; total: number } {
  const db = getDb()
  const inStack = stackId != null
  const where = inStack ? 'stack_id = ?' : 'stack_id IS NULL'
  const params = inStack ? [stackId] : []

  const rows = db
    .prepare(
      `SELECT id, name, file_path, thumbnail, width, height, stack_id
       FROM library_images WHERE ${where} ORDER BY sort_order DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as ImageRow[]
  const { c: total } = db
    .prepare(`SELECT COUNT(*) AS c FROM library_images WHERE ${where}`)
    .get(...params) as { c: number }

  const stacks = inStack
    ? []
    : (
        db
          .prepare(
            `SELECT s.id, s.name,
               (SELECT COUNT(*) FROM library_images i WHERE i.stack_id = s.id) AS count,
               (SELECT thumbnail FROM library_images i WHERE i.stack_id = s.id ORDER BY i.id DESC LIMIT 1) AS cover
             FROM library_stacks s ORDER BY s.id DESC`
          )
          .all() as { id: number; name: string; count: number; cover: Buffer | null }[]
      ).map((s) => ({
        id: s.id,
        name: s.name,
        count: s.count,
        coverThumbnail: s.cover ? s.cover.toString('base64') : ''
      }))

  return { items: rows.map(toImage), stacks, total }
}

/** 원본 버퍼 → curated/ 저장 + 640 webp 썸네일 + 행 삽입 (refs addRefImages 패턴) */
async function insertImage(
  buf: Buffer,
  name: string,
  ext: string,
  stackId: number | null
): Promise<void> {
  const dest = join(curatedDir(), `${randomUUID()}${ext || '.png'}`)
  writeFileSync(dest, buf)
  const meta = await sharp(buf).metadata()
  const thumbnail = await sharp(buf)
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer()
  getDb()
    .prepare(
      `INSERT INTO library_images (name, file_path, thumbnail, width, height, stack_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM library_images))`
    )
    .run(name, dest, thumbnail, meta.width ?? null, meta.height ?? null, stackId)
}

/**
 * 드래그 정렬 — 화면에 로드된 ids(전역 정렬의 연속 구간)의 새 순서를 반영.
 * 이 ids가 원래 갖고 있던 sort_order 슬롯들을 새 순서대로 재배분하므로,
 * 아직 로드되지 않은 아래쪽 이미지들과의 상대 순서는 변하지 않는다.
 */
export function reorderImages(ids: number[]): void {
  if (ids.length < 2) return
  const db = getDb()
  const q = ids.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT sort_order FROM library_images WHERE id IN (${q})`)
    .all(...ids) as { sort_order: number }[]
  const slots = rows.map((r) => r.sort_order).sort((a, b) => b - a) // 큰 값 = 앞
  const upd = db.prepare('UPDATE library_images SET sort_order = ? WHERE id = ?')
  db.transaction(() => {
    ids.forEach((id, i) => upd.run(slots[i], id))
  })()
}

/** 파일 다이얼로그(다중 선택)로 가져오기 */
export async function importViaDialog(stackId: number | null): Promise<number> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: '라이브러리에 이미지 추가',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  })
  if (result.canceled) return 0
  return importPaths(result.filePaths, stackId)
}

/** 경로 목록으로 가져오기 (히스토리 드래그 등 — 항상 복사) */
export async function importPaths(filePaths: string[], stackId: number | null): Promise<number> {
  let count = 0
  for (const src of filePaths) {
    if (!existsSync(src)) continue
    await insertImage(readFileSync(src), basename(src, extname(src)), extname(src), stackId)
    count++
  }
  return count
}

/** 외부 드롭(base64)으로 가져오기 */
export async function importBase64(
  images: { name: string; base64: string }[],
  stackId: number | null
): Promise<number> {
  for (const img of images) {
    const buf = Buffer.from(img.base64.replace(/^data:[^,]+,/, ''), 'base64')
    const ext = extname(img.name)
    await insertImage(buf, basename(img.name, ext), ext, stackId)
  }
  return images.length
}

/** 삭제 — 행 + curated 복사본 파일. 라이브러리 파일은 항상 우리가 만든 복사본이라 파일도 지운다 */
export function deleteImages(ids: number[]): void {
  if (ids.length === 0) return
  const db = getDb()
  const q = ids.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT file_path FROM library_images WHERE id IN (${q})`)
    .all(...ids) as { file_path: string }[]
  for (const r of rows) {
    try {
      if (existsSync(r.file_path)) unlinkSync(r.file_path)
    } catch {
      // 파일 삭제 실패해도 행은 지운다 (다음 스캔에서 고아 파일로 남을 뿐)
    }
  }
  db.prepare(`DELETE FROM library_images WHERE id IN (${q})`).run(...ids)
}

export function createStack(name: string, imageIds: number[]): number {
  const db = getDb()
  const id = db.prepare('INSERT INTO library_stacks (name) VALUES (?)').run(name)
    .lastInsertRowid as number
  if (imageIds.length > 0) setStack(imageIds, id)
  return id
}

export function renameStack(id: number, name: string): void {
  getDb().prepare('UPDATE library_stacks SET name = ? WHERE id = ?').run(name, id)
}

/** 스택 삭제 — 소속 이미지는 미분류로 되돌린다 (이미지 삭제 아님) */
export function deleteStack(id: number): void {
  const db = getDb()
  db.prepare('UPDATE library_images SET stack_id = NULL WHERE stack_id = ?').run(id)
  db.prepare('DELETE FROM library_stacks WHERE id = ?').run(id)
}

export function setStack(imageIds: number[], stackId: number | null): void {
  if (imageIds.length === 0) return
  const q = imageIds.map(() => '?').join(',')
  getDb()
    .prepare(`UPDATE library_images SET stack_id = ? WHERE id IN (${q})`)
    .run(stackId, ...imageIds)
}

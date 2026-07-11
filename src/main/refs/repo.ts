import { app, BrowserWindow, dialog } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import type { CharacterOrderEntry, CharRefItem, ListFolder, VibeItem } from '../../shared/types'
import { getDb } from '../db'

/**
 * 바이브/캐릭레퍼 이미지 라이브러리 — 캐릭터·조각과 동일한 폴더 리스트 모델.
 * 원본 이미지는 userData/refs/에 파일로 복사, DB에는 경로·썸네일·파라미터만.
 */

type Kind = 'vibe' | 'charref'

const TABLES: Record<Kind, { items: string; folders: string }> = {
  vibe: { items: 'vibe_images', folders: 'vibe_folders' },
  charref: { items: 'charref_images', folders: 'charref_folders' }
}

function refsDir(): string {
  const dir = join(app.getPath('userData'), 'refs')
  mkdirSync(dir, { recursive: true })
  return dir
}

function listFolders(kind: Kind): ListFolder[] {
  return (
    getDb()
      .prepare(`SELECT id, name, collapsed, color FROM ${TABLES[kind].folders} ORDER BY sort_order`)
      .all() as { id: number; name: string; collapsed: number; color: string | null }[]
  ).map((f) => ({ id: f.id, name: f.name, collapsed: f.collapsed === 1, color: f.color }))
}

export function listVibes(): { folders: ListFolder[]; items: VibeItem[] } {
  const rows = getDb()
    .prepare(
      `SELECT id, name, thumbnail, enabled, strength, info_extracted, encoded, encoded_ie, folder_id
       FROM vibe_images ORDER BY sort_order, id`
    )
    .all() as {
    id: number
    name: string
    thumbnail: Buffer | null
    enabled: number
    strength: number
    info_extracted: number
    encoded: string | null
    encoded_ie: number | null
    folder_id: number | null
  }[]
  return {
    folders: listFolders('vibe'),
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      thumbnail: r.thumbnail ? r.thumbnail.toString('base64') : '',
      enabled: r.enabled === 1,
      strength: r.strength,
      infoExtracted: r.info_extracted,
      encodedReady: r.encoded !== null && r.encoded_ie === r.info_extracted,
      folderId: r.folder_id
    }))
  }
}

export function listCharRefs(): { folders: ListFolder[]; items: CharRefItem[] } {
  const rows = getDb()
    .prepare(
      `SELECT id, name, thumbnail, enabled, ref_type, strength, fidelity, folder_id
       FROM charref_images ORDER BY sort_order, id`
    )
    .all() as {
    id: number
    name: string
    thumbnail: Buffer | null
    enabled: number
    ref_type: string
    strength: number
    fidelity: number
    folder_id: number | null
  }[]
  return {
    folders: listFolders('charref'),
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      thumbnail: r.thumbnail ? r.thumbnail.toString('base64') : '',
      enabled: r.enabled === 1,
      refType: r.ref_type as CharRefItem['refType'],
      strength: r.strength,
      fidelity: r.fidelity,
      folderId: r.folder_id
    }))
  }
}

/** 파일 다이얼로그(다중 선택) → refs/로 복사 + 썸네일 생성 + 행 삽입 */
export async function addRefImages(kind: Kind, folderId: number | null): Promise<number> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: kind === 'vibe' ? '바이브 이미지 추가' : '레퍼런스 이미지 추가',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  })
  if (result.canceled) return 0

  const db = getDb()
  const table = TABLES[kind].items
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${table}`).get() as {
    m: number
  }
  let order = max.m

  for (const src of result.filePaths) {
    const dest = join(refsDir(), `${randomUUID()}${extname(src)}`)
    copyFileSync(src, dest)
    const thumbnail = await sharp(readFileSync(src))
      .resize(192, 192, { fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer()
    db.prepare(
      `INSERT INTO ${table} (name, file_path, thumbnail, folder_id, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).run(basename(src, extname(src)), dest, thumbnail, folderId, ++order)
  }
  return result.filePaths.length
}

const VIBE_FIELDS: Record<string, string> = {
  name: 'name',
  enabled: 'enabled',
  strength: 'strength',
  infoExtracted: 'info_extracted'
}
const CREF_FIELDS: Record<string, string> = {
  name: 'name',
  enabled: 'enabled',
  refType: 'ref_type',
  strength: 'strength',
  fidelity: 'fidelity'
}

export function updateRefImage(kind: Kind, id: number, patch: Record<string, unknown>): void {
  const fields = kind === 'vibe' ? VIBE_FIELDS : CREF_FIELDS
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, column] of Object.entries(fields)) {
    if (patch[key] === undefined) continue
    sets.push(`${column} = ?`)
    values.push(typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : patch[key])
  }
  if (sets.length === 0) return
  getDb()
    .prepare(`UPDATE ${TABLES[kind].items} SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id)
}

/** 복제 — 모든 컬럼 복사 (바이브 인코딩 캐시 포함 — 2 Anlas 재소모 방지). 삭제가 파일까지 지우므로 파일도 복사 */
export function duplicateRefImage(kind: Kind, id: number): number {
  const db = getDb()
  const table = TABLES[kind].items
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined
  if (!row) return 0
  const src = row.file_path as string
  if (src && existsSync(src)) {
    const dest = join(refsDir(), `${randomUUID()}${extname(src)}`)
    copyFileSync(src, dest)
    row.file_path = dest
  }
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${table}`).get() as {
    m: number
  }
  row.sort_order = max.m + 1
  const cols = Object.keys(row).filter((k) => k !== 'id' && k !== 'created_at')
  const info = db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((k) => row[k]))
  return Number(info.lastInsertRowid)
}

export function deleteRefImage(kind: Kind, id: number): void {
  const db = getDb()
  const row = db.prepare(`SELECT file_path FROM ${TABLES[kind].items} WHERE id = ?`).get(id) as
    { file_path: string } | undefined
  db.prepare(`DELETE FROM ${TABLES[kind].items} WHERE id = ?`).run(id)
  if (row && row.file_path.startsWith(refsDir())) {
    try {
      rmSync(row.file_path)
    } catch {
      // 파일이 이미 없으면 무시
    }
  }
}

export function reorderRefs(kind: Kind, order: CharacterOrderEntry[]): void {
  const db = getDb()
  const setFolder = db.prepare(`UPDATE ${TABLES[kind].folders} SET sort_order = ? WHERE id = ?`)
  const setItem = db.prepare(
    `UPDATE ${TABLES[kind].items} SET sort_order = ?, folder_id = ? WHERE id = ?`
  )
  db.transaction(() => {
    let currentFolder: number | null = null
    order.forEach((entry, i) => {
      if (entry.type === 'folder') {
        currentFolder = entry.id
        setFolder.run(i, entry.id)
      } else {
        setItem.run(i, currentFolder, entry.id)
      }
    })
  })()
}

export function createRefFolder(kind: Kind, name: string): number {
  const db = getDb()
  const table = TABLES[kind].folders
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${table}`).get() as {
    m: number
  }
  return Number(
    db.prepare(`INSERT INTO ${table} (name, sort_order) VALUES (?, ?)`).run(name, max.m + 1)
      .lastInsertRowid
  )
}

export function renameRefFolder(kind: Kind, id: number, name: string): void {
  getDb().prepare(`UPDATE ${TABLES[kind].folders} SET name = ? WHERE id = ?`).run(name, id)
}

export function collapseRefFolder(kind: Kind, id: number, collapsed: boolean): void {
  getDb()
    .prepare(`UPDATE ${TABLES[kind].folders} SET collapsed = ? WHERE id = ?`)
    .run(collapsed ? 1 : 0, id)
}

export function colorRefFolder(kind: Kind, id: number, color: string | null): void {
  getDb().prepare(`UPDATE ${TABLES[kind].folders} SET color = ? WHERE id = ?`).run(color, id)
}

export function deleteRefFolder(kind: Kind, id: number): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare(`UPDATE ${TABLES[kind].items} SET folder_id = NULL WHERE folder_id = ?`).run(id)
    db.prepare(`DELETE FROM ${TABLES[kind].folders} WHERE id = ?`).run(id)
  })()
}

/** 생성 시 사용할 enabled 항목들의 원본 데이터 */
export function enabledVibeRows(): {
  id: number
  filePath: string
  strength: number
  infoExtracted: number
  encoded: string | null
  encodedIe: number | null
}[] {
  return (
    getDb()
      .prepare(
        `SELECT id, file_path, strength, info_extracted, encoded, encoded_ie
         FROM vibe_images WHERE enabled = 1 ORDER BY sort_order, id`
      )
      .all() as {
      id: number
      file_path: string
      strength: number
      info_extracted: number
      encoded: string | null
      encoded_ie: number | null
    }[]
  ).map((r) => ({
    id: r.id,
    filePath: r.file_path,
    strength: r.strength,
    infoExtracted: r.info_extracted,
    encoded: r.encoded,
    encodedIe: r.encoded_ie
  }))
}

export function saveVibeEncoding(id: number, encoded: string, ie: number): void {
  getDb()
    .prepare('UPDATE vibe_images SET encoded = ?, encoded_ie = ? WHERE id = ?')
    .run(encoded, ie, id)
}

export function enabledCharRefRows(): {
  filePath: string
  refType: string
  strength: number
  fidelity: number
}[] {
  const rows = getDb()
    .prepare(
      `SELECT file_path, ref_type, strength, fidelity
       FROM charref_images WHERE enabled = 1 ORDER BY sort_order, id`
    )
    .all() as { file_path: string; ref_type: string; strength: number; fidelity: number }[]
  return rows.map((r) => ({
    filePath: r.file_path,
    refType: r.ref_type,
    strength: r.strength,
    fidelity: r.fidelity
  }))
}

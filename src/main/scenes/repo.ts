import { BrowserWindow, dialog } from 'electron'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { basename } from 'path'
import JSZip from 'jszip'
import type { Scene, SceneImage, ScenePreset } from '../../shared/types'
import { getDb } from '../db'

interface Row {
  id: number
  preset_id: number
  name: string
  prompt: string
  negative_prompt: string
  width: number
  height: number
  reserve_count: number
}

function toScene(
  r: Row & { image_count: number; thumb?: Buffer | null; thumb_path?: string | null }
): Scene {
  return {
    id: r.id,
    presetId: r.preset_id,
    name: r.name,
    prompt: r.prompt,
    negativePrompt: r.negative_prompt,
    width: r.width,
    height: r.height,
    reserveCount: r.reserve_count,
    thumbnail: r.thumb ? r.thumb.toString('base64') : '',
    thumbnailPath: r.thumb_path ?? '',
    imageCount: r.image_count
  }
}

// ── 프리셋 ──────────────────────────────────────────────
export function listPresets(): ScenePreset[] {
  return getDb()
    .prepare('SELECT id, name FROM scene_presets ORDER BY sort_order, id')
    .all() as ScenePreset[]
}

export function createPreset(name: string): number {
  const db = getDb()
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM scene_presets').get() as {
    m: number
  }
  return Number(
    db.prepare('INSERT INTO scene_presets (name, sort_order) VALUES (?, ?)').run(name, max.m + 1)
      .lastInsertRowid
  )
}

export function renamePreset(id: number, name: string): void {
  getDb().prepare('UPDATE scene_presets SET name = ? WHERE id = ?').run(name, id)
}

/** 프리셋 삭제 — 마지막 하나는 못 지움. 안의 씬도 함께 삭제(이미지는 scene_id만 끊김) */
export function deletePreset(id: number): void {
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) AS c FROM scene_presets').get() as { c: number }).c
  if (count <= 1) return
  db.transaction(() => {
    db.prepare('DELETE FROM gen_scenes WHERE preset_id = ?').run(id)
    db.prepare('DELETE FROM scene_presets WHERE id = ?').run(id)
  })()
}

// ── 씬 ──────────────────────────────────────────────────
/** 프리셋별 목록 (썸네일은 씬당 1장만 조인 — 수만 장이어도 가벼움) */
export function listScenes(presetId: number): Scene[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.preset_id, s.name, s.prompt, s.negative_prompt, s.width, s.height, s.reserve_count,
              (SELECT COUNT(*) FROM images WHERE scene_id = s.id) AS image_count,
              (SELECT thumbnail FROM images WHERE scene_id = s.id ORDER BY id DESC LIMIT 1) AS thumb,
              (SELECT file_path FROM images WHERE scene_id = s.id ORDER BY id DESC LIMIT 1) AS thumb_path
       FROM gen_scenes s WHERE s.preset_id = ? ORDER BY s.sort_order, s.id`
    )
    .all(presetId) as (Row & { image_count: number; thumb: Buffer | null; thumb_path: string | null })[]
  return rows.map(toScene)
}

export function getScene(id: number): Scene | null {
  const r = getDb()
    .prepare(
      `SELECT id, preset_id, name, prompt, negative_prompt, width, height, reserve_count,
              (SELECT COUNT(*) FROM images WHERE scene_id = ?) AS image_count
       FROM gen_scenes WHERE id = ?`
    )
    .get(id, id) as (Row & { image_count: number }) | undefined
  return r ? toScene(r) : null
}

export function createScene(presetId: number, name: string): number {
  const db = getDb()
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM gen_scenes WHERE preset_id = ?')
    .get(presetId) as { m: number }
  return Number(
    db
      .prepare('INSERT INTO gen_scenes (preset_id, name, sort_order) VALUES (?, ?, ?)')
      .run(presetId, name, max.m + 1).lastInsertRowid
  )
}

export function duplicateScene(id: number): number {
  const db = getDb()
  const s = db.prepare('SELECT * FROM gen_scenes WHERE id = ?').get(id) as Row | undefined
  if (!s) return 0
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM gen_scenes WHERE preset_id = ?')
    .get(s.preset_id) as { m: number }
  return Number(
    db
      .prepare(
        `INSERT INTO gen_scenes (preset_id, name, prompt, negative_prompt, width, height, sort_order, reserve_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(s.preset_id, `${s.name} 복제`, s.prompt, s.negative_prompt, s.width, s.height, max.m + 1)
      .lastInsertRowid
  )
}

const FIELDS: Record<string, string> = {
  name: 'name',
  prompt: 'prompt',
  negativePrompt: 'negative_prompt',
  width: 'width',
  height: 'height',
  reserveCount: 'reserve_count'
}

export function updateScene(id: number, patch: Record<string, unknown>): void {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, col] of Object.entries(FIELDS)) {
    if (patch[key] === undefined) continue
    sets.push(`${col} = ?`)
    values.push(patch[key])
  }
  if (sets.length === 0) return
  sets.push(`updated_at = datetime('now')`)
  getDb()
    .prepare(`UPDATE gen_scenes SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id)
}

export function deleteScene(id: number): void {
  getDb().prepare('DELETE FROM gen_scenes WHERE id = ?').run(id)
}

export function reorderScenes(ids: number[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE gen_scenes SET sort_order = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id)))()
}

/** 프리셋 내 전체 씬 예약 수를 count로 설정 (전체 취소 0 등) */
export function setReserveAll(presetId: number, count: number): void {
  getDb().prepare('UPDATE gen_scenes SET reserve_count = ? WHERE preset_id = ?').run(count, presetId)
}

/** 프리셋 내 전체 씬 예약 수를 delta만큼 증감 (최소 0) */
export function adjustReserveAll(presetId: number, delta: number): void {
  getDb()
    .prepare('UPDATE gen_scenes SET reserve_count = MAX(0, reserve_count + ?) WHERE preset_id = ?')
    .run(delta, presetId)
}

// ── 편집 모드 일괄 작업 ──────────────────────────────────
function placeholders(n: number): string {
  return Array(n).fill('?').join(',')
}

export function bulkMove(ids: number[], presetId: number): void {
  if (ids.length === 0) return
  getDb()
    .prepare(`UPDATE gen_scenes SET preset_id = ? WHERE id IN (${placeholders(ids.length)})`)
    .run(presetId, ...ids)
}

export function bulkDelete(ids: number[]): void {
  if (ids.length === 0) return
  getDb()
    .prepare(`DELETE FROM gen_scenes WHERE id IN (${placeholders(ids.length)})`)
    .run(...ids)
}

export function bulkSetResolution(ids: number[], width: number, height: number): void {
  if (ids.length === 0) return
  getDb()
    .prepare(`UPDATE gen_scenes SET width = ?, height = ? WHERE id IN (${placeholders(ids.length)})`)
    .run(width, height, ...ids)
}

export function bulkClearFavorites(ids: number[]): void {
  if (ids.length === 0) return
  getDb()
    .prepare(`UPDATE images SET favorite = 0 WHERE scene_id IN (${placeholders(ids.length)})`)
    .run(...ids)
}

/** 선택 씬들의 생성 이미지를 전부 삭제 (DB 행 + 파일). 대량이라 파일은 best-effort */
export function bulkClearImages(ids: number[]): number {
  if (ids.length === 0) return 0
  const db = getDb()
  const rows = db
    .prepare(`SELECT file_path FROM images WHERE scene_id IN (${placeholders(ids.length)})`)
    .all(...ids) as { file_path: string }[]
  db.prepare(`DELETE FROM images WHERE scene_id IN (${placeholders(ids.length)})`).run(...ids)
  for (const r of rows) {
    try {
      unlinkSync(r.file_path)
    } catch {
      // 파일이 이미 없으면 무시
    }
  }
  return rows.length
}

// ── 씬 상세 이미지 (페이지네이션) ────────────────────────
export function sceneImages(
  sceneId: number,
  limit: number,
  offset: number
): { items: SceneImage[]; total: number } {
  const db = getDb()
  const total = (
    db.prepare('SELECT COUNT(*) AS c FROM images WHERE scene_id = ?').get(sceneId) as { c: number }
  ).c
  const rows = db
    .prepare(
      `SELECT id, file_path, thumbnail, seed, favorite FROM images
       WHERE scene_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(sceneId, limit, offset) as {
    id: number
    file_path: string
    thumbnail: Buffer | null
    seed: number | null
    favorite: number
  }[]
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      thumbnail: r.thumbnail ? r.thumbnail.toString('base64') : '',
      seed: r.seed,
      favorite: r.favorite === 1
    }))
  }
}

export function setImageFavorite(id: number, favorite: boolean): void {
  getDb()
    .prepare('UPDATE images SET favorite = ? WHERE id = ?')
    .run(favorite ? 1 : 0, id)
}

/** 히스토리 전체 비우기 — 모든 이미지 레코드+원본 파일 삭제 (씬 이미지 포함) */
export function clearAllImages(): number {
  const db = getDb()
  const rows = db.prepare('SELECT file_path FROM images').all() as { file_path: string }[]
  db.prepare('DELETE FROM images').run()
  for (const r of rows) {
    try {
      unlinkSync(r.file_path)
    } catch {
      // 무시 (이미 없는 파일 등)
    }
  }
  return rows.length
}

export function deleteImage(id: number): void {
  const db = getDb()
  const r = db.prepare('SELECT file_path FROM images WHERE id = ?').get(id) as
    | { file_path: string }
    | undefined
  db.prepare('DELETE FROM images WHERE id = ?').run(id)
  if (r) {
    try {
      unlinkSync(r.file_path)
    } catch {
      // 무시
    }
  }
}

// ── JSON / ZIP ──────────────────────────────────────────
export async function exportScenesJson(presetId: number): Promise<boolean> {
  const scenes = getDb()
    .prepare(
      'SELECT name, prompt, negative_prompt, width, height FROM gen_scenes WHERE preset_id = ? ORDER BY sort_order, id'
    )
    .all(presetId) as Row[]
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win, {
    title: '씬 내보내기',
    defaultPath: 'nais3-scenes.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return false
  const data = scenes.map((s) => ({
    name: s.name,
    prompt: s.prompt,
    negativePrompt: s.negative_prompt,
    width: s.width,
    height: s.height
  }))
  writeFileSync(result.filePath, JSON.stringify({ version: 1, scenes: data }, null, 2), 'utf-8')
  return true
}

export async function importScenesJson(presetId: number): Promise<number> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: '씬 불러오기',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return 0
  const parsed = JSON.parse(readFileSync(result.filePaths[0], 'utf-8')) as {
    scenes?: {
      name?: string
      prompt?: string
      /** NAIS2 씬 내보내기(JSON) 포맷의 프롬프트 필드명 */
      scenePrompt?: string
      negativePrompt?: string
      width?: number
      height?: number
    }[]
  }
  const scenes = parsed.scenes ?? []
  const db = getDb()
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM gen_scenes WHERE preset_id = ?')
    .get(presetId) as { m: number }
  let order = max.m
  const stmt = db.prepare(
    'INSERT INTO gen_scenes (preset_id, name, prompt, negative_prompt, width, height, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  db.transaction(() => {
    for (const s of scenes) {
      stmt.run(
        presetId,
        s.name ?? '씬',
        s.prompt ?? s.scenePrompt ?? '', // NAIS2 파일은 scenePrompt
        s.negativePrompt ?? '',
        s.width ?? 832,
        s.height ?? 1216,
        ++order
      )
    }
  })()
  return scenes.length
}

async function zipFiles(rows: { file_path: string }[], defaultName: string): Promise<number> {
  if (rows.length === 0) return 0
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win, {
    title: 'ZIP 내보내기',
    defaultPath: defaultName,
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) return 0
  const zip = new JSZip()
  const used = new Set<string>()
  for (const r of rows) {
    try {
      let name = basename(r.file_path)
      while (used.has(name)) name = `_${name}`
      used.add(name)
      zip.file(name, readFileSync(r.file_path))
    } catch {
      // 파일 없으면 건너뜀
    }
  }
  writeFileSync(result.filePath, await zip.generateAsync({ type: 'nodebuffer' }))
  return used.size
}

/** 즐겨찾기 이미지 또는 각 씬 최상단(최신) 이미지를 ZIP으로 */
export async function exportZip(mode: 'favorites' | 'sceneTop'): Promise<number> {
  const db = getDb()
  const rows =
    mode === 'favorites'
      ? (db.prepare('SELECT file_path FROM images WHERE favorite = 1 ORDER BY id DESC').all() as {
          file_path: string
        }[])
      : (db
          .prepare(
            `SELECT file_path FROM images WHERE id IN
             (SELECT MAX(id) FROM images WHERE scene_id IS NOT NULL GROUP BY scene_id)`
          )
          .all() as { file_path: string }[])
  return zipFiles(rows, mode === 'favorites' ? 'nais3-favorites.zip' : 'nais3-scenes.zip')
}

/** 선택한 씬들의 모든 이미지를 ZIP으로 */
export async function bulkExportZip(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const rows = getDb()
    .prepare(
      `SELECT file_path FROM images WHERE scene_id IN (${placeholders(ids.length)}) ORDER BY id DESC`
    )
    .all(...ids) as { file_path: string }[]
  return zipFiles(rows, 'nais3-scenes-selected.zip')
}

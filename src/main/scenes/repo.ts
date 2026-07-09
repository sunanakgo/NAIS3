import { BrowserWindow, dialog } from 'electron'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { basename, extname, isAbsolute, relative } from 'path'
import JSZip from 'jszip'
import type { Scene, SceneImage, ScenePreset } from '../../shared/types'
import { getDb } from '../db'
import { dropMemoryImage, isMemoryPath, libraryRoot } from '../images/storage'

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
    .prepare(
      'SELECT id, name, default_width AS defaultWidth, default_height AS defaultHeight FROM scene_presets ORDER BY sort_order, id'
    )
    .all() as ScenePreset[]
}

/** 프리셋의 새 씬 기본 해상도 설정 */
export function setPresetDefaultResolution(id: number, width: number, height: number): void {
  getDb()
    .prepare('UPDATE scene_presets SET default_width = ?, default_height = ? WHERE id = ?')
    .run(width, height, id)
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

/** 씬 프리셋 순서 변경 */
export function reorderPresets(ids: number[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE scene_presets SET sort_order = ? WHERE id = ?')
  db.transaction(() => {
    ids.forEach((id, i) => stmt.run(i, id))
  })()
}

/** 씬 저장 폴더 계층용 프리셋 이름 */
export function getPresetName(id: number): string | null {
  const r = getDb().prepare('SELECT name FROM scene_presets WHERE id = ?').get(id) as
    | { name: string }
    | undefined
  return r?.name ?? null
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
  // 프리셋 기본 해상도 적용 (미설정 시 832×1216)
  const preset = db
    .prepare('SELECT default_width AS w, default_height AS h FROM scene_presets WHERE id = ?')
    .get(presetId) as { w: number | null; h: number | null } | undefined
  return Number(
    db
      .prepare(
        'INSERT INTO gen_scenes (preset_id, name, width, height, sort_order) VALUES (?, ?, ?, ?, ?)'
      )
      .run(presetId, name, preset?.w ?? 832, preset?.h ?? 1216, max.m + 1).lastInsertRowid
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
  offset: number,
  favoritesOnly?: boolean
): { items: SceneImage[]; total: number } {
  const db = getDb()
  const fav = favoritesOnly ? ' AND favorite = 1' : ''
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM images WHERE scene_id = ?${fav}`)
      .get(sceneId) as { c: number }
  ).c
  const rows = db
    .prepare(
      `SELECT id, file_path, thumbnail, seed, favorite FROM images
       WHERE scene_id = ?${fav} ORDER BY id DESC LIMIT ? OFFSET ?`
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

/** 씬의 즐겨찾기 제외 전체 삭제 (파일 포함) — 반환: 삭제 수 (N5) */
export function deleteNonFavorites(sceneId: number): number {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, file_path FROM images WHERE scene_id = ? AND favorite = 0')
    .all(sceneId) as { id: number; file_path: string }[]
  db.prepare('DELETE FROM images WHERE scene_id = ? AND favorite = 0').run(sceneId)
  for (const r of rows) {
    try {
      unlinkSync(r.file_path)
    } catch {
      // 무시
    }
  }
  return rows.length
}

export function setImageFavorite(id: number, favorite: boolean): void {
  getDb()
    .prepare('UPDATE images SET favorite = ? WHERE id = ?')
    .run(favorite ? 1 : 0, id)
}

/** 히스토리 전체 비우기 — 모든 이미지 레코드+원본 파일 삭제 (씬 이미지 포함) */
/** 앱 내부 라이브러리(자동 저장 OFF 보관소) 파일만 실제 삭제 — 유저 저장 폴더 파일은 보존 */
function unlinkIfInternal(filePath: string): void {
  const rel = relative(libraryRoot(), filePath)
  if (rel.startsWith('..') || isAbsolute(rel)) return // 저장 폴더 파일 → 보존
  try {
    unlinkSync(filePath)
  } catch {
    // 무시
  }
}

/** 히스토리 전체 비우기 — 기록만 삭제, 파일 보존 (내부 라이브러리 파일은 정리) */
export function clearAllImages(): number {
  const db = getDb()
  const rows = db.prepare('SELECT file_path FROM images').all() as { file_path: string }[]
  db.prepare('DELETE FROM images').run()
  for (const r of rows) unlinkIfInternal(r.file_path)
  return rows.length
}

/**
 * 이미지 삭제.
 * - deleteFile=true: 파일까지 삭제 (씬 상세의 명시적 삭제)
 * - deleteFile=false: 기록만 삭제, 파일 보존 (히스토리 삭제 — 내부 라이브러리 파일만 정리)
 */
export function deleteImage(id: number, deleteFile: boolean): void {
  const db = getDb()
  const r = db.prepare('SELECT file_path FROM images WHERE id = ?').get(id) as
    | { file_path: string }
    | undefined
  db.prepare('DELETE FROM images WHERE id = ?').run(id)
  if (!r) return
  if (isMemoryPath(r.file_path)) {
    dropMemoryImage(r.file_path)
    return
  }
  if (deleteFile) {
    try {
      unlinkSync(r.file_path)
    } catch {
      // 무시
    }
  } else {
    unlinkIfInternal(r.file_path)
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

type ZipRow = { file_path: string; scene_name: string | null }

async function zipFiles(rows: ZipRow[], defaultName: string): Promise<number> {
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
  const counters = new Map<string, number>() // 씬별 연번
  for (const r of rows) {
    try {
      // 씬 이미지는 씬 이름_N 으로 (NAIS2 방식), 씬 없는 이미지는 원본 파일명
      let name: string
      if (r.scene_name) {
        const safe = r.scene_name.replace(/[/\\:*?"<>|]/g, '_').trim() || '씬'
        const n = (counters.get(safe) ?? 0) + 1
        counters.set(safe, n)
        name = `${safe}_${n}${extname(r.file_path) || '.png'}`
      } else {
        name = basename(r.file_path)
      }
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
      ? (db
          .prepare(
            `SELECT i.file_path, s.name AS scene_name FROM images i
             LEFT JOIN gen_scenes s ON s.id = i.scene_id
             WHERE i.favorite = 1 ORDER BY i.id DESC`
          )
          .all() as ZipRow[])
      : (db
          .prepare(
            `SELECT i.file_path, s.name AS scene_name FROM images i
             LEFT JOIN gen_scenes s ON s.id = i.scene_id
             WHERE i.id IN (SELECT MAX(id) FROM images WHERE scene_id IS NOT NULL GROUP BY scene_id)`
          )
          .all() as ZipRow[])
  return zipFiles(rows, mode === 'favorites' ? 'nais3-favorites.zip' : 'nais3-scenes.zip')
}

/** 선택한 씬들의 모든 이미지를 ZIP으로 */
export async function bulkExportZip(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const rows = getDb()
    .prepare(
      `SELECT i.file_path, s.name AS scene_name FROM images i
       LEFT JOIN gen_scenes s ON s.id = i.scene_id
       WHERE i.scene_id IN (${placeholders(ids.length)}) ORDER BY i.id DESC`
    )
    .all(...ids) as ZipRow[]
  return zipFiles(rows, 'nais3-scenes-selected.zip')
}

import { BrowserWindow, dialog } from 'electron'
import { readFileSync } from 'fs'
import sharp from 'sharp'
import type {
  CharacterCard,
  CharacterCardPatch,
  CharacterFolder,
  CharacterOrderEntry
} from '../../shared/types'
import { getDb } from '../db'
import { t } from '../i18n'

interface CharRow {
  id: number
  name: string
  prompt: string
  negative_prompt: string
  thumbnail: Buffer | null
  enabled: number
  center_x: number
  center_y: number
  folder_id: number | null
}

export function listCharacters(): { folders: CharacterFolder[]; items: CharacterCard[] } {
  const db = getDb()
  const folders = (
    db
      .prepare('SELECT id, name, collapsed, color FROM character_folders ORDER BY sort_order')
      .all() as {
      id: number
      name: string
      collapsed: number
      color: string | null
    }[]
  ).map((f) => ({ id: f.id, name: f.name, collapsed: f.collapsed === 1, color: f.color }))

  const items = (
    db
      .prepare(
        `SELECT id, name, prompt, negative_prompt, thumbnail, enabled, center_x, center_y, folder_id
         FROM character_prompts ORDER BY sort_order, id`
      )
      .all() as CharRow[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    negativePrompt: r.negative_prompt,
    thumbnail: r.thumbnail ? r.thumbnail.toString('base64') : '',
    enabled: r.enabled === 1,
    center: { x: r.center_x, y: r.center_y },
    folderId: r.folder_id
  }))

  return { folders, items }
}

export function createCharacter(name: string, folderId: number | null): number {
  const db = getDb()
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM character_prompts')
    .get() as {
    m: number
  }
  return Number(
    db
      .prepare('INSERT INTO character_prompts (name, folder_id, sort_order) VALUES (?, ?, ?)')
      .run(name, folderId, max.m + 1).lastInsertRowid
  )
}

export function updateCharacter(id: number, patch: CharacterCardPatch): void {
  const sets: string[] = []
  const values: unknown[] = []
  if (patch.name !== undefined) {
    sets.push('name = ?')
    values.push(patch.name)
  }
  if (patch.prompt !== undefined) {
    sets.push('prompt = ?')
    values.push(patch.prompt)
  }
  if (patch.negativePrompt !== undefined) {
    sets.push('negative_prompt = ?')
    values.push(patch.negativePrompt)
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?')
    values.push(patch.enabled ? 1 : 0)
  }
  if (patch.center !== undefined) {
    sets.push('center_x = ?', 'center_y = ?')
    values.push(patch.center.x, patch.center.y)
  }
  if (sets.length === 0) return
  sets.push(`updated_at = datetime('now')`)
  getDb()
    .prepare(`UPDATE character_prompts SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id)
}

export function deleteCharacter(id: number): void {
  getDb().prepare('DELETE FROM character_prompts WHERE id = ?').run(id)
}

/** 카드 복제 — 썸네일 포함, enabled는 꺼서 (실수로 6명 초과 방지) */
export function duplicateCharacter(id: number): number {
  const db = getDb()
  const max = (
    db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM character_prompts').get() as {
      m: number
    }
  ).m
  const info = db
    .prepare(
      `INSERT INTO character_prompts
         (name, prompt, negative_prompt, folder, thumbnail, settings_json, enabled, center_x, center_y, folder_id, sort_order)
       SELECT name || ?, prompt, negative_prompt, folder, thumbnail, settings_json, 0, center_x, center_y, folder_id, ?
       FROM character_prompts WHERE id = ?`
    )
    .run(` ${t('ui.copy')}`, max + 1, id)
  return Number(info.lastInsertRowid)
}

/**
 * 리스트 전체 순서 반영. 카드의 폴더 소속은 "직전에 나온 폴더 행"으로 파생된다
 * (첫 폴더 행보다 위의 카드 = 미분류). 트랜잭션으로 원자 적용.
 */
export function reorderCharacters(order: CharacterOrderEntry[]): void {
  const db = getDb()
  const setFolder = db.prepare('UPDATE character_folders SET sort_order = ? WHERE id = ?')
  const setChar = db.prepare(
    'UPDATE character_prompts SET sort_order = ?, folder_id = ? WHERE id = ?'
  )
  db.transaction(() => {
    let currentFolder: number | null = null
    order.forEach((entry, i) => {
      if (entry.type === 'folder') {
        currentFolder = entry.id
        setFolder.run(i, entry.id)
      } else {
        setChar.run(i, currentFolder, entry.id)
      }
    })
  })()
}

export function createFolder(name: string): number {
  const db = getDb()
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM character_folders')
    .get() as {
    m: number
  }
  return Number(
    db
      .prepare('INSERT INTO character_folders (name, sort_order) VALUES (?, ?)')
      .run(name, max.m + 1).lastInsertRowid
  )
}

export function renameFolder(id: number, name: string): void {
  getDb().prepare('UPDATE character_folders SET name = ? WHERE id = ?').run(name, id)
}

export function setFolderCollapsed(id: number, collapsed: boolean): void {
  getDb()
    .prepare('UPDATE character_folders SET collapsed = ? WHERE id = ?')
    .run(collapsed ? 1 : 0, id)
}

export function setFolderColor(id: number, color: string | null): void {
  getDb().prepare('UPDATE character_folders SET color = ? WHERE id = ?').run(color, id)
}

export function deleteFolder(id: number): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('UPDATE character_prompts SET folder_id = NULL WHERE folder_id = ?').run(id)
    db.prepare('DELETE FROM character_folders WHERE id = ?').run(id)
  })()
}

/** 파일 선택 → 192px webp 썸네일로 저장. 취소하면 null */
export async function pickCharacterThumbnail(id: number): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: t('ui.chooseCharacterImage'),
    properties: ['openFile'],
    filters: [{ name: t('ui.image'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const thumbnail = await sharp(readFileSync(result.filePaths[0]))
    .resize(192, 192, { fit: 'cover' })
    .webp({ quality: 82 })
    .toBuffer()

  getDb()
    .prepare(
      `UPDATE character_prompts SET thumbnail = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(thumbnail, id)
  return thumbnail.toString('base64')
}

/** 캐릭터 썸네일 제거 (F12) */
export function clearCharacterThumbnail(id: number): void {
  getDb()
    .prepare(
      `UPDATE character_prompts SET thumbnail = NULL, updated_at = datetime('now') WHERE id = ?`
    )
    .run(id)
}

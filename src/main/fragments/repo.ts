import { BrowserWindow, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'
import JSZip from 'jszip'
import type { CharacterOrderEntry, Fragment, ListFolder } from '../../shared/types'
import { getDb } from '../db'
import type { FragmentSource } from './processor'

interface Row {
  id: number
  name: string
  content: string
  folder_id: number | null
}

export function listFragments(): { folders: ListFolder[]; items: Fragment[] } {
  const db = getDb()
  const folders = (
    db
      .prepare('SELECT id, name, collapsed, color FROM fragment_folders ORDER BY sort_order')
      .all() as {
      id: number
      name: string
      collapsed: number
      color: string | null
    }[]
  ).map((f) => ({ id: f.id, name: f.name, collapsed: f.collapsed === 1, color: f.color }))

  const items = (
    db
      .prepare('SELECT id, name, content, folder_id FROM fragments ORDER BY sort_order, id')
      .all() as Row[]
  ).map((r) => ({ id: r.id, name: r.name, content: r.content, folderId: r.folder_id }))

  return { folders, items }
}

export function createFragment(name: string, folderId: number | null, content = ''): number {
  const db = getDb()
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM fragments').get() as {
    m: number
  }
  return Number(
    db
      .prepare('INSERT INTO fragments (name, content, folder_id, sort_order) VALUES (?, ?, ?, ?)')
      .run(uniqueName(name), content, folderId, max.m + 1).lastInsertRowid
  )
}

/** name UNIQUE 제약 — 중복이면 name-2, name-3... */
function uniqueName(name: string): string {
  const db = getDb()
  const exists = (n: string): boolean =>
    db.prepare('SELECT 1 FROM fragments WHERE name = ?').get(n) !== undefined
  if (!exists(name)) return name
  for (let i = 2; ; i++) {
    if (!exists(`${name}-${i}`)) return `${name}-${i}`
  }
}

/** 자기 자신 제외 유니크 — 이름 편집 중 다른 조각과 겹쳐도 UNIQUE 에러로 유실되지 않게 */
function uniqueNameExcept(name: string, selfId: number): string {
  const db = getDb()
  const exists = (n: string): boolean =>
    db.prepare('SELECT 1 FROM fragments WHERE name = ? AND id != ?').get(n, selfId) !== undefined
  if (!exists(name)) return name
  for (let i = 2; ; i++) {
    if (!exists(`${name}-${i}`)) return `${name}-${i}`
  }
}

export function updateFragment(id: number, patch: { name?: string; content?: string }): void {
  const sets: string[] = []
  const values: unknown[] = []
  if (patch.name !== undefined) {
    sets.push('name = ?')
    // 타이핑 중간값이 다른 조각 이름과 겹치면 UNIQUE 에러로 업데이트가 유실되던 버그 방지
    values.push(uniqueNameExcept(patch.name, id))
  }
  if (patch.content !== undefined) {
    sets.push('content = ?')
    values.push(patch.content)
  }
  if (sets.length === 0) return
  sets.push(`updated_at = datetime('now')`)
  getDb()
    .prepare(`UPDATE fragments SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id)
}

export function deleteFragment(id: number): void {
  getDb().prepare('DELETE FROM fragments WHERE id = ?').run(id)
}

/** 조각 복제 (이름 중복은 uniqueName이 -2 등으로 처리) */
export function duplicateFragment(id: number): number | null {
  const r = getDb()
    .prepare('SELECT name, content, folder_id FROM fragments WHERE id = ?')
    .get(id) as { name: string; content: string; folder_id: number | null } | undefined
  if (!r) return null
  return createFragment(`${r.name} 복사`, r.folder_id, r.content)
}

export function reorderFragments(order: CharacterOrderEntry[]): void {
  const db = getDb()
  const setFolder = db.prepare('UPDATE fragment_folders SET sort_order = ? WHERE id = ?')
  const setItem = db.prepare('UPDATE fragments SET sort_order = ?, folder_id = ? WHERE id = ?')
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

export function createFragmentFolder(name: string): number {
  const db = getDb()
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM fragment_folders').get() as {
    m: number
  }
  return Number(
    db.prepare('INSERT INTO fragment_folders (name, sort_order) VALUES (?, ?)').run(name, max.m + 1)
      .lastInsertRowid
  )
}

export function renameFragmentFolder(id: number, name: string): void {
  getDb().prepare('UPDATE fragment_folders SET name = ? WHERE id = ?').run(name, id)
}

export function setFragmentFolderCollapsed(id: number, collapsed: boolean): void {
  getDb()
    .prepare('UPDATE fragment_folders SET collapsed = ? WHERE id = ?')
    .run(collapsed ? 1 : 0, id)
}

export function setFragmentFolderColor(id: number, color: string | null): void {
  getDb().prepare('UPDATE fragment_folders SET color = ? WHERE id = ?').run(color, id)
}

export function deleteFragmentFolder(id: number): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('UPDATE fragments SET folder_id = NULL WHERE folder_id = ?').run(id)
    db.prepare('DELETE FROM fragment_folders WHERE id = ?').run(id)
  })()
}

/** content → 치환용 줄 목록. #로 시작하는 줄만 주석(NAIS2·프롬프트와 동일 규칙), 빈 줄 제외 */
export function contentToLines(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

/** 치환기에 물릴 조회 소스 — 생성 시점마다 DB에서 신선하게 읽는다 */
export function fragmentSource(): FragmentSource {
  const { folders, items } = listFragments()
  const folderName = new Map(folders.map((f) => [f.id, f.name]))
  const byPath = new Map<string, string[]>()
  for (const f of items) {
    const lines = contentToLines(f.content)
    // 참조 측(normalizePath)과 동일하게 trim — 이름/폴더에 공백이 섞여도 <이름>과 매칭되게
    byPath.set(f.name.trim().toLowerCase(), lines)
    const folder = f.folderId != null ? folderName.get(f.folderId) : null
    if (folder) byPath.set(`${folder.trim()}/${f.name.trim()}`.toLowerCase(), lines)
  }
  return { getLines: (path) => byPath.get(path) ?? null }
}

/** txt/zip 가져오기 (다중 선택). txt=파일명이 조각 이름, zip=안의 txt들을 일괄 가져오기 */
export async function importTxtFragments(): Promise<number> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: '조각 TXT 가져오기',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '텍스트/ZIP', extensions: ['txt', 'zip'] }]
  })
  if (result.canceled) return 0
  let count = 0
  for (const filePath of result.filePaths) {
    if (filePath.toLowerCase().endsWith('.zip')) {
      const zip = await JSZip.loadAsync(readFileSync(filePath))
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || !entry.name.toLowerCase().endsWith('.txt')) continue
        createFragment(basename(entry.name, '.txt'), null, await entry.async('string'))
        count++
      }
    } else {
      createFragment(basename(filePath, '.txt'), null, readFileSync(filePath, 'utf-8'))
      count++
    }
  }
  return count
}

/** 조각 전체를 ZIP(각 조각 = name.txt)으로 내보내기 — 공유/백업용 */
export async function exportAllFragmentsZip(): Promise<number> {
  const rows = getDb()
    .prepare('SELECT name, content FROM fragments ORDER BY sort_order, id')
    .all() as { name: string; content: string }[]
  if (!rows.length) return 0
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win, {
    title: '조각 전체 내보내기',
    defaultPath: 'nais3-fragments.zip',
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) return 0
  const zip = new JSZip()
  const used = new Map<string, number>()
  for (const r of rows) {
    let safe = r.name.replace(/[/\\:*?"<>|]/g, '_') || 'fragment'
    const n = used.get(safe) ?? 0
    used.set(safe, n + 1)
    zip.file(`${n > 0 ? `${safe}-${n}` : safe}.txt`, r.content)
  }
  writeFileSync(result.filePath, await zip.generateAsync({ type: 'nodebuffer' }))
  return rows.length
}

export async function exportTxtFragment(id: number): Promise<boolean> {
  const row = getDb().prepare('SELECT name, content FROM fragments WHERE id = ?').get(id) as
    | { name: string; content: string }
    | undefined
  if (!row) return false
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win, {
    title: '조각 내보내기',
    // Windows 금지 문자 제거 (이름은 사용자 입력)
    defaultPath: `${row.name.replace(/[/\\:*?"<>|]/g, '_') || 'fragment'}.txt`,
    filters: [{ name: '텍스트', extensions: ['txt'] }]
  })
  if (result.canceled || !result.filePath) return false
  writeFileSync(result.filePath, row.content, 'utf-8')
  return true
}

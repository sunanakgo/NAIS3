import type { CharacterOrderEntry, ListFolder } from '@shared/types'

/**
 * 캐릭터/조각 공용 "폴더 리스트" 모델의 순수 로직.
 * - 정규 순서: [폴더1, 폴더1 아이템..., 폴더2, ..., (미분류 구분선), 미분류 아이템...]
 *   폴더 섹션이 맨 위 — 미분류 카드가 수백 개여도 폴더 접근이 쉬움.
 * - 아이템의 폴더 소속은 "직전 폴더 행"에서 파생. 미분류 구분선이 소속을 리셋하므로
 *   구분선 아래 = 미분류로 모호함이 없다.
 * - 폴더 이동 시 소속 아이템이 블록으로 함께 이동한다
 */

export interface FolderListItem {
  id: number
  folderId: number | null
}

export type DisplayRow<T extends FolderListItem> =
  | { type: 'folder'; folder: ListFolder }
  | { type: 'item'; item: T; hidden: boolean }
  | { type: 'divider' } // 폴더 섹션과 미분류 섹션의 경계 (폴더가 있을 때만)

export const DIVIDER_KEY = 'divider'

export function rowKey<T extends FolderListItem>(row: DisplayRow<T>): string {
  if (row.type === 'divider') return DIVIDER_KEY
  return row.type === 'folder' ? `f-${row.folder.id}` : `i-${row.item.id}`
}

export function canonicalize<T extends FolderListItem>(folders: ListFolder[], items: T[]): T[] {
  const roots = items.filter((c) => c.folderId == null)
  return [...folders.flatMap((f) => items.filter((c) => c.folderId === f.id)), ...roots]
}

export function buildDisplayRows<T extends FolderListItem>(
  folders: ListFolder[],
  items: T[]
): DisplayRow<T>[] {
  const rows: DisplayRow<T>[] = []
  for (const folder of folders) {
    rows.push({ type: 'folder', folder })
    for (const item of items.filter((c) => c.folderId === folder.id)) {
      rows.push({ type: 'item', item, hidden: folder.collapsed })
    }
  }
  // 폴더가 있으면 미분류 경계 표시 (여기로 드롭 = 폴더에서 빼기)
  if (folders.length > 0) rows.push({ type: 'divider' })
  for (const item of items.filter((c) => c.folderId == null)) {
    rows.push({ type: 'item', item, hidden: false })
  }
  return rows
}

interface Block<T extends FolderListItem> {
  folder: ListFolder | null // null = 미분류 단일 아이템 블록
  items: T[]
}

function toBlocks<T extends FolderListItem>(folders: ListFolder[], items: T[]): Block<T>[] {
  const blocks: Block<T>[] = folders.map((folder) => ({
    folder,
    items: items.filter((c) => c.folderId === folder.id)
  }))
  for (const item of items.filter((c) => c.folderId == null)) {
    blocks.push({ folder: null, items: [item] })
  }
  return blocks
}

function fromBlocks<T extends FolderListItem>(
  blocks: Block<T>[]
): { folders: ListFolder[]; items: T[] } {
  const folders: ListFolder[] = []
  const items: T[] = []
  for (const block of blocks) {
    if (block.folder) {
      folders.push(block.folder)
      for (const item of block.items) items.push({ ...item, folderId: block.folder.id })
    } else {
      for (const item of block.items) items.push({ ...item, folderId: null })
    }
  }
  return { folders, items }
}

/**
 * 드래그 결과 반영. activeKey/overKey는 rowKey 형식 ("f-1" | "i-3" | "divider").
 * - 아이템 이동: 도착 위치의 폴더 문맥으로 소속 변경 (구분선 아래 = 미분류)
 * - 폴더 이동: 소속 아이템이 블록째 함께 이동, 미분류 섹션 아래로는 스냅
 */
export function moveRow<T extends FolderListItem>(
  folders: ListFolder[],
  items: T[],
  activeKey: string,
  overKey: string
): { folders: ListFolder[]; items: T[] } {
  if (activeKey === overKey || activeKey === DIVIDER_KEY) return { folders, items }
  const [activeKind, activeIdStr] = activeKey.split('-')
  const activeId = Number(activeIdStr)

  if (activeKind === 'f') {
    // 폴더 블록 이동 — 폴더 블록들 사이로만
    const blocks = toBlocks(folders, items)
    const fromIdx = blocks.findIndex((b) => b.folder?.id === activeId)
    if (fromIdx < 0) return { folders, items }
    const [block] = blocks.splice(fromIdx, 1)

    let toIdx: number
    if (overKey === DIVIDER_KEY) {
      toIdx = blocks.filter((b) => b.folder).length // 폴더 섹션 끝
    } else {
      const [overKind, overIdStr] = overKey.split('-')
      const overId = Number(overIdStr)
      toIdx = blocks.findIndex((b) =>
        overKind === 'f' ? b.folder?.id === overId : b.items.some((i) => i.id === overId)
      )
      if (toIdx < 0) toIdx = blocks.length
      else if (toIdx >= fromIdx) toIdx += 1 // 아래로 이동 시 대상 블록 뒤에
    }
    // 미분류 블록들 아래로 내려가지 않게 폴더 섹션 범위로 스냅
    toIdx = Math.min(toIdx, blocks.filter((b) => b.folder).length)
    blocks.splice(toIdx, 0, block)
    return fromBlocks(blocks)
  }

  // 아이템 이동 — 전체 행 기준으로 위치 재계산
  const rows = buildDisplayRows(folders, items)
  const fromIdx = rows.findIndex((r) => rowKey(r) === activeKey)
  if (fromIdx < 0) return { folders, items }
  const [row] = rows.splice(fromIdx, 1)
  if (row.type !== 'item') return { folders, items }

  let toIdx = rows.findIndex((r) => rowKey(r) === overKey)
  if (toIdx < 0) return { folders, items }
  if (toIdx >= fromIdx) toIdx += 1
  rows.splice(Math.min(toIdx, rows.length), 0, row)

  // 행 순서에서 folders/items 재구성 (소속은 직전 폴더에서 파생, 구분선이 리셋)
  const nextFolders: ListFolder[] = []
  const nextItems: T[] = []
  let currentFolder: number | null = null
  for (const r of rows) {
    if (r.type === 'folder') {
      nextFolders.push(r.folder)
      currentFolder = r.folder.id
    } else if (r.type === 'divider') {
      currentFolder = null
    } else {
      nextItems.push({ ...r.item, folderId: currentFolder })
    }
  }
  return { folders: nextFolders, items: nextItems }
}

/** DB 반영용 전체 순서 */
export function toOrderEntries<T extends FolderListItem>(
  folders: ListFolder[],
  items: T[]
): CharacterOrderEntry[] {
  const order: CharacterOrderEntry[] = []
  for (const f of folders) {
    order.push({ type: 'folder', id: f.id })
    for (const c of items.filter((c) => c.folderId === f.id)) order.push({ type: 'char', id: c.id })
  }
  for (const c of items.filter((c) => c.folderId == null)) order.push({ type: 'char', id: c.id })
  return order
}

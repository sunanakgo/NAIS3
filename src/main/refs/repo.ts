import { app, BrowserWindow } from 'electron'
import { showOpenDialog } from '../dialogs'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, extname, isAbsolute, join } from 'path'
import { randomUUID } from 'crypto'
import sharp from '../sharp'
import type {
  CharacterOrderEntry,
  CharRefItem,
  ListFolder,
  MetadataVibe,
  VibeItem
} from '../../shared/types'
import { putVibeEncoding, vibeEncodingEntries, vibeEncodingModels } from './vibe-encoding-cache'
import { getDb } from '../db'
import { getMemoryImage, isMemoryPath, isUnderImagesRoot } from '../images/storage'
import { t } from '../i18n'

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

/**
 * 이미지 메타데이터에서 복원한 바이브의 "원본 파일". 원본 이미지가 없으므로 file_path에는
 * 인코딩 캐시(encoded 컬럼과 같은 형식)를 담은 파일을 둔다 — 백업/복제/삭제가 다른 바이브와
 * 똑같이 파일을 다루고, 확장자로 재인코딩 불가 항목을 구분한다.
 */
export const ENCODED_VIBE_EXTENSION = '.nais3vibe'
/** 메타데이터에 information extracted가 없을 때 (NAI 기본값) */
const METADATA_VIBE_DEFAULT_IE = 1

export function isEncodedOnlyVibe(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ENCODED_VIBE_EXTENSION
}

/** 인코딩 전용 바이브 파일의 캐시 문자열 (없거나 못 읽으면 null) */
export function readEncodedVibeFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
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
      `SELECT id, name, file_path, thumbnail, enabled, strength, info_extracted, encoded, encoded_ie,
              folder_id
       FROM vibe_images ORDER BY sort_order, id`
    )
    .all() as {
    id: number
    name: string
    file_path: string
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
      encodedReady: vibeEncodingModels(r.encoded, r.encoded_ie, r.info_extracted).length > 0,
      encodedModels: vibeEncodingModels(r.encoded, r.encoded_ie, r.info_extracted),
      ...(isEncodedOnlyVibe(r.file_path) ? { encodedOnly: true } : {}),
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

/** 레퍼런스로 받는 이미지 형식 — sharp가 실제 내용으로 판별한 포맷 → 저장 확장자 */
const REF_IMAGE_FORMATS: Record<string, string> = { png: '.png', jpeg: '.jpg', webp: '.webp' }
const REF_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
/** 앱 안 경로로 받는 원본 크기 상한 — 생성 이미지는 수 MB 수준 */
const MAX_REF_IMAGE_BYTES = 64 * 1024 * 1024

export interface RefImageSource {
  /** 표시 이름 (확장자 없이) */
  name: string
  /** 원본 바이트 — 한 장씩 처리하도록 지연 로드 (읽을 수 없으면 null) */
  load: () => Buffer | null
}

/**
 * 원본 버퍼들 → refs/에 저장 + 썸네일 생성 + 행 삽입 (다이얼로그·경로·드롭 공용).
 * 내용이 PNG/JPEG/WebP가 아니거나 디코딩에 실패한 항목은 건너뛰고, 추가된 개수를 반환한다.
 */
export async function insertRefImages(
  kind: Kind,
  folderId: number | null,
  sources: RefImageSource[]
): Promise<number> {
  const db = getDb()
  const table = TABLES[kind].items
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${table}`).get() as {
    m: number
  }
  let order = max.m
  let count = 0

  for (const { name, load } of sources) {
    let buf: Buffer | null
    let ext: string | undefined
    let thumbnail: Buffer
    try {
      buf = load()
      if (!buf) continue
      ext = REF_IMAGE_FORMATS[(await sharp(buf).metadata()).format ?? '']
      if (!ext) continue
      thumbnail = await sharp(buf)
        .resize(192, 192, { fit: 'cover' })
        .webp({ quality: 82 })
        .toBuffer()
    } catch {
      continue
    }
    // 파일과 행은 한 쌍 — 어느 쪽이 실패해도 그 항목만 실패로 세고, 방금 쓴 파일은 치운다.
    // 썸네일을 만드는 사이 폴더가 지워졌을 수 있어 폴더는 넣기 직전에 다시 확인한다
    const dest = join(refsDir(), `${randomUUID()}${ext}`)
    try {
      writeFileSync(dest, buf)
      db.prepare(
        `INSERT INTO ${table} (name, file_path, thumbnail, folder_id, sort_order, enabled)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).run(name, dest, thumbnail, existingFolderId(kind, folderId), order + 1)
    } catch {
      rmSync(dest, { force: true })
      continue
    }
    order++
    count++
  }
  return count
}

/** 파일 다이얼로그(다중 선택) → refs/로 복사 + 썸네일 생성 + 행 삽입 */
export async function addRefImages(kind: Kind, folderId: number | null): Promise<number> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await showOpenDialog(win, {
    title: kind === 'vibe' ? t('ui.addVibeImages') : t('ui.addReferenceImages'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: t('ui.image'), extensions: REF_IMAGE_EXTENSIONS }]
  })
  if (result.canceled) return 0
  return insertRefImages(
    kind,
    folderId,
    result.filePaths.map((src) => ({
      name: basename(src, extname(src)),
      load: () => readFileSync(src)
    }))
  )
}

/**
 * 앱 안의 이미지(히스토리·라이브러리·씬 — 경로) 또는 외부 드롭(base64)으로 추가.
 * 렌더러가 준 경로는 저장 폴더/라이브러리 안이거나 메모리 이미지일 때만 읽는다.
 */
export async function addRefImagesFrom(
  kind: Kind,
  folderId: number | null,
  filePaths: string[],
  images: { name: string; base64: string }[]
): Promise<{ count: number; failed: number }> {
  const sources: RefImageSource[] = [
    ...(Array.isArray(filePaths) ? filePaths : []).map((filePath) => ({
      name: refNameFromPath(filePath),
      load: () => readAllowedImage(filePath)
    })),
    ...(Array.isArray(images) ? images : []).map((image) => {
      const name = typeof image?.name === 'string' ? image.name : ''
      return {
        name: basename(name, extname(name)),
        load: () =>
          typeof image?.base64 === 'string' && image.base64.length > 0
            ? Buffer.from(image.base64.replace(/^data:[^,]+,/, ''), 'base64')
            : null
      }
    })
  ]
  const count = await insertRefImages(kind, folderId, sources)
  return { count, failed: sources.length - count }
}

/** 렌더러가 준 폴더 id — 실제로 있는 폴더일 때만 사용, 아니면 미분류 */
function existingFolderId(kind: Kind, folderId: unknown): number | null {
  if (typeof folderId !== 'number' || !Number.isInteger(folderId)) return null
  const row = getDb().prepare(`SELECT id FROM ${TABLES[kind].folders} WHERE id = ?`).get(folderId)
  return row ? folderId : null
}

function readAllowedImage(filePath: unknown): Buffer | null {
  if (typeof filePath !== 'string' || filePath.length === 0) return null
  if (isMemoryPath(filePath)) return getMemoryImage(filePath)
  if (!isAbsolute(filePath) || !isUnderImagesRoot(filePath)) return null
  if (!REF_IMAGE_EXTENSIONS.includes(extname(filePath).slice(1).toLowerCase())) return null
  try {
    const stat = statSync(filePath)
    return stat.isFile() && stat.size <= MAX_REF_IMAGE_BYTES ? readFileSync(filePath) : null
  } catch {
    return null
  }
}

function refNameFromPath(filePath: unknown): string {
  if (typeof filePath !== 'string' || isMemoryPath(filePath)) return ''
  return basename(filePath, extname(filePath))
}

/**
 * 메타데이터 바이브 적용 — 메타 재현이므로 켜진 바이브를 모두 끄고 이 바이브들만 켠다.
 * 같은 인코딩을 이미 가진 라이브러리 항목(원본 이미지가 있는 바이브 포함)은 새로 만들지 않고
 * 재사용하며, 인코딩 당시 IE로 맞춘다. 나머지는 인코딩 전용 항목으로 새로 만든다.
 */
export function importMetadataVibes(
  vibes: MetadataVibe[],
  model: string,
  thumbnail: Buffer | null
): { ids: number[]; created: number; reused: number } {
  const usable = vibes.flatMap((vibe) =>
    typeof vibe?.encoded === 'string' && vibe.encoded.length > 0
      ? [
          {
            encoded: vibe.encoded,
            strength: Number.isFinite(vibe.strength)
              ? Math.min(1, Math.max(0, vibe.strength))
              : 0.6,
            ie:
              typeof vibe.informationExtracted === 'number' &&
              Number.isFinite(vibe.informationExtracted)
                ? Math.min(1, Math.max(0, vibe.informationExtracted))
                : METADATA_VIBE_DEFAULT_IE
          }
        ]
      : []
  )
  if (usable.length === 0 || !model) return { ids: [], created: 0, reused: 0 }

  const db = getDb()
  // 같은 인코딩을 가진 항목이 여럿일 수 있다 — 메타데이터에 같은 바이브가 두 번 있으면 차례로 재사용
  const known = new Map<string, { id: number; ie: number }[]>()
  const rows = db
    .prepare(
      'SELECT id, encoded, encoded_ie FROM vibe_images WHERE encoded IS NOT NULL ORDER BY sort_order, id'
    )
    .all() as { id: number; encoded: string; encoded_ie: number | null }[]
  for (const row of rows) {
    for (const entry of vibeEncodingEntries(row.encoded, row.encoded_ie)) {
      const candidates = known.get(entry.data) ?? []
      if (!candidates.some((c) => c.id === row.id)) candidates.push({ id: row.id, ie: entry.ie })
      known.set(entry.data, candidates)
    }
  }

  const ids: number[] = []
  const written: string[] = []
  let created = 0
  let reused = 0
  try {
    db.transaction(() => {
      db.prepare('UPDATE vibe_images SET enabled = 0 WHERE enabled = 1').run()
      const reuse = db.prepare(
        'UPDATE vibe_images SET enabled = 1, strength = ?, info_extracted = ? WHERE id = ?'
      )
      const insert = db.prepare(
        `INSERT INTO vibe_images
           (name, file_path, thumbnail, enabled, strength, info_extracted, encoded, encoded_ie,
            folder_id, sort_order)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, NULL, ?)`
      )
      let order = (
        db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM vibe_images').get() as {
          m: number
        }
      ).m
      usable.forEach((vibe, index) => {
        const match = known.get(vibe.encoded)?.find((c) => !ids.includes(c.id))
        if (match) {
          reuse.run(vibe.strength, match.ie, match.id)
          ids.push(match.id)
          reused++
          return
        }
        const packed = putVibeEncoding(null, null, model, vibe.ie, vibe.encoded)
        const filePath = join(refsDir(), `${randomUUID()}${ENCODED_VIBE_EXTENSION}`)
        writeFileSync(filePath, packed, { flag: 'wx' })
        written.push(filePath)
        const info = insert.run(
          t('ui.metadataVibeValue', index + 1),
          filePath,
          thumbnail,
          vibe.strength,
          vibe.ie,
          packed,
          vibe.ie,
          ++order
        )
        ids.push(Number(info.lastInsertRowid))
        created++
      })
    })()
  } catch (error) {
    for (const filePath of written) rmSync(filePath, { force: true })
    throw error
  }
  return { ids, created, reused }
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
  // 인코딩만 있는 바이브는 저장된 IE로 고정 — 원본이 없어 다른 값으로 다시 인코딩할 수 없다
  const lockedInfo =
    kind === 'vibe' &&
    patch.infoExtracted !== undefined &&
    isEncodedOnlyVibe(
      (
        getDb().prepare('SELECT file_path FROM vibe_images WHERE id = ?').get(id) as
          { file_path: string } | undefined
      )?.file_path ?? ''
    )
  for (const [key, column] of Object.entries(fields)) {
    if (patch[key] === undefined || (lockedInfo && key === 'infoExtracted')) continue
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

/** id 목록으로 조회 (출연 예약 — enabled 무시). 입력 순서 유지 */
export function vibeRowsByIds(ids: number[]): ReturnType<typeof enabledVibeRows> {
  if (ids.length === 0) return []
  const rows = (
    getDb()
      .prepare(
        `SELECT id, file_path, strength, info_extracted, encoded, encoded_ie
         FROM vibe_images WHERE id IN (${ids.map(() => '?').join(',')})`
      )
      .all(...ids) as {
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
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.flatMap((id) => byId.get(id) ?? [])
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

/** id 목록으로 조회 (출연 예약 — enabled 무시). 입력 순서 유지 */
export function charRefRowsByIds(ids: number[]): ReturnType<typeof enabledCharRefRows> {
  if (ids.length === 0) return []
  const rows = getDb()
    .prepare(
      `SELECT id, file_path, ref_type, strength, fidelity
       FROM charref_images WHERE id IN (${ids.map(() => '?').join(',')})`
    )
    .all(...ids) as {
    id: number
    file_path: string
    ref_type: string
    strength: number
    fidelity: number
  }[]
  const mapped = rows.map((r) => ({
    filePath: r.file_path,
    refType: r.ref_type,
    strength: r.strength,
    fidelity: r.fidelity,
    id: r.id
  }))
  const byId = new Map(mapped.map((r) => [r.id, r]))
  return ids.flatMap((id) => {
    const row = byId.get(id)
    return row
      ? [
          {
            filePath: row.filePath,
            refType: row.refType,
            strength: row.strength,
            fidelity: row.fidelity
          }
        ]
      : []
  })
}

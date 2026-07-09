import { randomUUID } from 'crypto'
import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { isAbsolute, join, relative } from 'path'
import sharp from 'sharp'
import type { DirectorMethod, ImageMetadata } from '../../shared/types'
import { getDb } from '../db'
import { getSetting } from '../db/settings'

/**
 * 생성 이미지 저장 규칙 (P3의 핵심):
 * - 원본 PNG는 디스크 파일로만. base64를 어디에도 상주시키지 않는다.
 * - DB에는 경로·시드·전송 payload 원본·소형 썸네일(webp BLOB)만.
 */

export interface SavedImage {
  id: number
  filePath: string
}

/** 기본 저장 폴더 (설정 미지정 시) */
export function defaultImagesRoot(): string {
  return join(app.getPath('pictures'), 'NAIS3')
}

/**
 * 메인 모드 저장 폴더.
 * - 미지정: 기본폴더/NAIS3_output
 * - 지정(save_dir): 그 폴더에 바로 쌓임 (하위 폴더 자동 생성 없음 — 유저가 고른 곳 그대로)
 */
export function imagesRoot(): string {
  const custom = getSetting('save_dir')
  return custom && custom.trim() ? custom : join(defaultImagesRoot(), 'NAIS3_output')
}

/** 씬 모드 저장 루트 — 미지정이면 기본폴더/NAIS3_scene, 지정(scene_save_dir)이면 그 폴더 */
export function scenesRoot(): string {
  const custom = getSetting('scene_save_dir')
  return custom && custom.trim() ? custom : join(defaultImagesRoot(), 'NAIS3_scene')
}

/** 앱 내부 라이브러리 폴더 — 자동 저장 OFF일 때 저장 위치 (히스토리엔 남지만 저장 폴더엔 안 감) */
export function libraryRoot(): string {
  return join(app.getPath('userData'), 'library')
}

/** 씬 이미지 폴더 경로 — 씬루트/<프리셋>/<씬 이름>/ (저장·폴더 열기 공용) */
export function sceneDir(presetName: string | null, sceneName: string, sceneId?: number): string {
  const safe = (s: string): string => s.replace(/[/\\:*?"<>|]/g, '_').trim()
  return join(scenesRoot(), safe(presetName ?? '') || '기본', safe(sceneName) || `씬-${sceneId}`)
}

/**
 * 프로토콜/파일 접근 허용 판정. 저장 폴더를 바꿔도 예전 이미지가 계속 보이도록
 * 현재/기본 저장 폴더와 내부 라이브러리 폴더를 모두 허용한다.
 */
/** parent 디렉터리 안의 경로인지 — path.relative 기반 (Windows 대소문자·구분자·접두 충돌 안전) */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function isUnderImagesRoot(filePath: string): boolean {
  return (
    isInside(imagesRoot(), filePath) ||
    isInside(scenesRoot(), filePath) ||
    isInside(defaultImagesRoot(), filePath) ||
    isInside(libraryRoot(), filePath)
  )
}

// ── 자동저장 OFF 임시 이미지 (NAIS2 방식) ──────────────────────
// 원본은 디스크에 안 쓰고 메모리 링버퍼(최근 N장)에만 보관. DB에는 썸네일 행만 남아
// 히스토리에 보이고, 경로는 memory:// 마커. 재시작하면 원본은 사라지고 썸네일로 폴백.

export const MEMORY_PREFIX = 'memory://'
const EPHEMERAL_KEEP = 20
const memoryImages = new Map<string, Buffer>()

export function isMemoryPath(filePath: string): boolean {
  return filePath.startsWith(MEMORY_PREFIX)
}

export function getMemoryImage(filePath: string): Buffer | null {
  return memoryImages.get(filePath) ?? null
}

export function dropMemoryImage(filePath: string): void {
  memoryImages.delete(filePath)
}

/** 원본이 만료됐을 때의 표시 폴백 — DB 썸네일(webp) */
export function thumbnailByPath(filePath: string): Buffer | null {
  const row = getDb().prepare('SELECT thumbnail FROM images WHERE file_path = ?').get(filePath) as
    | { thumbnail: Buffer | null }
    | undefined
  return row?.thumbnail ?? null
}

/** 자동저장 OFF 메인 생성 저장 — 파일 없이 메모리 + 썸네일 행. 최근 N장 초과분은 행·버퍼 정리 */
export async function saveEphemeralImage(input: {
  png: Buffer
  sentPayload: string
  seed: number
  kind: 't2i' | 'i2i' | 'inpaint'
  format?: 'png' | 'webp'
  localMetadata?: Pick<ImageMetadata, 'promptParts'>
}): Promise<SavedImage> {
  const ext = input.format ?? 'png'
  const filePath = `${MEMORY_PREFIX}${randomUUID()}.${ext}`
  // 메타데이터 주입본을 캐시에 — "다른 이름으로 저장" 구제 시 파일 저장본과 동일해지게
  const buffer =
    ext === 'png' && input.localMetadata
      ? injectNais3Params(input.png, input.localMetadata)
      : input.png
  memoryImages.set(filePath, buffer)

  const thumbnail = await sharp(input.png)
    .resize(640, 640, { fit: 'inside' })
    .webp({ quality: 90 })
    .toBuffer()
  const db = getDb()
  const result = db
    .prepare(
      'INSERT INTO images (file_path, thumbnail, kind, seed, payload_json, scene_id) VALUES (?, ?, ?, ?, ?, NULL)'
    )
    .run(
      filePath,
      thumbnail,
      input.kind,
      input.seed,
      payloadWithLocalMetadata(input.sentPayload, input.localMetadata)
    )

  const stale = db
    .prepare(
      `SELECT id, file_path FROM images WHERE file_path LIKE '${MEMORY_PREFIX}%'
       ORDER BY id DESC LIMIT -1 OFFSET ?`
    )
    .all(EPHEMERAL_KEEP) as { id: number; file_path: string }[]
  if (stale.length > 0) {
    for (const s of stale) memoryImages.delete(s.file_path)
    db.prepare(`DELETE FROM images WHERE id IN (${stale.map(() => '?').join(',')})`).run(
      ...stale.map((s) => s.id)
    )
  }
  return { id: Number(result.lastInsertRowid), filePath }
}

export async function saveGeneratedImage(input: {
  png: Buffer
  sentPayload: string
  seed: number
  // 디렉터 결과는 개별 req_type(bg-removal 등)을 kind로 저장 → 히스토리 뱃지가 툴별로 표시
  kind: 't2i' | 'i2i' | 'inpaint' | 'scene' | 'upscale' | 'director' | 'mosaic' | DirectorMethod
  sceneId?: number
  /** 저장 파일 확장자 (NAI가 반환한 실제 포맷). 기본 png */
  format?: 'png' | 'webp'
  /** 씬 생성이면 씬 이름 — 씬루트/<프리셋>/<씬 이름>/ 아래에 저장 (NAIS2 구조와 동일 계층) */
  sceneName?: string
  /** 씬이 속한 프리셋 이름 (프리셋 간 동명 씬 충돌 방지) */
  scenePresetName?: string
  /** 전송 payload에는 없는 NAIS3 전용 왕복 메타데이터 */
  localMetadata?: Pick<ImageMetadata, 'promptParts'>
}): Promise<SavedImage> {
  const now = new Date()
  // 여기 오면 항상 실제 폴더에 저장한다. 자동저장 OFF의 "저장 안 함" 판정은
  // 생성 큐 콜백(index.ts)에서 메인 생성만 걸러서 처리 — 씬·디렉터 툴은 항상 저장.
  // 구조: 메인 = 메인폴더/[YYYY-MM/] (날짜 폴더는 설정으로 on/off),
  //       씬 = 씬루트/<프리셋>/<씬 이름>/
  let monthDir: string
  if (input.sceneName) {
    monthDir = sceneDir(input.scenePresetName ?? null, input.sceneName, input.sceneId)
  } else {
    const out = imagesRoot()
    monthDir =
      getSetting('date_folders') !== '0'
        ? join(out, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
        : out
  }
  mkdirSync(monthDir, { recursive: true })

  const ext = input.format ?? 'png'
  let filePath: string
  if (input.sceneName) {
    // 씬 이미지는 첫 장은 씬 이름 그대로, 중복부터 씬 이름_2, _3 ...
    const safeName = input.sceneName.replace(/[/\\:*?"<>|]/g, '_').trim() || `씬-${input.sceneId}`
    let max = 0
    const escaped = safeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const firstRe = new RegExp(`^${escaped}\\.`)
    const numberedRe = new RegExp(`^${escaped}_(\\d+)\\.`)
    for (const f of readdirSync(monthDir)) {
      if (firstRe.test(f)) max = Math.max(max, 1)
      const m = numberedRe.exec(f)
      if (m) max = Math.max(max, Number(m[1]))
    }
    filePath = join(monthDir, max === 0 ? `${safeName}.${ext}` : `${safeName}_${max + 1}.${ext}`)
    while (existsSync(filePath)) {
      max++
      filePath = join(monthDir, `${safeName}_${max + 1}.${ext}`)
    }
  } else {
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    filePath = join(monthDir, `NAIS3_${stamp}_${input.seed}.${ext}`)
  }
  const fileBuffer =
    ext === 'png' && input.localMetadata
      ? injectNais3Params(input.png, input.localMetadata)
      : input.png
  writeFileSync(filePath, fileBuffer)

  // 썸네일: 카드가 커질 수 있어 640px로 (화질 열화 방지). webp q90
  const thumbnail = await sharp(input.png)
    .resize(640, 640, { fit: 'inside' })
    .webp({ quality: 90 })
    .toBuffer()

  const result = getDb()
    .prepare(
      'INSERT INTO images (file_path, thumbnail, kind, seed, payload_json, scene_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      filePath,
      thumbnail,
      input.kind,
      input.seed,
      payloadWithLocalMetadata(input.sentPayload, input.localMetadata),
      input.sceneId ?? null
    )

  return { id: Number(result.lastInsertRowid), filePath }
}

function payloadWithLocalMetadata(
  sentPayload: string,
  localMetadata?: Pick<ImageMetadata, 'promptParts'>
): string {
  if (!localMetadata) return sentPayload
  try {
    return JSON.stringify({ ...JSON.parse(sentPayload), nais3: localMetadata })
  } catch {
    return sentPayload
  }
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const NAIS3_KEYWORD = 'nais3-params'
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function textChunk(keyword: string, value: string): Buffer {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(value, 'latin1')
  ])
  const type = Buffer.from('tEXt', 'ascii')
  const out = Buffer.alloc(4 + 4 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  type.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length)
  return out
}

function injectNais3Params(png: Buffer, meta: Pick<ImageMetadata, 'promptParts'>): Buffer {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIG)) return png
  const value = Buffer.from(JSON.stringify({ version: 1, ...meta }), 'utf8').toString('base64')
  const chunk = textChunk(NAIS3_KEYWORD, value)
  const ihdrEnd = 33
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)])
}

export interface HistoryItem {
  id: number
  filePath: string
  /** webp 썸네일 base64 (data URL 아님) */
  thumbnail: string
  kind: string
  seed: number | null
  createdAt: string
}

export function listImages(limit: number, offset: number): { items: HistoryItem[]; total: number } {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) AS c FROM images').get() as { c: number }).c
  const rows = db
    .prepare(
      `SELECT id, file_path, thumbnail, kind, seed, created_at
       FROM images ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as {
    id: number
    file_path: string
    thumbnail: Buffer | null
    kind: string
    seed: number | null
    created_at: string
  }[]

  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      thumbnail: r.thumbnail ? r.thumbnail.toString('base64') : '',
      kind: r.kind,
      seed: r.seed,
      createdAt: r.created_at
    }))
  }
}

export function getImagePayload(id: number): string | null {
  const row = getDb().prepare('SELECT payload_json FROM images WHERE id = ?').get(id) as
    { payload_json: string } | undefined
  return row?.payload_json ?? null
}

import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { isAbsolute, join, relative } from 'path'
import sharp from 'sharp'
import type { DirectorMethod } from '../../shared/types'
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

/** 현재 저장 폴더 — 설정(save_dir)이 있으면 그걸, 없으면 기본값 */
export function imagesRoot(): string {
  const custom = getSetting('save_dir')
  return custom && custom.trim() ? custom : defaultImagesRoot()
}

/** 앱 내부 라이브러리 폴더 — 자동 저장 OFF일 때 저장 위치 (히스토리엔 남지만 저장 폴더엔 안 감) */
export function libraryRoot(): string {
  return join(app.getPath('userData'), 'library')
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
    isInside(defaultImagesRoot(), filePath) ||
    isInside(libraryRoot(), filePath)
  )
}

export async function saveGeneratedImage(input: {
  png: Buffer
  sentPayload: string
  seed: number
  // 디렉터 결과는 개별 req_type(bg-removal 등)을 kind로 저장 → 히스토리 뱃지가 툴별로 표시
  kind: 't2i' | 'i2i' | 'inpaint' | 'scene' | 'upscale' | 'director' | DirectorMethod
  sceneId?: number
  /** 저장 파일 확장자 (NAI가 반환한 실제 포맷). 기본 png */
  format?: 'png' | 'webp'
  /** 저장 루트 (자동 저장 OFF면 libraryRoot). 기본 imagesRoot */
  baseDir?: string
  /** 씬 생성이면 씬 이름 — 저장폴더/씬/<이름>/ 아래에 저장 (월별 폴더 대신) */
  sceneName?: string
}): Promise<SavedImage> {
  const now = new Date()
  const root = input.baseDir ?? imagesRoot()
  const monthDir = input.sceneName
    ? join(root, '씬', input.sceneName.replace(/[/\\:*?"<>|]/g, '_').trim() || `씬-${input.sceneId}`)
    : join(root, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  mkdirSync(monthDir, { recursive: true })

  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filePath = join(monthDir, `NAIS3_${stamp}_${input.seed}.${input.format ?? 'png'}`)
  writeFileSync(filePath, input.png)

  // 썸네일: 카드가 커질 수 있어 640px로 (화질 열화 방지). webp q90
  const thumbnail = await sharp(input.png)
    .resize(640, 640, { fit: 'inside' })
    .webp({ quality: 90 })
    .toBuffer()

  const result = getDb()
    .prepare(
      'INSERT INTO images (file_path, thumbnail, kind, seed, payload_json, scene_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(filePath, thumbnail, input.kind, input.seed, input.sentPayload, input.sceneId ?? null)

  return { id: Number(result.lastInsertRowid), filePath }
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
    | { payload_json: string }
    | undefined
  return row?.payload_json ?? null
}

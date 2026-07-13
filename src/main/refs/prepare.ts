import { readFileSync } from 'fs'
import sharp from 'sharp'
import type { CharacterReferenceOptions, VibeOptions } from '../nai/payload'
import { ENDPOINTS } from '../nai/endpoints'
import {
  charRefRowsByIds,
  enabledCharRefRows,
  enabledVibeRows,
  saveVibeEncoding,
  vibeRowsByIds
} from './repo'

/** 생성 직전 바이브 준비 — 미인코딩/ie 변경분만 encode-vibe (2 Anlas) 후 캐시.
 *  newlyEncoded: 이번에 새로 인코딩된 바이브 id (카드 표시 갱신 통지용) */
export async function prepareVibes(
  token: string,
  ids?: number[]
): Promise<{ vibes: VibeOptions[]; newlyEncoded: number[] }> {
  // ids 지정 시 그 바이브들(enabled 무시 — 출연 예약), 미지정 시 enabled 항목
  const rows = ids ? vibeRowsByIds(ids) : enabledVibeRows()
  const vibes: VibeOptions[] = []
  const newlyEncoded: number[] = []
  for (const row of rows) {
    let encoded = row.encoded
    if (!encoded || row.encodedIe !== row.infoExtracted) {
      const res = await fetch(ENDPOINTS.encodeVibe, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: readFileSync(row.filePath).toString('base64'),
          information_extracted: row.infoExtracted,
          model: 'nai-diffusion-4-5-full'
        })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`바이브 인코딩 실패 ${res.status}: ${text.slice(0, 200)}`)
      }
      encoded = Buffer.from(await res.arrayBuffer()).toString('base64')
      saveVibeEncoding(row.id, encoded, row.infoExtracted)
      newlyEncoded.push(row.id)
    }
    vibes.push({ strength: row.strength, encodedVibeBase64: encoded })
  }
  return { vibes, newlyEncoded }
}

/**
 * 캐릭레퍼 이미지 전처리 — OpenAPI 명세: 1024×1536 / 1536×1024 / 1472×1472
 * 캔버스에 검정 패딩으로 맞춰 전송. 종횡비에 따라 캔버스 선택.
 */
async function processCharRefImage(filePath: string): Promise<string> {
  const buf = readFileSync(filePath)
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 1
  const h = meta.height ?? 1
  const ratio = w / h
  const canvas =
    ratio > 1.2 ? { w: 1536, h: 1024 } : ratio < 1 / 1.2 ? { w: 1024, h: 1536 } : { w: 1472, h: 1472 }

  const png = await sharp(buf)
    .resize(canvas.w, canvas.h, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
    .png()
    .toBuffer()
  return png.toString('base64')
}

export async function prepareCharRefs(ids?: number[]): Promise<CharacterReferenceOptions[]> {
  // ids 지정 시 그 캐릭레퍼들(enabled 무시 — 출연 예약), 미지정 시 enabled 항목
  const rows = ids ? charRefRowsByIds(ids) : enabledCharRefRows()
  const result: CharacterReferenceOptions[] = []
  for (const row of rows) {
    result.push({
      referenceType: row.refType as CharacterReferenceOptions['referenceType'],
      strength: row.strength,
      fidelity: row.fidelity,
      imageBase64: await processCharRefImage(row.filePath)
    })
  }
  return result
}

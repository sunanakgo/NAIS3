import { readFileSync } from 'fs'
import sharp from '../sharp'
import type { CharacterReferenceOptions, VibeOptions } from '../nai/payload'
import { ENDPOINTS } from '../nai/endpoints'
import { t } from '../i18n'
import {
  charRefRowsByIds,
  enabledCharRefRows,
  enabledVibeRows,
  saveVibeEncoding,
  vibeRowsByIds
} from './repo'
import { getVibeEncoding, putVibeEncoding } from './vibe-encoding-cache'
import { prepareReferenceImage } from './reference-image'
import { modelCapabilities } from '../../shared/nai-models'
import { referenceTypeForModel } from '../../shared/precise-reference'
import type { CharRefType } from '../../shared/types'

/** 생성 직전 바이브 준비 — 미인코딩/ie 변경분만 encode-vibe (2 Anlas) 후 캐시.
 *  newlyEncoded: 이번에 새로 인코딩된 바이브 id (카드 표시 갱신 통지용) */
export async function prepareVibes(
  token: string,
  model: string,
  ids?: number[]
): Promise<{ vibes: VibeOptions[]; newlyEncoded: number[] }> {
  // ids 지정 시 그 바이브들(enabled 무시 — 출연 예약), 미지정 시 enabled 항목
  const rows = ids ? vibeRowsByIds(ids) : enabledVibeRows()
  const vibes: VibeOptions[] = []
  const newlyEncoded: number[] = []
  for (const row of rows) {
    let encoded = getVibeEncoding(row.encoded, row.encodedIe, model, row.infoExtracted)
    if (!encoded) {
      const res = await fetch(ENDPOINTS.encodeVibe, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: readFileSync(row.filePath).toString('base64'),
          information_extracted: row.infoExtracted,
          model
        })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(t('ui.vibeEncodingFailedValueValue', res.status, text.slice(0, 200)))
      }
      encoded = Buffer.from(await res.arrayBuffer()).toString('base64')
      const packed = putVibeEncoding(row.encoded, row.encodedIe, model, row.infoExtracted, encoded)
      saveVibeEncoding(row.id, packed, row.infoExtracted)
      newlyEncoded.push(row.id)
    }
    vibes.push({ strength: row.strength, encodedVibeBase64: encoded })
  }
  return { vibes, newlyEncoded }
}

export async function prepareCharRefs(
  model: string,
  ids?: number[]
): Promise<CharacterReferenceOptions[]> {
  // ids 지정 시 그 캐릭레퍼들(enabled 무시 — 출연 예약), 미지정 시 enabled 항목
  const rows = ids ? charRefRowsByIds(ids) : enabledCharRefRows()
  const mode = modelCapabilities(model).characterReferenceImages
  const result: CharacterReferenceOptions[] = []
  for (const row of rows) {
    const referenceType = row.refType as CharRefType
    // 이 모델이 받지 않는 타입(예: V4.5의 Outfit)은 이미지 처리 없이 건너뛴다
    if (!referenceTypeForModel(referenceType, model)) continue
    result.push({
      referenceType,
      strength: row.strength,
      fidelity: row.fidelity,
      imageBase64: await prepareReferenceImage(sharp, readFileSync(row.filePath), mode)
    })
  }
  return result
}

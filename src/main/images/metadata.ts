import { gunzipSync, inflateSync } from 'zlib'
import sharp from '../sharp'
import type { ImageMetadata } from '../../shared/types'
import {
  normalizeImageMetadata,
  type LocalMetadataParams,
  type NaiMetadataParams
} from '../../shared/image-metadata'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const STEALTH_MAGIC = 'stealth_pngcomp'
const LOCAL_PARAM_KEYS = ['nais3-params', 'nais2-params']

/** PNG tEXt/zTXt/iTXt 청크에서 keyword→text 추출 */
function parsePngTextChunks(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return out
  let off = 8
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const dataStart = off + 8
    const dataEnd = dataStart + len
    if (dataEnd > buf.length) break
    const data = buf.subarray(dataStart, dataEnd)
    try {
      if (type === 'tEXt') {
        const nul = data.indexOf(0)
        if (nul >= 0) out[data.toString('latin1', 0, nul)] = data.toString('latin1', nul + 1)
      } else if (type === 'zTXt') {
        const nul = data.indexOf(0)
        if (nul >= 0) {
          const key = data.toString('latin1', 0, nul)
          // data[nul+1] = compression method(0=zlib), 이후 압축 텍스트
          out[key] = inflateSync(data.subarray(nul + 2)).toString('latin1')
        }
      } else if (type === 'iTXt') {
        const nul = data.indexOf(0)
        if (nul >= 0) {
          const key = data.toString('latin1', 0, nul)
          const compFlag = data[nul + 1]
          // nul+3부터 lang\0translated\0text
          let p = nul + 3
          const langEnd = data.indexOf(0, p)
          p = langEnd + 1
          const transEnd = data.indexOf(0, p)
          p = transEnd + 1
          const textBuf = data.subarray(p)
          out[key] =
            compFlag === 1 ? inflateSync(textBuf).toString('utf8') : textBuf.toString('utf8')
        }
      } else if (type === 'IEND') {
        break
      }
    } catch {
      // 개별 청크 파싱 실패는 무시
    }
    off = dataEnd + 4 // + CRC
  }
  return out
}

/** stealth 메타데이터 (알파 채널 LSB, column-major, magic + gzip JSON) */
async function extractStealthComment(buf: Buffer): Promise<Record<string, unknown> | null> {
  try {
    const { data, info } = await sharp(buf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const { width, height, channels } = info
    const total = width * height
    const bytes = new Uint8Array(Math.ceil(total / 8))
    let bitIdx = 0
    // column-major 알파 LSB → MSB-first 패킹 (np.packbits와 동일)
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const a = data[(y * width + x) * channels + 3] & 1
        if (a) bytes[bitIdx >> 3] |= 1 << (7 - (bitIdx & 7))
        bitIdx++
      }
    }
    const magic = Buffer.from(STEALTH_MAGIC, 'ascii')
    for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return null
    let off = magic.length
    const lengthBits =
      (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]
    off += 4
    const lengthBytes = Math.ceil(lengthBits / 8)
    const compressed = Buffer.from(bytes.slice(off, off + lengthBytes))
    const json = JSON.parse(gunzipSync(compressed).toString('utf8')) as Record<string, unknown>
    if (typeof json.Comment === 'string') json.Comment = JSON.parse(json.Comment)
    return json
  } catch {
    return null
  }
}

function parseLocalParams(text: Record<string, string>): LocalMetadataParams | undefined {
  for (const key of LOCAL_PARAM_KEYS) {
    const raw = text[key]
    if (!raw) continue
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as LocalMetadataParams
    } catch {
      try {
        return JSON.parse(raw) as LocalMetadataParams
      } catch {
        // 다음 후보 확인
      }
    }
  }
  return undefined
}

/** PNG 버퍼 → 정규화 메타 (tEXt Comment → stealth 폴백). 없으면 null */
export async function metadataFromPng(buf: Buffer): Promise<ImageMetadata | null> {
  const text = parsePngTextChunks(buf)
  const local = parseLocalParams(text)
  let comment: NaiMetadataParams | null = null
  let extra = {
    software: text.Software,
    model: text.Source,
    description: text.Description
  }
  if (text.Comment) {
    try {
      comment = JSON.parse(text.Comment) as NaiMetadataParams
    } catch {
      comment = null
    }
  }
  if (!comment) {
    const stealth = await extractStealthComment(buf)
    if (stealth) {
      comment = (stealth.Comment as NaiMetadataParams) ?? (stealth as NaiMetadataParams)
      if (typeof stealth.Software === 'string') extra = { ...extra, software: stealth.Software }
      if (typeof stealth.Source === 'string') extra = { ...extra, model: stealth.Source }
    }
  }
  if (!comment) return null
  const c = comment as NaiMetadataParams & { prompt?: string; uc?: string }
  return normalizeImageMetadata(comment, {
    prompt: c.prompt ?? extra.description ?? '',
    uc: c.uc ?? '',
    model: extra.model,
    software: extra.software,
    local
  })
}

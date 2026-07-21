/**
 * 작가 태그 분석 (NAIS2 이식) — Kaloscope artist-style classifier (Hugging Face Space)에
 * 이미지를 보내 그림체가 닮은 작가들을 `artist:이름` 태그로 받아온다. 인터넷 필요.
 */
import type { ArtistTag } from '../../shared/types'

const SPACE_ID = 'DraconicDragon/Kaloscope-artist-style-classifier'

export async function analyzeArtists(image: Buffer): Promise<ArtistTag[]> {
  const { Client } = await import('@gradio/client')
  const client = await Client.connect(SPACE_ID)
  const result = await client.predict('/predict', {
    image: new Blob([new Uint8Array(image)], { type: 'image/png' })
  })
  const raw = (result.data as unknown[])?.[0]

  // 응답 포맷이 스페이스 버전에 따라 다르다 — 문자열(콤마 구분) / 점수 맵 / gradio Label
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
      .map((artist, i) => ({ label: `artist:${artist}`, score: 1 - i * 0.05 }))
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.confidences)) {
      return (o.confidences as { label: string; confidence: number }[])
        .map((c) => ({ label: `artist:${c.label}`, score: c.confidence }))
        .sort((a, b) => b.score - a.score)
    }
    return Object.entries(o)
      .filter((e): e is [string, number] => typeof e[1] === 'number')
      .map(([label, score]) => ({ label: `artist:${label}`, score }))
      .sort((a, b) => b.score - a.score)
  }
  return []
}

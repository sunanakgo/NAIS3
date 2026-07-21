/**
 * 작가 태그 분석 (NAIS2 이식) — Kaloscope artist-style classifier (Hugging Face Space)에
 * 이미지를 보내 그림체가 닮은 작가들을 `artist:이름` 태그로 받아온다. 인터넷 필요.
 * Space 기본 모델은 Kaloscope v2.0 (39,260명·top-1 90.13%).
 */
import type { ArtistTag } from '../../shared/types'

const SPACE_ID = 'DraconicDragon/Kaloscope-artist-style-classifier'
/** 후보 수 — Space 허용 최대 25. 낮은 점수 꼬리는 아래에서 잘라낸다 */
const TOP_K = 25
/** 이 점수 미만 꼬리는 버림 (단, 최소 MIN_KEEP개는 유지) */
const SCORE_CUT = 0.001
const MIN_KEEP = 5

export async function analyzeArtists(image: Buffer): Promise<ArtistTag[]> {
  const { Client } = await import('@gradio/client')
  const client = await Client.connect(SPACE_ID)
  const result = await client.predict('/predict', {
    image: new Blob([new Uint8Array(image)], { type: 'image/png' }),
    top_k: TOP_K,
    threshold: 0
  })
  const outputs = result.data as unknown[]

  // 출력: [0] 콤마 문자열, [1] DataFrame, [2] {작가: 실제 점수} JSON, [3] 메타.
  // 실제 confidence가 있는 [2]를 우선 쓰고, 포맷이 바뀌면 [0]으로 폴백.
  const scored = parseScoreMap(outputs?.[2])
  if (scored.length > 0) {
    const kept = scored.filter((t) => t.score >= SCORE_CUT)
    return kept.length >= MIN_KEEP ? kept : scored.slice(0, MIN_KEEP)
  }

  const raw = outputs?.[0]
  if (typeof raw === 'string') {
    // 점수 없는 이름 목록 — 순위 기반 근사 점수 부여
    return raw
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
      .map((artist, i) => ({ label: `artist:${artist}`, score: 1 - i * 0.05 }))
  }
  return []
}

/** {작가: 점수} 맵 (JSON 문자열 또는 객체) → 점수 내림차순 태그 목록 */
function parseScoreMap(raw: unknown): ArtistTag[] {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj as Record<string, unknown>)
    .filter((e): e is [string, number] => typeof e[1] === 'number')
    .map(([label, score]) => ({ label: `artist:${label}`, score }))
    .sort((a, b) => b.score - a.score)
}

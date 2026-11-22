import type { ImageMetadata, MetadataVibe } from '../../shared/types'

/** NAI 기본 바이브 강도 — 메타데이터에 강도가 없거나 잘못된 값일 때 */
const DEFAULT_STRENGTH = 0.6
/** 패딩까지 맞는 표준 base64 — NAI 인코딩 형식. 길이가 어긋나면 잘린 값이라 버린다 */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * NovelAI PNG의 Source 문자열 → API 모델 id. 바이브 인코딩은 모델별이라 어느 모델로
 * 인코딩됐는지 알아야 그대로 재사용할 수 있다. 모르는 값은 undefined (호출 측이 결정).
 */
const SOURCE_MODELS: Record<string, string> = {
  'NovelAI Diffusion V4.5 1229B44F': 'nai-diffusion-4-5-full',
  'NovelAI Diffusion V4.5 C02D4F98': 'nai-diffusion-4-5-curated'
}

function unitNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 생성 파라미터의 바이브 트랜스퍼 필드 → 바이브 목록.
 * - reference_image_multiple: 인코딩된 바이브(base64). 없거나 잘못된 항목은 encoded 없이 남긴다
 *   (강도 배열과 인덱스를 맞추기 위해 — 표시는 하되 복원 불가)
 * - reference_strength_multiple / reference_information_extracted_multiple: 같은 인덱스의 값.
 *   길이가 달라도 긴 쪽(이미지·강도 중) 기준으로 만들고 빈 칸은 기본값/미상으로 둔다.
 * 바이브가 없으면 undefined.
 */
export function parseMetadataVibes(params: Record<string, unknown>): MetadataVibe[] | undefined {
  const images = list(params.reference_image_multiple)
  const strengths = list(params.reference_strength_multiple)
  const infos = list(params.reference_information_extracted_multiple)
  const count = Math.max(images.length, strengths.length)
  if (count === 0) return undefined
  const vibes: MetadataVibe[] = []
  for (let i = 0; i < count; i++) {
    const raw = images[i]
    const encoded = typeof raw === 'string' ? raw.trim() : ''
    const informationExtracted = unitNumber(infos[i])
    vibes.push({
      ...(encoded && BASE64.test(encoded) ? { encoded } : {}),
      strength: unitNumber(strengths[i]) ?? DEFAULT_STRENGTH,
      ...(informationExtracted !== undefined ? { informationExtracted } : {})
    })
  }
  return vibes
}

/**
 * 바이브가 인코딩된 모델. payload의 모델 id(인페인트면 기본 모델 — 바이브는 기본 모델로
 * 인코딩된다) 또는 알려진 NovelAI Source 문자열. 모르면 undefined.
 */
export function vibeModelFor(model: string | undefined): string | undefined {
  if (!model) return undefined
  const trimmed = model.trim()
  if (trimmed.startsWith('nai-diffusion-')) return trimmed.replace(/-inpainting$/, '')
  return SOURCE_MODELS[trimmed]
}

/**
 * PNG 메타데이터에 인코딩된 바이브가 없으면(또는 모델을 모르면) 우리 DB payload_json의 값으로 채운다.
 * NAIS3가 보낸 요청에는 인코딩된 바이브와 모델 id가 그대로 남아 있다.
 */
export function withPayloadVibes(
  meta: ImageMetadata,
  fromPayload: ImageMetadata | null
): ImageMetadata {
  if (!fromPayload?.vibes?.some((vibe) => vibe.encoded)) return meta
  if (!meta.vibes?.some((vibe) => vibe.encoded)) {
    return { ...meta, vibes: fromPayload.vibes, vibeModel: fromPayload.vibeModel }
  }
  return meta.vibeModel || !fromPayload.vibeModel
    ? meta
    : { ...meta, vibeModel: fromPayload.vibeModel }
}

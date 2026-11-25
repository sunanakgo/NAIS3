const PREFIX = 'nais3-vibe-cache-v1:'
const LEGACY_MODEL = 'nai-diffusion-4-5-full'

type Entry = { ie: number; data: string }
type Cache = Record<string, Entry>

function parse(encoded: string | null, legacyIe: number | null): Cache {
  if (!encoded) return {}
  if (encoded.startsWith(PREFIX)) {
    try {
      const value = JSON.parse(encoded.slice(PREFIX.length)) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      const cache: Cache = {}
      for (const [model, raw] of Object.entries(value)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
        const entry = raw as { ie?: unknown; data?: unknown }
        if (typeof entry.ie === 'number' && typeof entry.data === 'string') {
          cache[model] = { ie: entry.ie, data: entry.data }
        }
      }
      return cache
    } catch {
      return {}
    }
  }
  return legacyIe === null ? {} : { [LEGACY_MODEL]: { ie: legacyIe, data: encoded } }
}

function pack(cache: Cache): string {
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)))
  return PREFIX + JSON.stringify(sorted)
}

export function getVibeEncoding(
  encoded: string | null,
  legacyIe: number | null,
  model: string,
  informationExtracted: number
): string | null {
  const entry = parse(encoded, legacyIe)[model]
  return entry?.ie === informationExtracted ? entry.data : null
}

export function putVibeEncoding(
  encoded: string | null,
  legacyIe: number | null,
  model: string,
  informationExtracted: number,
  data: string
): string {
  return pack({
    ...parse(encoded, legacyIe),
    [model]: { ie: informationExtracted, data }
  })
}

export function vibeEncodingModels(
  encoded: string | null,
  legacyIe: number | null,
  informationExtracted: number
): string[] {
  return Object.entries(parse(encoded, legacyIe))
    .filter(([, entry]) => entry.ie === informationExtracted)
    .map(([model]) => model)
    .sort()
}

/** 캐시에 든 모든 인코딩 (모델 이름순) — 같은 인코딩을 가진 기존 바이브를 찾을 때 */
export function vibeEncodingEntries(
  encoded: string | null,
  legacyIe: number | null
): { model: string; ie: number; data: string }[] {
  return Object.entries(parse(encoded, legacyIe))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, entry]) => ({ model, ie: entry.ie, data: entry.data }))
}

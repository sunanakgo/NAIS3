import { modelCapabilities } from './nai-models'
import type { CharRefType } from './types'

/**
 * Precise Reference (director reference) rules shared by the main process, the
 * browser gateway and the renderer.
 *
 * Checked against the novelai.net web bundle on 2026-11-25 (V5 release):
 * - V5 adds Outfit references (`costume`) and a "Prefer same outfit" toggle that
 *   switches Character between `character` / `character_mainoutfit` and
 *   Character & Style between `character&style_anyoutfit` / `character&style`.
 * - Models without outfit support get `_mainoutfit` → `character`,
 *   `_anyoutfit` → `character&style`, and `costume` references dropped.
 */

/** Types the type picker offers (the toggle variants share their base entry). */
export type BaseReferenceType = 'character&style' | 'character' | 'style' | 'costume' | 'delta'

const TOGGLE_ON: Partial<Record<CharRefType, CharRefType>> = {
  character: 'character_mainoutfit',
  character_mainoutfit: 'character_mainoutfit',
  'character&style': 'character&style',
  'character&style_anyoutfit': 'character&style'
}

const TOGGLE_OFF: Partial<Record<CharRefType, CharRefType>> = {
  character: 'character',
  character_mainoutfit: 'character',
  'character&style': 'character&style_anyoutfit',
  'character&style_anyoutfit': 'character&style_anyoutfit'
}

export function baseReferenceType(type: CharRefType): BaseReferenceType {
  if (type === 'character_mainoutfit') return 'character'
  if (type === 'character&style_anyoutfit') return 'character&style'
  return type
}

/** Toggle state for types that have one, otherwise null. */
export function preferSameOutfit(type: CharRefType): boolean | null {
  if (!(type in TOGGLE_ON)) return null
  return TOGGLE_ON[type] === type
}

export function withPreferSameOutfit(type: CharRefType, on: boolean): CharRefType {
  return (on ? TOGGLE_ON[type] : TOGGLE_OFF[type]) ?? type
}

/** Type picker entries for a model, in the web UI's order. */
export function referenceTypeOptions(model: string): BaseReferenceType[] {
  return modelCapabilities(model).outfitReferences
    ? ['character&style', 'character', 'style', 'costume']
    : ['character&style', 'character', 'style']
}

/** The type actually sent to this model, or null when the reference is skipped. */
export function referenceTypeForModel(type: CharRefType, model: string): CharRefType | null {
  if (modelCapabilities(model).outfitReferences) return type
  if (type === 'costume') return null
  if (type === 'character_mainoutfit') return 'character'
  if (type === 'character&style_anyoutfit') return 'character&style'
  return type
}

/** Whether a request to this model sends references at all (V5 inpainting does not). */
export function referencesSentFor(model: string, hasMask: boolean): boolean {
  const capabilities = modelCapabilities(model)
  return capabilities.characterReferences && (!hasMask || capabilities.characterReferenceInpainting)
}

/** How many of these references a request will send (and charge 5 Anlas each for). */
export function sentReferenceCount(types: CharRefType[], model: string, hasMask: boolean): number {
  if (!referencesSentFor(model, hasMask)) return 0
  return types.filter((type) => referenceTypeForModel(type, model) !== null).length
}

/** Short card label. */
export function referenceTypeBadge(type: CharRefType): string {
  switch (baseReferenceType(type)) {
    case 'character&style':
      return 'C&S'
    case 'character':
      return 'C'
    case 'style':
      return 'S'
    case 'costume':
      return 'O'
    case 'delta':
      return 'D'
  }
}

const MEGAPIXEL = 1024 * 1024

/**
 * V5 reference buckets: for each height from 4096 down to 1024 in steps of 64, the
 * widest multiple of 64 that keeps the area at most 1 MP, plus the mirrored
 * landscape buckets (97 in total, the same table as the web bundle).
 */
export const DIRECTOR_REFERENCE_BUCKETS: readonly (readonly [number, number])[] = (() => {
  const portrait: [number, number][] = []
  for (let height = 4096; height >= 1024; height -= 64) {
    portrait.push([Math.floor(MEGAPIXEL / height / 64) * 64, height])
  }
  const landscape = portrait
    .slice(0, -1)
    .reverse()
    .map(([width, height]): [number, number] => [height, width])
  return [...portrait, ...landscape]
})()

export interface ReferenceBucket {
  width: number
  height: number
  resizeWidth: number
  resizeHeight: number
  left: number
  top: number
  unchanged: boolean
}

/**
 * Picks the bucket with the closest aspect ratio (in log space), scales the image to
 * cover it and centers the crop, as the web client does for V5 references.
 */
export function directorReferenceBucket(width: number, height: number): ReferenceBucket {
  const aspect = Math.log(Math.max(width, 1) / Math.max(height, 1))
  let best = DIRECTOR_REFERENCE_BUCKETS[0]
  let bestDistance = Math.abs(aspect - Math.log(best[0] / best[1]))
  for (const bucket of DIRECTOR_REFERENCE_BUCKETS) {
    const distance = Math.abs(aspect - Math.log(bucket[0] / bucket[1]))
    if (distance < bestDistance) {
      best = bucket
      bestDistance = distance
    }
  }
  const [bucketWidth, bucketHeight] = best
  const scale = Math.max(bucketWidth / width, bucketHeight / height)
  const resizeWidth = Math.max(Math.floor(width * scale + 0.5), bucketWidth)
  const resizeHeight = Math.max(Math.floor(height * scale + 0.5), bucketHeight)
  return {
    width: bucketWidth,
    height: bucketHeight,
    resizeWidth,
    resizeHeight,
    left: Math.floor((resizeWidth - bucketWidth) / 2),
    top: Math.floor((resizeHeight - bucketHeight) / 2),
    unchanged: width === bucketWidth && height === bucketHeight
  }
}

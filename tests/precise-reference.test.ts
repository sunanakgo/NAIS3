import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { prepareReferenceImage } from '../src/main/refs/reference-image'
import {
  DIRECTOR_REFERENCE_BUCKETS,
  baseReferenceType,
  clampReferenceStrength,
  directorReferenceBucket,
  preferSameOutfit,
  referenceTypeBadge,
  referenceTypeForModel,
  referenceTypeOptions,
  referencesSentFor,
  sentReferenceCount,
  withBaseReferenceType,
  withPreferSameOutfit
} from '../src/shared/precise-reference'

const V5 = 'nai-diffusion-5-full'
const V45 = 'nai-diffusion-4-5-full'

// novelai.net web bundle, 2026-11-25
// prettier-ignore
const WEB_BUCKETS = [
  [256, 4096], [256, 4032], [256, 3968], [256, 3904], [256, 3840], [256, 3776], [256, 3712],
  [256, 3648], [256, 3584], [256, 3520], [256, 3456], [256, 3392], [256, 3328], [320, 3264],
  [320, 3200], [320, 3136], [320, 3072], [320, 3008], [320, 2944], [320, 2880], [320, 2816],
  [320, 2752], [384, 2688], [384, 2624], [384, 2560], [384, 2496], [384, 2432], [384, 2368],
  [448, 2304], [448, 2240], [448, 2176], [448, 2112], [512, 2048], [512, 1984], [512, 1920],
  [512, 1856], [576, 1792], [576, 1728], [576, 1664], [640, 1600], [640, 1536], [704, 1472],
  [704, 1408], [768, 1344], [768, 1280], [832, 1216], [896, 1152], [960, 1088], [1024, 1024],
  [1088, 960], [1152, 896], [1216, 832], [1280, 768], [1344, 768], [1408, 704], [1472, 704],
  [1536, 640], [1600, 640], [1664, 576], [1728, 576], [1792, 576], [1856, 512], [1920, 512],
  [1984, 512], [2048, 512], [2112, 448], [2176, 448], [2240, 448], [2304, 448], [2368, 384],
  [2432, 384], [2496, 384], [2560, 384], [2624, 384], [2688, 384], [2752, 320], [2816, 320],
  [2880, 320], [2944, 320], [3008, 320], [3072, 320], [3136, 320], [3200, 320], [3264, 320],
  [3328, 256], [3392, 256], [3456, 256], [3520, 256], [3584, 256], [3648, 256], [3712, 256],
  [3776, 256], [3840, 256], [3904, 256], [3968, 256], [4032, 256], [4096, 256]
]

describe('Precise Reference types', () => {
  it('Prefer same outfit switches Character and Character & Style variants', () => {
    expect(preferSameOutfit('character')).toBe(false)
    expect(preferSameOutfit('character_mainoutfit')).toBe(true)
    expect(preferSameOutfit('character&style')).toBe(true)
    expect(preferSameOutfit('character&style_anyoutfit')).toBe(false)
    expect(preferSameOutfit('style')).toBeNull()
    expect(preferSameOutfit('costume')).toBeNull()

    expect(withPreferSameOutfit('character', true)).toBe('character_mainoutfit')
    expect(withPreferSameOutfit('character_mainoutfit', false)).toBe('character')
    expect(withPreferSameOutfit('character&style', false)).toBe('character&style_anyoutfit')
    expect(withPreferSameOutfit('character&style_anyoutfit', true)).toBe('character&style')
    expect(withPreferSameOutfit('style', true)).toBe('style')
  })

  it('picking a base type keeps the current Prefer same outfit state', () => {
    // off stays off
    expect(withBaseReferenceType('character', 'character&style')).toBe('character&style_anyoutfit')
    expect(withBaseReferenceType('character&style_anyoutfit', 'character')).toBe('character')
    // on stays on
    expect(withBaseReferenceType('character_mainoutfit', 'character&style')).toBe('character&style')
    expect(withBaseReferenceType('character&style', 'character')).toBe('character_mainoutfit')
    // types without a toggle
    expect(withBaseReferenceType('character_mainoutfit', 'style')).toBe('style')
    expect(withBaseReferenceType('character&style_anyoutfit', 'costume')).toBe('costume')
    expect(withBaseReferenceType('style', 'character')).toBe('character')
    expect(withBaseReferenceType('costume', 'character&style')).toBe('character&style')
  })

  it('clamps strength to the model maximum', () => {
    expect(clampReferenceStrength(3, V45)).toBe(1)
    expect(clampReferenceStrength(0.4, V45)).toBe(0.4)
    expect(clampReferenceStrength(3, V5)).toBe(3)
    expect(clampReferenceStrength(9, V5)).toBe(5)
    expect(clampReferenceStrength(-1, V5)).toBe(0)
  })

  it('variants share the picker entry and card badge of their base type', () => {
    expect(baseReferenceType('character_mainoutfit')).toBe('character')
    expect(baseReferenceType('character&style_anyoutfit')).toBe('character&style')
    expect(referenceTypeBadge('character_mainoutfit')).toBe('C')
    expect(referenceTypeBadge('character&style_anyoutfit')).toBe('C&S')
    expect(referenceTypeBadge('style')).toBe('S')
    expect(referenceTypeBadge('costume')).toBe('O')
  })

  it('offers Outfit only on models that support it', () => {
    expect(referenceTypeOptions(V5)).toEqual(['character&style', 'character', 'style', 'costume'])
    expect(referenceTypeOptions(V45)).toEqual(['character&style', 'character', 'style'])
  })

  it('maps types for V4.5 like the web client and keeps them on V5', () => {
    expect(referenceTypeForModel('character_mainoutfit', V45)).toBe('character')
    expect(referenceTypeForModel('character&style_anyoutfit', V45)).toBe('character&style')
    expect(referenceTypeForModel('costume', V45)).toBeNull()
    expect(referenceTypeForModel('style', V45)).toBe('style')
    expect(referenceTypeForModel('character_mainoutfit', V5)).toBe('character_mainoutfit')
    expect(referenceTypeForModel('costume', V5)).toBe('costume')
  })

  it('counts only references a request sends', () => {
    const types = ['character', 'costume', 'style'] as const
    expect(sentReferenceCount([...types], V5, false)).toBe(3)
    expect(sentReferenceCount([...types], V45, false)).toBe(2)
    // V5 inpainting sends none; V5 Curated inpainting runs on the V4.5 inpainting model
    expect(referencesSentFor('nai-diffusion-5-full-inpainting', true)).toBe(false)
    expect(sentReferenceCount([...types], 'nai-diffusion-5-full-inpainting', true)).toBe(0)
    expect(sentReferenceCount([...types], 'nai-diffusion-4-5-curated-inpainting', true)).toBe(2)
  })
})

describe('V5 reference buckets', () => {
  it('matches the web bundle table', () => {
    expect(DIRECTOR_REFERENCE_BUCKETS).toEqual(WEB_BUCKETS)
  })

  it('cover-scales to the closest bucket and centers the crop', () => {
    expect(directorReferenceBucket(300, 200)).toEqual({
      width: 1216,
      height: 832,
      resizeWidth: 1248,
      resizeHeight: 832,
      left: 16,
      top: 0,
      unchanged: false
    })
    expect(directorReferenceBucket(100, 5000)).toMatchObject({
      width: 256,
      height: 4096,
      resizeWidth: 256,
      resizeHeight: 12800,
      top: 4352
    })
    expect(directorReferenceBucket(2000, 1000)).toMatchObject({
      width: 1408,
      height: 704,
      unchanged: false
    })
    expect(directorReferenceBucket(832, 1216).unchanged).toBe(true)
  })
})

describe('prepareReferenceImage', () => {
  const sample = (width: number, height: number): Promise<Buffer> =>
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .png()
      .toBuffer()

  it('bucket mode crops V5 references to the bucket size', async () => {
    const out = await prepareReferenceImage(sharp, await sample(300, 200), 'bucket')
    const meta = await sharp(Buffer.from(out, 'base64')).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1216, 832])
  })

  it('canvas mode keeps the V4.5 padded canvases', async () => {
    const out = await prepareReferenceImage(sharp, await sample(300, 200), 'canvas')
    const meta = await sharp(Buffer.from(out, 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([1536, 1024])
  })
})

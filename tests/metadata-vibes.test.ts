import { describe, expect, it } from 'vitest'
import type { ImageMetadata } from '../src/shared/types'
import {
  parseMetadataVibes,
  vibeModelFor,
  withPayloadVibes
} from '../src/main/images/metadata-vibes'
import { putVibeEncoding, vibeEncodingEntries } from '../src/main/refs/vibe-encoding-cache'

describe('parseMetadataVibes', () => {
  it('returns undefined when the image used no vibes', () => {
    expect(parseMetadataVibes({})).toBeUndefined()
    expect(parseMetadataVibes({ reference_image_multiple: [] })).toBeUndefined()
    expect(parseMetadataVibes({ reference_image_multiple: 'not-an-array' })).toBeUndefined()
    // IE alone carries no vibe
    expect(parseMetadataVibes({ reference_information_extracted_multiple: [1] })).toBeUndefined()
  })

  it('pairs encodings with strengths and information extracted by index', () => {
    expect(
      parseMetadataVibes({
        reference_image_multiple: ['QUJD', 'REVGRw=='],
        reference_strength_multiple: [0.45, 0.8],
        reference_information_extracted_multiple: [0.7, 1]
      })
    ).toEqual([
      { encoded: 'QUJD', strength: 0.45, informationExtracted: 0.7 },
      { encoded: 'REVGRw==', strength: 0.8, informationExtracted: 1 }
    ])
  })

  it('uses defaults for missing strengths and leaves unknown IE undefined', () => {
    expect(
      parseMetadataVibes({
        reference_image_multiple: ['QUJD', 'REVG', 'R0hJ'],
        reference_strength_multiple: [0.3]
      })
    ).toEqual([
      { encoded: 'QUJD', strength: 0.3 },
      { encoded: 'REVG', strength: 0.6 },
      { encoded: 'R0hJ', strength: 0.6 }
    ])
  })

  it('keeps strength-only entries without an encoding so the count stays visible', () => {
    expect(
      parseMetadataVibes({
        reference_image_multiple: ['QUJD'],
        reference_strength_multiple: [0.5, 0.9]
      })
    ).toEqual([{ encoded: 'QUJD', strength: 0.5 }, { strength: 0.9 }])
    expect(parseMetadataVibes({ reference_strength_multiple: [0.7] })).toEqual([{ strength: 0.7 }])
  })

  it('drops invalid encodings and clamps or replaces invalid numbers', () => {
    expect(
      parseMetadataVibes({
        reference_image_multiple: [42, '', 'not base64!', { data: 'x' }, ' QUJD '],
        reference_strength_multiple: ['0.5', 2, -1, Number.NaN, null],
        reference_information_extracted_multiple: [Infinity, 1.5, -0.2, 'x']
      })
    ).toEqual([
      { strength: 0.6 },
      { strength: 1, informationExtracted: 1 },
      { strength: 0, informationExtracted: 0 },
      { strength: 0.6 },
      { encoded: 'QUJD', strength: 0.6 }
    ])
  })
})

describe('vibeModelFor', () => {
  it('uses API model ids directly, mapping inpainting to the base model', () => {
    expect(vibeModelFor('nai-diffusion-4-5-full')).toBe('nai-diffusion-4-5-full')
    expect(vibeModelFor('nai-diffusion-4-5-curated-inpainting')).toBe('nai-diffusion-4-5-curated')
  })

  it('maps known NovelAI Source strings and leaves unknown ones undefined', () => {
    expect(vibeModelFor('NovelAI Diffusion V4.5 1229B44F')).toBe('nai-diffusion-4-5-full')
    expect(vibeModelFor('NovelAI Diffusion V4.5 C02D4F98')).toBe('nai-diffusion-4-5-curated')
    expect(vibeModelFor('NovelAI Diffusion V4.5 FFFFFFFF')).toBeUndefined()
    expect(vibeModelFor(undefined)).toBeUndefined()
  })
})

describe('withPayloadVibes', () => {
  const base: ImageMetadata = { prompt: 'p', negativePrompt: '' }
  const payload: ImageMetadata = {
    ...base,
    vibes: [{ encoded: 'QUJD', strength: 0.5 }],
    vibeModel: 'nai-diffusion-4-5-full'
  }

  it('fills vibes from the sent payload when the PNG has no encodings', () => {
    expect(withPayloadVibes(base, payload)).toMatchObject({
      vibes: payload.vibes,
      vibeModel: 'nai-diffusion-4-5-full'
    })
    const strengthsOnly = { ...base, vibes: [{ strength: 0.5 }] }
    expect(withPayloadVibes(strengthsOnly, payload).vibes).toEqual(payload.vibes)
  })

  it('keeps PNG vibes and only fills an unknown model', () => {
    const fromPng = { ...base, vibes: [{ encoded: 'REVG', strength: 0.2 }] }
    expect(withPayloadVibes(fromPng, payload)).toEqual({
      ...fromPng,
      vibeModel: 'nai-diffusion-4-5-full'
    })
    expect(withPayloadVibes(fromPng, null)).toBe(fromPng)
    expect(withPayloadVibes(base, { ...base })).toBe(base)
  })
})

describe('vibeEncodingEntries', () => {
  it('lists every cached encoding, including the legacy single cache', () => {
    expect(vibeEncodingEntries('legacy', 0.7)).toEqual([
      { model: 'nai-diffusion-4-5-full', ie: 0.7, data: 'legacy' }
    ])
    const packed = putVibeEncoding('legacy', 0.7, 'nai-diffusion-4-5-curated', 1, 'curated')
    expect(vibeEncodingEntries(packed, 0.7)).toEqual([
      { model: 'nai-diffusion-4-5-curated', ie: 1, data: 'curated' },
      { model: 'nai-diffusion-4-5-full', ie: 0.7, data: 'legacy' }
    ])
    expect(vibeEncodingEntries(null, null)).toEqual([])
  })
})

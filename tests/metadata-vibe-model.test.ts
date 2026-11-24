// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { metadataVibeModel } from '../src/renderer/src/stores/metadata-store'

const FULL = 'nai-diffusion-4-5-full'
const CURATED = 'nai-diffusion-4-5-curated'
const V5 = 'nai-diffusion-5-curated'

describe('metadataVibeModel', () => {
  it('keeps a known encoding model and flags a different current model', () => {
    expect(metadataVibeModel(FULL, FULL)).toEqual({ model: FULL, known: true, mismatch: false })
    expect(metadataVibeModel(FULL, `${FULL}-inpainting`).mismatch).toBe(false)
    expect(metadataVibeModel(FULL, CURATED)).toEqual({ model: FULL, known: true, mismatch: true })
    expect(metadataVibeModel(CURATED, V5)).toEqual({ model: CURATED, known: true, mismatch: true })
  })

  it('assumes the current model for an unknown encoding when it supports vibes', () => {
    expect(metadataVibeModel(undefined, CURATED)).toEqual({
      model: CURATED,
      known: false,
      mismatch: false
    })
  })

  it('falls back to V4.5 Full for an unknown encoding while a V5 model is selected', () => {
    expect(metadataVibeModel(undefined, V5)).toEqual({ model: FULL, known: false, mismatch: false })
  })
})

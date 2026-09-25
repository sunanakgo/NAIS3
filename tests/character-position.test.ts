import { describe, expect, it } from 'vitest'
import {
  getPositionableCharacters,
  nudgePosition,
  pointToNormalizedPosition,
  positionPercent
} from '../src/renderer/src/lib/character-position'

describe('character position helpers', () => {
  const rect = { left: 100, top: 200, width: 500, height: 1000 }

  it('converts canvas clicks to NovelAI 0.1% normalized coordinates', () => {
    expect(pointToNormalizedPosition(188, 410, rect)).toEqual({ x: 0.176, y: 0.21 })
  })

  it('clamps clicks outside the canvas and handles an unavailable layout', () => {
    expect(pointToNormalizedPosition(0, 2000, rect)).toEqual({ x: 0, y: 1 })
    expect(pointToNormalizedPosition(0, 0, { ...rect, width: 0 })).toEqual({ x: 0.5, y: 0.5 })
  })

  it('formats and nudges positions without escaping the image bounds', () => {
    expect(positionPercent(0.176)).toBe('17.6%')
    expect(nudgePosition({ x: 0, y: 1 }, 'ArrowLeft')).toEqual({ x: 0, y: 1 })
    expect(nudgePosition({ x: 0.176, y: 0.21 }, 'ArrowRight', true)).toEqual({
      x: 0.186,
      y: 0.21
    })
  })
})

describe('positionable characters', () => {
  it.each([
    ['nai-diffusion-5-full', 32],
    ['nai-diffusion-5-curated', 32],
    ['nai-diffusion-4-5-full', 6]
  ])('filters empty prompts before applying the %s limit', (model, limit) => {
    const active = Array.from({ length: 33 }, (_, id) => ({
      id,
      enabled: true,
      prompt: `character ${id}`
    }))
    const characters = [
      { id: -1, enabled: false, prompt: 'disabled' },
      { id: -2, enabled: true, prompt: '  ' },
      { id: -3, enabled: true, prompt: '# comment only' },
      ...active
    ]
    expect(getPositionableCharacters(characters, model)).toEqual(active.slice(0, limit))
    expect(characters).toHaveLength(36)
  })
})

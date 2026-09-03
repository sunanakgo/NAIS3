import { describe, expect, it } from 'vitest'
import {
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

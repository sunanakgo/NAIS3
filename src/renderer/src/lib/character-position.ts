export interface NormalizedPosition {
  x: number
  y: number
}

export interface PositionRect {
  left: number
  top: number
  width: number
  height: number
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/** NovelAI web stores free positions at 0.1% precision. */
export function pointToNormalizedPosition(
  clientX: number,
  clientY: number,
  rect: PositionRect
): NormalizedPosition {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 }
  return {
    x: Math.round(clamp01((clientX - rect.left) / rect.width) * 1000) / 1000,
    y: Math.round(clamp01((clientY - rect.top) / rect.height) * 1000) / 1000
  }
}

export function positionPercent(value: number): string {
  return `${(clamp01(value) * 100).toFixed(1)}%`
}

export function nudgePosition(
  center: NormalizedPosition,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  coarse = false
): NormalizedPosition {
  const delta = coarse ? 0.01 : 0.001
  const xDelta = key === 'ArrowLeft' ? -delta : key === 'ArrowRight' ? delta : 0
  const yDelta = key === 'ArrowUp' ? -delta : key === 'ArrowDown' ? delta : 0
  return {
    x: Math.round(clamp01(center.x + xDelta) * 1000) / 1000,
    y: Math.round(clamp01(center.y + yDelta) * 1000) / 1000
  }
}

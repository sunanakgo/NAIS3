export type BrushShape = 'round' | 'square'

export interface Point {
  x: number
  y: number
}

export interface BrushOutlineRaster {
  data: Uint8ClampedArray
  width: number
  height: number
  left: number
  top: number
}

/** Keep a zoom step anchored to the source pixel currently under the pointer. */
export function zoomAroundPoint(
  pan: Point,
  currentZoom: number,
  nextZoom: number,
  pointerFromCenter: Point
): Point {
  if (nextZoom <= 1) return { x: 0, y: 0 }
  const sourceX = (pointerFromCenter.x - pan.x) / currentZoom
  const sourceY = (pointerFromCenter.y - pan.y) / currentZoom
  return {
    x: pointerFromCenter.x - sourceX * nextZoom,
    y: pointerFromCenter.y - sourceY * nextZoom
  }
}

/**
 * Rasterize the hover outline in source-image pixels.
 * The two-tone, two-pixel ring stays snapped to the source grid and is enlarged
 * with `image-rendering: pixelated`, so high zoom never turns it into a smooth SVG circle.
 */
export function rasterizeBrushOutline(
  canvasWidth: number,
  canvasHeight: number,
  center: Point,
  size: number,
  shape: BrushShape
): BrushOutlineRaster | null {
  const radius = Math.max(1, size / 2)
  const left = Math.max(0, Math.floor(center.x - radius - 2))
  const top = Math.max(0, Math.floor(center.y - radius - 2))
  const right = Math.min(canvasWidth, Math.ceil(center.x + radius + 2))
  const bottom = Math.min(canvasHeight, Math.ceil(center.y + radius + 2))
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return null

  const data = new Uint8ClampedArray(width * height * 4)
  const half = Math.max(0.5, radius - 0.5)

  for (let y = 0; y < height; y++) {
    const py = top + y + 0.5
    for (let x = 0; x < width; x++) {
      const px = left + x + 0.5
      const dx = Math.abs(px - center.x)
      const dy = Math.abs(py - center.y)
      let distance: number
      if (shape === 'square') {
        distance = Math.abs(Math.max(dx, dy) - half)
      } else {
        distance = Math.abs(Math.hypot(dx, dy) - half)
      }
      if (distance > 1.5) continue

      const i = (y * width + x) * 4
      const inner = distance <= 0.55
      const tone = inner ? 255 : 15
      data[i] = tone
      data[i + 1] = tone
      data[i + 2] = tone
      data[i + 3] = 255
    }
  }

  return { data, width, height, left, top }
}

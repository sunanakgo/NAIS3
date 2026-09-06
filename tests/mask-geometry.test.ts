import { describe, expect, it } from 'vitest'
import { rasterizeBrushOutline, zoomAroundPoint } from '../src/renderer/src/lib/mask-geometry'

describe('인페인트 브러시 윤곽', () => {
  it('원형 윤곽을 원본 이미지 픽셀에만 래스터화한다', () => {
    const raster = rasterizeBrushOutline(128, 128, { x: 64, y: 64 }, 28, 'round')!
    expect(Number.isInteger(raster.left)).toBe(true)
    expect(Number.isInteger(raster.top)).toBe(true)
    expect(raster.data.some((value, index) => index % 4 === 3 && value === 255)).toBe(true)

    const centerX = 64 - raster.left
    const centerY = 64 - raster.top
    expect(raster.data[(centerY * raster.width + centerX) * 4 + 3]).toBe(0)
  })

  it('사각 붓도 내부를 가리지 않고 픽셀 경계만 표시한다', () => {
    const raster = rasterizeBrushOutline(64, 64, { x: 32, y: 32 }, 16, 'square')!
    const center = ((32 - raster.top) * raster.width + (32 - raster.left)) * 4 + 3
    const edge = ((32 - raster.top) * raster.width + (24 - raster.left)) * 4 + 3
    expect(raster.data[center]).toBe(0)
    expect(raster.data[edge]).toBe(255)
  })

  it('이미지 가장자리에서 윤곽 버퍼를 캔버스 밖으로 만들지 않는다', () => {
    const raster = rasterizeBrushOutline(32, 32, { x: 1, y: 1 }, 20, 'round')!
    expect(raster.left).toBe(0)
    expect(raster.top).toBe(0)
    expect(raster.left + raster.width).toBeLessThanOrEqual(32)
    expect(raster.top + raster.height).toBeLessThanOrEqual(32)
  })
})

describe('이미지 확대 기준점', () => {
  it('확대 전후 포인터 아래의 이미지 좌표를 유지한다', () => {
    const pointer = { x: 100, y: 50 }
    const currentPan = { x: 10, y: -20 }
    const nextPan = zoomAroundPoint(currentPan, 2, 4, pointer)
    const before = {
      x: (pointer.x - currentPan.x) / 2,
      y: (pointer.y - currentPan.y) / 2
    }
    const after = {
      x: (pointer.x - nextPan.x) / 4,
      y: (pointer.y - nextPan.y) / 4
    }
    expect(after).toEqual(before)
  })

  it('화면 맞춤 배율로 돌아오면 이동값도 초기화한다', () => {
    expect(zoomAroundPoint({ x: 30, y: 20 }, 3, 1, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 })
  })
})

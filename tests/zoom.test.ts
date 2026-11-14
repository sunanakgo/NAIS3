import { describe, expect, it } from 'vitest'
import {
  stepZoomFactor,
  ZOOM_FACTORS,
  zoomCommandForInput,
  type ZoomKeyInput
} from '../src/shared/zoom'

function key(
  code: string,
  value: string,
  mods: Partial<Pick<ZoomKeyInput, 'control' | 'meta' | 'alt'>> = {}
): ZoomKeyInput {
  return { type: 'keyDown', code, key: value, control: false, meta: false, alt: false, ...mods }
}

describe('화면 배율 단축키', () => {
  it('Windows·Linux에서 Ctrl+=, Ctrl+Shift+=(+), 숫자패드 +를 모두 확대로 받는다', () => {
    for (const platform of ['win32', 'linux']) {
      expect(zoomCommandForInput(key('Equal', '=', { control: true }), platform)).toBe('in')
      expect(zoomCommandForInput(key('Equal', '+', { control: true }), platform)).toBe('in')
      expect(zoomCommandForInput(key('NumpadAdd', '+', { control: true }), platform)).toBe('in')
    }
  })

  it('+가 다른 자리에 있는 자판도 key로 받는다', () => {
    expect(zoomCommandForInput(key('BracketRight', '+', { control: true }), 'win32')).toBe('in')
  })

  it('축소와 원래 크기는 일반 키와 숫자패드 모두 받는다', () => {
    expect(zoomCommandForInput(key('Minus', '-', { control: true }), 'win32')).toBe('out')
    expect(zoomCommandForInput(key('NumpadSubtract', '-', { control: true }), 'win32')).toBe('out')
    expect(zoomCommandForInput(key('Digit0', '0', { control: true }), 'win32')).toBe('reset')
    expect(zoomCommandForInput(key('Numpad0', '0', { control: true }), 'win32')).toBe('reset')
  })

  it('macOS는 Cmd를, 다른 OS는 Ctrl을 쓴다', () => {
    expect(zoomCommandForInput(key('Equal', '=', { meta: true }), 'darwin')).toBe('in')
    expect(zoomCommandForInput(key('Equal', '=', { control: true }), 'darwin')).toBeNull()
    expect(zoomCommandForInput(key('Equal', '=', { meta: true }), 'win32')).toBeNull()
  })

  it('수정 키 없는 입력, Alt 조합, keyUp, 다른 키는 건드리지 않는다', () => {
    expect(zoomCommandForInput(key('Equal', '='), 'win32')).toBeNull()
    expect(zoomCommandForInput(key('Equal', '=', { control: true, alt: true }), 'win32')).toBeNull()
    expect(
      zoomCommandForInput({ ...key('Equal', '=', { control: true }), type: 'keyUp' }, 'win32')
    ).toBeNull()
    expect(zoomCommandForInput(key('KeyZ', 'z', { control: true }), 'win32')).toBeNull()
  })
})

describe('화면 배율 단계', () => {
  it('정해진 단계로 한 칸씩 움직이고 양 끝에서 멈춘다', () => {
    expect(stepZoomFactor(1, 'in')).toBe(1.1)
    expect(stepZoomFactor(1, 'out')).toBe(0.9)
    expect(stepZoomFactor(ZOOM_FACTORS[ZOOM_FACTORS.length - 1], 'in')).toBe(2)
    expect(stepZoomFactor(ZOOM_FACTORS[0], 'out')).toBe(0.5)
  })

  it('단계 사이의 배율에서도 가까운 다음 단계로 간다', () => {
    expect(stepZoomFactor(0.6, 'in')).toBe(0.67)
    expect(stepZoomFactor(0.6, 'out')).toBe(0.5)
    expect(stepZoomFactor(0.6699999, 'in')).toBe(0.75)
  })

  it('reset과 잘못된 값은 100%로 돌아간다', () => {
    expect(stepZoomFactor(1.75, 'reset')).toBe(1)
    expect(stepZoomFactor(Number.NaN, 'in')).toBe(1)
  })
})

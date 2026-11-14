export type ZoomCommand = 'in' | 'out' | 'reset'

/** 브라우저처럼 정해진 단계로만 확대·축소한다 — 1(100%)이 항상 단계에 들어 있어 되돌아올 수 있다 */
export const ZOOM_FACTORS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const

const EPSILON = 0.001

export function stepZoomFactor(current: number, command: ZoomCommand): number {
  if (command === 'reset' || !Number.isFinite(current)) return 1
  if (command === 'in') {
    return ZOOM_FACTORS.find((f) => f > current + EPSILON) ?? ZOOM_FACTORS[ZOOM_FACTORS.length - 1]
  }
  return [...ZOOM_FACTORS].reverse().find((f) => f < current - EPSILON) ?? ZOOM_FACTORS[0]
}

/** Electron before-input-event의 Input 중 판정에 쓰는 부분 */
export interface ZoomKeyInput {
  type: string
  key: string
  code: string
  control: boolean
  meta: boolean
  alt: boolean
}

/**
 * Cmd(mac)/Ctrl + =·+·숫자패드 + → 확대, -·숫자패드 - → 축소, 0·숫자패드 0 → 원래 크기.
 * 기본 메뉴의 zoomIn 단축키(CmdOrCtrl+Plus)는 Windows에서 Ctrl+=와 숫자패드 +를 받지 못해
 * 축소만 되고 확대가 안 됐다. key와 code를 함께 봐서 자판 배열과 Shift 여부에 상관없이 받는다.
 */
export function zoomCommandForInput(input: ZoomKeyInput, platform: string): ZoomCommand | null {
  if (input.type !== 'keyDown' || input.alt) return null
  const modifier = platform === 'darwin' ? input.meta : input.control
  if (!modifier) return null
  const { key, code } = input
  if (code === 'Equal' || code === 'NumpadAdd' || key === '+' || key === '=') return 'in'
  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-') return 'out'
  if (code === 'Digit0' || code === 'Numpad0' || key === '0') return 'reset'
  return null
}

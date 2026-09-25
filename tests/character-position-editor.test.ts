// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CharacterPositionEditor } from '../src/renderer/src/components/character-position-editor'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import type { CharacterCard } from '../src/shared/types'

let root: Root
let container: HTMLDivElement
const onPosition = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useLanguageStore.setState({ lang: 'en' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  onPosition.mockReset()
})

it('keeps guide state across language changes and focuses the canvas for keyboard placement', async () => {
  const characters: CharacterCard[] = [1, 2].map((id) => ({
    id,
    name: `Character ${id}`,
    prompt: 'girl',
    negativePrompt: '',
    thumbnail: '',
    enabled: true,
    center: { x: 0.176, y: 0.21 },
    folderId: null
  }))
  await act(async () =>
    root.render(
      h(CharacterPositionEditor, {
        open: true,
        characters,
        selectedId: 1,
        width: 832,
        height: 1216,
        onSelect: vi.fn(),
        onPosition,
        onClose: vi.fn()
      })
    )
  )
  const button = (text: string): HTMLButtonElement =>
    Array.from(document.querySelectorAll('button')).find((item) => item.textContent === text)!
  await act(async () => button('Grid').click())
  await act(async () => useLanguageStore.setState({ lang: 'zh-CN' }))
  expect(button('网格').getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('button[aria-label="增加列数"]')).not.toBeNull()
  await act(async () => useLanguageStore.setState({ lang: 'en' }))
  const increment = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Increase number of Columns"]'
  )!
  await act(async () => increment.click())
  expect(increment.parentElement?.textContent).toContain('4')
  expect(button('Grid').getAttribute('aria-pressed')).toBe('true')

  const canvas = document.querySelector<HTMLDivElement>('[role="application"]')!
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 200,
    width: 500,
    height: 1000,
    right: 600,
    bottom: 1200,
    x: 100,
    y: 200,
    toJSON: () => ({})
  })
  const capture = vi.fn()
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: capture })
  const point = (button: number): PointerEvent =>
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 1,
      isPrimary: true,
      button,
      clientX: 188,
      clientY: 410
    })
  await act(async () => canvas.dispatchEvent(point(2)))
  expect(onPosition).not.toHaveBeenCalled()
  await act(async () => canvas.dispatchEvent(point(0)))
  expect(document.activeElement).toBe(canvas)
  expect(capture).toHaveBeenCalledWith(1)
  expect(onPosition).toHaveBeenLastCalledWith(1, { x: 0.176, y: 0.21 })
  await act(async () =>
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowRight',
        shiftKey: true
      })
    )
  )
  expect(onPosition).toHaveBeenLastCalledWith(1, { x: 0.186, y: 0.21 })
})

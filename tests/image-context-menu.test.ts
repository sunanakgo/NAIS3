vi.mock('../src/renderer/src/components/regenerate-menu-item', () => ({
  RegenerateMenuItem: () => null
}))
// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageContextMenu } from '../src/renderer/src/components/image-context-menu'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  writeText: vi.fn(),
  toast: vi.fn(),
  show: vi.fn()
}))

vi.mock('../src/renderer/src/lib/i18n', () => ({ useT: () => (id: string) => id }))
vi.mock('../src/renderer/src/stores/toast-store', () => ({ toast: mocks.toast }))
vi.mock('../src/renderer/src/stores/director-store', () => ({ openInDirector: vi.fn() }))
vi.mock('../src/renderer/src/stores/library-store', () => ({ addToLibrary: vi.fn() }))
vi.mock('../src/renderer/src/stores/generation-store', () => ({
  setI2iSource: vi.fn(),
  useGenerationStore: () => vi.fn()
}))
vi.mock('../src/renderer/src/stores/metadata-store', () => ({
  useMetadataStore: () => mocks.show
}))
// Expose menu selections as buttons without depending on popup positioning in happy-dom.
vi.mock('../src/renderer/src/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => h('div', null, children),
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => children,
  ContextMenuContent: ({ children }: { children: ReactNode }) => h('div', null, children),
  ContextMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) =>
    h('button', { onClick: onSelect }, children),
  ContextMenuSeparator: () => null
}))

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.resetAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('nais', { invoke: mocks.invoke })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText }
  })
  window.nais = { invoke: mocks.invoke } as typeof window.nais
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(h(ImageContextMenu, { filePath: 'image.png', children: h('img') }))
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function selectCopySeed(): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((el) =>
    el.textContent?.includes('ui.copySeedOnly')
  )!
  await act(async () => button.click())
}

it.each([0, 123456789, 4294967295])('copies only the seed %i as text', async (seed) => {
  mocks.invoke.mockResolvedValue({ meta: { seed, prompt: 'do not copy' } })
  await selectCopySeed()
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('images:readMetadata', {
    filePath: 'image.png'
  })
  expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith(String(seed))
  expect(mocks.toast).toHaveBeenCalledWith('ui.copiedToClipboard', 'success')
  expect(mocks.show).not.toHaveBeenCalled()
})

it.each([undefined, -1, NaN, 1.5])('handles a missing or invalid seed %s', async (seed) => {
  mocks.invoke.mockResolvedValue({ meta: { seed } })
  await selectCopySeed()
  expect(mocks.writeText).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith('ui.imageSeedNotFound', 'info')
})

it('shows metadata read errors without changing the clipboard', async () => {
  mocks.invoke.mockResolvedValue({ error: 'read failed' })
  await selectCopySeed()
  expect(mocks.writeText).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith('read failed', 'error')
})

it.each(['read', 'clipboard'])('reports a rejected %s operation', async (operation) => {
  mocks.invoke.mockResolvedValue({ meta: { seed: 42 } })
  if (operation === 'read') mocks.invoke.mockRejectedValue(new Error('read failed'))
  else mocks.writeText.mockRejectedValue(new Error('clipboard denied'))
  await selectCopySeed()
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('ui.copyImageSeedFailed', 'error')
})

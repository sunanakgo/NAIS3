// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import type { FreeBgRemovalProgress } from '../src/shared/types'
import { DirectorMode } from '../src/renderer/src/components/director-mode'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import { useDirectorStore } from '../src/renderer/src/stores/director-store'
import { useGenerationStore } from '../src/renderer/src/stores/generation-store'
import { useToastStore } from '../src/renderer/src/stores/toast-store'
import './happy-dom-animations'

let root: Root
let container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
let progressListener: ((p: FreeBgRemovalProgress) => void) | null
const off = vi.fn()

const initialDirectorState = useDirectorStore.getState()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  invoke = vi.fn().mockResolvedValue({ value: null })
  progressListener = null
  off.mockClear()
  window.nais = {
    invoke,
    on: (channel: string, listener: (p: FreeBgRemovalProgress) => void) => {
      if (channel === 'images:removeBackgroundFreeProgress') progressListener = listener
      return off
    }
  } as unknown as NaisApi
  vi.spyOn(useGenerationStore.getState(), 'refreshHistory').mockResolvedValue(undefined)
  useLanguageStore.setState({ lang: 'en' })
  useDirectorStore.setState({ ...initialDirectorState, stack: ['AAAA'], loading: false })
  useToastStore.setState({ toasts: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useDirectorStore.setState(initialDirectorState, true)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.trim().startsWith(text)
  )
  if (!found) throw new Error(`button not found: ${text}`)
  return found
}

const click = (el: HTMLElement): Promise<void> => act(async () => el.click())

describe('free background removal tool', () => {
  it('is a free tool that warns about the third-party upload and keeps the paid tool', async () => {
    await act(async () => root.render(h(DirectorMode)))

    const paid = button('Remove BG')
    const free = button('Remove BG (Hugging Face)')
    expect(paid).not.toBe(free)
    expect(free.textContent).toContain('Free')
    expect(free.textContent).toContain('Hugging Face Space')

    await click(free)
    expect(container.textContent).toContain('third parties')
    expect(invoke).not.toHaveBeenCalledWith('images:removeBackgroundFree', expect.anything())
  })

  it('shows Space progress, then pushes the saved result onto the director stack', async () => {
    let resolve!: (v: unknown) => void
    invoke.mockImplementation((channel: string) =>
      channel === 'images:removeBackgroundFree'
        ? new Promise((r) => (resolve = r))
        : Promise.resolve({ value: null })
    )
    await act(async () => root.render(h(DirectorMode)))
    await click(button('Remove BG (Hugging Face)'))
    await click(button('Apply'))

    expect(invoke).toHaveBeenCalledWith('images:removeBackgroundFree', { imageBase64: 'AAAA' })
    expect(invoke).not.toHaveBeenCalledWith('director:run', expect.anything())

    await act(async () => progressListener?.({ space: 'primary', stage: 'queued', position: 2 }))
    expect(container.textContent).toContain('Waiting in the BRIA RMBG 2.0 queue… (position 3)')

    await act(async () => progressListener?.({ space: 'fallback', stage: 'processing' }))
    expect(container.textContent).toContain('Removing background with anime-remove-background…')
    expect(container.textContent).toContain('trying the backup Space')

    await act(async () => resolve({ filePath: '/images/out.png', base64: 'BBBB' }))
    expect(useDirectorStore.getState().stack).toEqual(['AAAA', 'BBBB'])
    expect(useDirectorStore.getState().loading).toBe(false)
    expect(useDirectorStore.getState().freeBgProgress).toBeNull()
    expect(off).toHaveBeenCalled()
  })

  it('shows the translated error as a toast and keeps the image', async () => {
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'images:removeBackgroundFree' ? { error: 'all Spaces failed' } : { value: null }
      )
    )
    await useDirectorStore.getState().removeBackgroundFree()

    expect(useDirectorStore.getState().stack).toEqual(['AAAA'])
    expect(useDirectorStore.getState().loading).toBe(false)
    expect(useToastStore.getState().toasts.map((t) => [t.message, t.type])).toEqual([
      ['all Spaces failed', 'error']
    ])
    expect(off).toHaveBeenCalled()
  })
})

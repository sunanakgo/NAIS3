// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import { DirectorMode } from '../src/renderer/src/components/director-mode'
import { SidePageHost } from '../src/renderer/src/components/side-page-host'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import { useDirectorStore } from '../src/renderer/src/stores/director-store'
import { useSidePageStore } from '../src/renderer/src/stores/side-page-store'
import './happy-dom-animations'

let root: Root
let container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
let run: ReturnType<typeof vi.fn>

const initialDirectorState = useDirectorStore.getState()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  invoke = vi.fn().mockResolvedValue({ value: null })
  window.nais = { invoke, on: () => () => {} } as unknown as NaisApi
  run = vi.fn().mockResolvedValue(undefined)
  useLanguageStore.setState({ lang: 'ko' })
  useDirectorStore.setState({
    ...initialDirectorState,
    stack: ['AAAA'],
    loading: false,
    instantRun: false,
    run
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useDirectorStore.setState(initialDirectorState, true)
  useSidePageStore.setState({ page: null })
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

describe('director tool panel', () => {
  it('selects a tool on click and runs it only from the action button', async () => {
    await act(async () => root.render(h(DirectorMode)))

    await click(button('라인아트'))
    expect(button('라인아트').getAttribute('aria-pressed')).toBe('true')
    expect(run).not.toHaveBeenCalled()

    await click(button('적용'))
    expect(run).toHaveBeenCalledWith('lineart')
  })

  it('passes tool options from the action bar', async () => {
    await act(async () => root.render(h(DirectorMode)))

    await click(button('색칠'))
    await click(button('적용'))
    expect(run).toHaveBeenCalledWith('colorize', { prompt: '', defry: 0 })
  })

  it('runs a tool on a single click when instant run is enabled', async () => {
    useDirectorStore.setState({ instantRun: true })
    await act(async () => root.render(h(DirectorMode)))

    await click(button('스케치'))
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('sketch')
  })
})

describe('director local editor pages', () => {
  const renderWithHost = (): Promise<void> =>
    act(async () => root.render(h(SidePageHost, null, h(DirectorMode))))
  const headings = (): (string | null)[] =>
    [...container.querySelectorAll('h2')].map((el) => el.textContent)

  it('opens pixel art as a free local side page instead of calling the API', async () => {
    await renderWithHost()

    await click(button('도트화'))
    expect(button('도트화').textContent).toContain('무료')
    await click(button('편집기 열기'))
    expect(run).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('director:run', expect.anything())
    // 오버레이 대신 옆 페이지로 넘겨 연다
    await vi.waitFor(() => expect(useSidePageStore.getState().page?.id).toBe('director:pixelate'))
    expect(headings()).toContain('도트화')
  })

  it('opens mosaic on the same page shell and goes back from its header', async () => {
    await renderWithHost()

    await click(button('모자이크'))
    await click(button('편집기 열기'))
    await vi.waitFor(() => expect(useSidePageStore.getState().page?.id).toBe('director:mosaic'))
    expect(headings()).toContain('모자이크')

    await click(container.querySelector<HTMLButtonElement>('button[aria-label="뒤로"]')!)
    expect(useSidePageStore.getState().page).toBeNull()
  })

  it('closes its side page when the director page goes away', async () => {
    await renderWithHost()
    await click(button('모자이크'))
    await click(button('편집기 열기'))
    await vi.waitFor(() => expect(useSidePageStore.getState().page).not.toBeNull())

    await act(async () => root.render(h(SidePageHost, null, h('div'))))
    expect(useSidePageStore.getState().page).toBeNull()
  })

  it('does not open an editor after leaving the director while measuring the image', async () => {
    // 이미지 크기 해독을 손으로 끝낸다 — 그사이 디렉터를 떠나는 상황을 재현
    const pending: { onload: (() => void) | null }[] = []
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        naturalWidth = 8
        naturalHeight = 8
        set src(_: string) {
          pending.push(this)
        }
      }
    )
    const finishDecodes = (): Promise<void> =>
      act(async () => pending.splice(0).forEach((img) => img.onload?.()))

    await renderWithHost()
    await click(button('모자이크'))
    await click(button('편집기 열기'))
    await act(async () => root.render(h(SidePageHost, null, h('div'))))
    await finishDecodes()
    expect(useSidePageStore.getState().page).toBeNull()

    // 머물러 있으면 해독이 끝난 뒤 그대로 열린다
    await renderWithHost()
    await click(button('모자이크'))
    await click(button('편집기 열기'))
    await finishDecodes()
    expect(useSidePageStore.getState().page?.id).toBe('director:mosaic')
  })

  it('leaves pages opened by other screens alone', async () => {
    await renderWithHost()
    useSidePageStore.getState().open({ id: 'other', owner: 'other', render: () => null })

    await act(async () => root.render(h('div')))
    expect(useSidePageStore.getState().page?.id).toBe('other')
  })
})

describe('director instant run preference', () => {
  it('defaults to off and hydrates the stored value', async () => {
    useDirectorStore.setState({ instantRun: false })
    await useDirectorStore.getState().hydrate()
    expect(useDirectorStore.getState().instantRun).toBe(false)

    invoke.mockResolvedValueOnce({ value: '1' })
    await useDirectorStore.getState().hydrate()
    expect(invoke).toHaveBeenCalledWith('settings:get', { key: 'director_instant_run' })
    expect(useDirectorStore.getState().instantRun).toBe(true)
  })

  it('persists changes through the settings store', () => {
    useDirectorStore.getState().setInstantRun(true)
    expect(useDirectorStore.getState().instantRun).toBe(true)
    expect(invoke).toHaveBeenCalledWith('settings:set', { key: 'director_instant_run', value: '1' })
  })
})

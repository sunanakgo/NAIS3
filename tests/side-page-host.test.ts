// @vitest-environment happy-dom
import { act, createElement as h, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidePageHost } from '../src/renderer/src/components/side-page-host'
import {
  useSidePageStore,
  type SidePage,
  type SidePageContext
} from '../src/renderer/src/stores/side-page-store'

import './happy-dom-animations'

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(h(SidePageHost, null, h('button', { id: 'opener' }, 'open editor')))
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useSidePageStore.setState({ page: null })
})

/** 받은 ready 값을 기록하고 적용 버튼 하나를 그리는 페이지 */
function testPage(id: string): { page: SidePage; seen: SidePageContext[] } {
  const seen: SidePageContext[] = []
  const page: SidePage = {
    id,
    render: (ctx) => {
      seen.push(ctx)
      return h(
        'div',
        null,
        h('h2', { tabIndex: -1, 'data-page-focus': '' }, id),
        h('button', { 'data-page': id }, 'apply')
      )
    }
  }
  return { page, seen }
}

/** 페이지 한 장을 감싼 층 (PageLayer) */
const layerOf = (id: string): HTMLElement | null =>
  container.querySelector(`[data-page="${id}"]`)?.parentElement?.parentElement ?? null

describe('SidePageHost', () => {
  it('releases compositing hints and identity transforms when pages settle', async () => {
    const work = container.querySelector<HTMLElement>('#opener')!.parentElement!
    await vi.waitFor(() => {
      expect(work.style.transform).toBe('none')
      expect(work.style.willChange).toBe('auto')
    })

    const { page, seen } = testPage('a')
    await act(async () => useSidePageStore.getState().open(page))
    await vi.waitFor(() => {
      expect(seen.at(-1)?.ready).toBe(true)
      expect(layerOf('a')?.style.transform).toBe('none')
      expect(layerOf('a')?.style.willChange).toBe('auto')
      expect(work.style.willChange).toBe('auto')
    })
    // The covered workspace must still stay behind the open page.
    expect(work.style.transform).toContain('scale(0.94)')

    await act(async () => useSidePageStore.getState().close())
    await vi.waitFor(() => {
      expect(layerOf('a')).toBeNull()
      expect(work.style.transform).toBe('none')
      expect(work.style.willChange).toBe('auto')
    })
  })

  it('settles cleanly when a close is interrupted by another page', async () => {
    await act(async () => useSidePageStore.getState().open(testPage('a').page))
    await act(async () => useSidePageStore.getState().close())
    const { page, seen } = testPage('b')
    await act(async () => useSidePageStore.getState().open(page))
    await vi.waitFor(() => {
      expect(seen.at(-1)?.ready).toBe(true)
      expect(layerOf('a')).toBeNull()
      expect(layerOf('b')?.style.transform).toBe('none')
      expect(layerOf('b')?.style.willChange).toBe('auto')
      const work = container.querySelector<HTMLElement>('#opener')!.parentElement!
      expect(work.style.transform).toContain('scale(0.94)')
      expect(work.style.willChange).toBe('auto')
    })
  })

  it('makes a page inert while it turns away so it cannot be applied twice', async () => {
    const { page, seen } = testPage('a')
    await act(async () => useSidePageStore.getState().open(page))
    await vi.waitFor(() => expect(seen.at(-1)?.ready).toBe(true))
    expect(layerOf('a')?.inert).toBe(false)

    await act(async () => useSidePageStore.getState().close())
    // 덮이는 동안엔 마지막 화면이 남아 있지만 입력은 받지 않는다
    expect(layerOf('a')?.inert).toBe(true)
  })

  it('lets go of a closed page once it has turned away', async () => {
    const { page, seen } = testPage('a')
    await act(async () => useSidePageStore.getState().open(page))
    await vi.waitFor(() => expect(seen.at(-1)?.ready).toBe(true))

    await act(async () => useSidePageStore.getState().close())
    await vi.waitFor(() => expect(layerOf('a')).toBeNull())

    // 같은 페이지를 다시 열면 처음부터 넘긴다 — 덮인 페이지를 쥐고 있었다면 곧바로 ready였다
    seen.length = 0
    await act(async () => useSidePageStore.getState().open(page))
    expect(seen[0]?.ready).toBe(false)
    await vi.waitFor(() => expect(seen.at(-1)?.ready).toBe(true))
  })

  it('opens a fresh page when reopened while the old one is still turning away', async () => {
    // 편집기 안 상태(모자이크의 칠한 칸 기록 등)를 흉내 낸다 — 인스턴스마다 새로 생긴다
    const mounts: number[] = []
    let next = 0
    function Editor(): React.JSX.Element {
      const [instance] = useState(() => ++next)
      useEffect(() => void mounts.push(instance), [instance])
      return h('button', { 'data-page': 'editor', 'data-instance': instance }, 'apply')
    }
    const open = (): SidePage => ({ id: 'editor', render: () => h(Editor) })

    await act(async () => useSidePageStore.getState().open(open()))
    await act(async () => useSidePageStore.getState().close())
    // 덮이는 애니메이션이 끝나기 전에 같은 편집기를 다시 연다 (Esc → Enter)
    await act(async () => useSidePageStore.getState().open(open()))

    expect(mounts).toEqual([1, 2])
    const live = [...container.querySelectorAll<HTMLElement>('[data-page="editor"]')].filter(
      (el) => !el.closest('[inert]')
    )
    expect(live.map((el) => el.dataset.instance)).toEqual(['2'])
  })

  it('moves focus into the page and back to the control that opened it', async () => {
    const opener = container.querySelector<HTMLButtonElement>('#opener')!
    opener.focus()
    const { page } = testPage('a')
    await act(async () => useSidePageStore.getState().open(page))
    // 작업 화면은 inert라 포커스가 남아 있으면 안 된다 — 열린 페이지의 제목으로
    expect(document.activeElement?.textContent).toBe('a')
    expect(document.activeElement?.tagName).toBe('H2')

    await act(async () => useSidePageStore.getState().close())
    expect(document.activeElement).toBe(opener)
  })

  it('keeps the original opener when one page replaces another', async () => {
    const opener = container.querySelector<HTMLButtonElement>('#opener')!
    opener.focus()
    await act(async () => useSidePageStore.getState().open(testPage('a').page))
    await act(async () => useSidePageStore.getState().open(testPage('b').page))
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('b'))

    await act(async () => useSidePageStore.getState().close())
    expect(document.activeElement).toBe(opener)
  })
})

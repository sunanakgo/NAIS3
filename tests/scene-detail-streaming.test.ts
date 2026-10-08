// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueStatus, Scene, SceneImage } from '../src/shared/types'
import { SceneDetail } from '../src/renderer/src/components/scene-detail'
import { useGenerationStore } from '../src/renderer/src/stores/generation-store'
import { useScenesStore } from '../src/renderer/src/stores/scenes-store'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import type { NaisApi } from '../src/preload'

// Grid tiles render inside ImageContextMenu — count its renders to see whether frames touch the grid
const tileRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('../src/renderer/src/components/image-context-menu', async () => {
  const { createElement } = await import('react')
  return {
    ImageContextMenu: ({ children }: { children: React.ReactNode }) => {
      tileRenders.count++
      return createElement('div', null, children)
    }
  }
})

const SCENE: Scene = {
  id: 7,
  presetId: 1,
  name: 'Scene',
  prompt: '',
  negativePrompt: '',
  width: 832,
  height: 1216,
  reserveCount: 0,
  reserves: {},
  thumbnail: '',
  thumbnailPath: '',
  imageCount: 1,
  hasFavorite: false
}

const image = (id: number): SceneImage => ({
  id,
  filePath: `/scene/${id}.png`,
  thumbnail: '',
  seed: null,
  favorite: false
})

function queue(generating: boolean): QueueStatus {
  return {
    items: [
      {
        id: 'q1',
        state: generating ? 'generating' : 'done',
        request: { sceneId: SCENE.id } as QueueStatus['items'][number]['request']
      }
    ],
    running: generating,
    delayMs: 0
  }
}

const streamSrcs = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('img')]
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => src.startsWith('data:image/png'))

describe('SceneDetail streaming tile', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    window.nais = {
      invoke: vi.fn(async () => ({ counts: [], items: [], total: 0 }))
    } as unknown as NaisApi
    useLanguageStore.setState({ lang: 'en' })
    useScenesStore.setState({ images: [image(1)], imagesTotal: 1, imagesLoading: false })
    useGenerationStore.setState({ queue: queue(true), previewPng: null })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('shows the latest frame while streaming and holds it after streaming ends', async () => {
    await act(async () => root.render(h(SceneDetail, { scene: SCENE })))
    expect(streamSrcs(container)).toEqual([])

    await act(async () => useGenerationStore.setState({ previewPng: 'AAA' }))
    expect(streamSrcs(container)).toEqual(['data:image/png;base64,AAA'])

    await act(async () => useGenerationStore.setState({ previewPng: 'BBB' }))
    expect(streamSrcs(container)).toEqual(['data:image/png;base64,BBB'])

    // Item finished: the store clears the frame, the tile keeps the last one until the image loads
    await act(async () => useGenerationStore.setState({ queue: queue(false), previewPng: null }))
    expect(streamSrcs(container)).toEqual(['data:image/png;base64,BBB'])
  })

  it('does not re-render the image grid for each streamed frame', async () => {
    await act(async () => root.render(h(SceneDetail, { scene: SCENE })))
    await act(async () => useGenerationStore.setState({ previewPng: 'AAA' }))
    const before = tileRenders.count

    for (const frame of ['BBB', 'CCC', 'DDD']) {
      await act(async () => useGenerationStore.setState({ previewPng: frame }))
    }
    expect(streamSrcs(container)).toEqual(['data:image/png;base64,DDD'])
    expect(tileRenders.count).toBe(before)
  })

  it('shows no streaming tile when streaming ends without any frame', async () => {
    await act(async () => root.render(h(SceneDetail, { scene: SCENE })))
    await act(async () => useGenerationStore.setState({ queue: queue(false) }))
    expect(streamSrcs(container)).toEqual([])
    expect(container.querySelector('.ring-accent\\/50')).toBeNull()
  })
})

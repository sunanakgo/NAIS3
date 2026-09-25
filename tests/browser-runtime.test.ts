import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import { emptyState, type BrowserState } from '../src/renderer/src/browser/browser-db'
import { importBrowserWorkspace } from '../src/renderer/src/browser/browser-workspace'
import type { GenerationRequest } from '../src/shared/types'

const DEFAULT_REQUEST: GenerationRequest = {
  prompt: '',
  negativePrompt: '',
  model: 'nai-diffusion-5-full',
  width: 832,
  height: 1216,
  steps: 23,
  cfgScale: 7,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  seed: 42,
  variety: false,
  qualityToggle: false,
  ucPreset: 1,
  characterPrompts: [],
  useCoords: false
}

let state: BrowserState
const readState = vi.hoisted(() => vi.fn())
const mutateState = vi.hoisted(() => vi.fn())
vi.mock('../src/renderer/src/browser/browser-db', async (original) => ({
  ...(await original<typeof import('../src/renderer/src/browser/browser-db')>()),
  readBrowserState: readState,
  mutateBrowserState: mutateState
}))

let api: NaisApi
let download: { href: string; download: string; click: () => void }
beforeAll(async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { createElement: () => download })
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 64
      naturalHeight = 64
      onload?: () => void
      set src(_value: string) {
        this.onload?.()
      }
    }
  )
  await import('../src/renderer/src/browser/install-browser-api')
  api = window.nais
})
beforeEach(() => {
  state = emptyState()
  download = { href: '', download: '', click: vi.fn() }
  readState.mockImplementation(async () => state)
  mutateState.mockImplementation(async (mutator) => mutator(state))
  state.accounts = [
    {
      id: 'account',
      label: 'Private account',
      token: 'SECRET_API_TOKEN',
      active: true,
      prefix: 'SECR',
      suffix: 'OKEN',
      length: 16
    }
  ]
  state.activeAccountId = 'account'
})

describe('browser runtime regressions', () => {
  it('exports portable data without credentials and preserves local accounts on import', async () => {
    state.settings = {
      main_params: '{"prompt":"hello"}',
      scene_casts: '[]',
      nai_token: 'SECRET_SETTING'
    }
    await api.invoke('backup:export', undefined)
    const json = Buffer.from(download.href.split(',')[1], 'base64').toString('utf8')
    expect(json).not.toContain('SECRET')
    expect(json).not.toContain('Private account')
    const restored = emptyState()
    restored.accounts = state.accounts
    restored.activeAccountId = state.activeAccountId
    importBrowserWorkspace(restored, JSON.parse(json))
    expect(restored.settings.main_params).toContain('hello')
    expect(restored.accounts[0].token).toBe('SECRET_API_TOKEN')
    expect(restored.activeAccountId).toBe('account')
    expect(() => importBrowserWorkspace(restored, { _app: 'NAIS3', tables: {} })).toThrow()
  })

  it('does not import credentials from legacy browser backups', () => {
    const legacy = emptyState()
    legacy.accounts = [{ ...state.accounts[0], token: 'FOREIGN_TOKEN' }]
    legacy.activeAccountId = 'foreign'
    importBrowserWorkspace(state, legacy)
    expect(state.accounts[0].token).toBe('SECRET_API_TOKEN')
    expect(state.activeAccountId).toBe('account')
  })

  it('reads and saves imported library images even without history entries', async () => {
    state.libraryImages = [
      {
        id: 1,
        name: 'import.png',
        filePath: 'data:image/png;base64,YQ==',
        base64: 'YQ==',
        thumbnail: 'YQ==',
        width: 64,
        height: 64,
        stackId: null
      }
    ]
    const filePath = state.libraryImages[0].filePath
    expect(await api.invoke('images:readForSource', { filePath })).toEqual({
      base64: 'YQ==',
      width: 64,
      height: 64
    })
    expect(await api.invoke('images:saveAs', { filePath })).toEqual({ saved: true })
    expect(download.href).toBe(filePath)
  })

  it('expands split, character, and sequential prompts at generation time without consuming preview counters', async () => {
    state.fragments = [{ id: 1, name: 'Words', content: 'first\nsecond', folderId: null }]
    const generated: {
      request: { prompt: string; characterPrompts: { prompt: string }[] }
      vibes: unknown[]
    }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body))
        if (url.endsWith('/tokens')) return Response.json({ counts: [1] })
        if (url.endsWith('/generate')) {
          generated.push(body)
          return Response.json({ base64: 'YQ==', payloadJson: '{}', vibeEncodings: [] })
        }
        return Response.json({ anlas: 100, tier: 'opus' })
      })
    )
    await api.invoke('frags:resetSequential', undefined)
    await api.invoke('tokens:count', { texts: ['<*Words>'] })
    await api.invoke('gen:setDelay', { ms: 0 })
    const { ids } = await api.invoke('queue:enqueue', {
      request: {
        ...DEFAULT_REQUEST,
        seed: 42,
        promptParts: { base: '# <*Words>\n<*Words>', additional: '', detail: '' },
        characterPrompts: [{ prompt: '<Words>', negativePrompt: '<a|a>', enabled: true }]
      },
      count: 2
    })
    await vi.waitFor(async () => {
      const queue = await api.invoke('queue:status', undefined)
      expect(queue.items.filter((item) => ids.includes(item.id)).map((item) => item.state)).toEqual(
        ['done', 'done']
      )
      expect(queue.running).toBe(false)
    })
    expect(generated.map((item) => item.request.prompt.trim())).toEqual(['first', 'second'])
    expect(generated[0].request.characterPrompts[0].prompt).toMatch(/^(first|second)$/)
  })

  it('chooses a random character independently for each queued browser generation', async () => {
    const generated: { request: { characterPrompts: { prompt: string }[] } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body))
        if (url.endsWith('/generate')) {
          generated.push(body)
          return Response.json({ base64: 'YQ==', payloadJson: '{}', vibeEncodings: [] })
        }
        return Response.json({ anlas: 100, tier: 'opus' })
      })
    )
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.9)
    await api.invoke('gen:setDelay', { ms: 0 })

    const { ids } = await api.invoke('queue:enqueue', {
      request: {
        ...DEFAULT_REQUEST,
        seed: 42,
        characterPrompts: [{ prompt: 'previous', negativePrompt: '', enabled: true }]
      },
      count: 2,
      randomCharacterPrompts: [
        { prompt: 'alpha', negativePrompt: '', enabled: true },
        { prompt: 'beta', negativePrompt: '', enabled: true }
      ]
    })
    await vi.waitFor(async () => {
      const status = await api.invoke('queue:status', undefined)
      expect(
        status.items.filter((item) => ids.includes(item.id)).map((item) => item.state)
      ).toEqual(['done', 'done'])
    })

    expect(generated.map((item) => item.request.characterPrompts[0].prompt)).toEqual([
      'alpha',
      'beta'
    ])
    random.mockRestore()
  })
})

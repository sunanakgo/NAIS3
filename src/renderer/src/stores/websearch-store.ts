import { create } from 'zustand'

/** 웹 검색(인앱 브라우저) — 퀵링크/줌/마지막 URL persist */

export interface QuickLink {
  name: string
  url: string
}

export const HOME_URL = 'https://hijiribe.donmai.us'

const DEFAULT_LINKS: QuickLink[] = [
  { name: 'Danbooru', url: HOME_URL },
  { name: 'novelai.app', url: 'https://novelai.app' },
  { name: '구글 번역', url: 'https://translate.google.com/?sl=ko&tl=en&op=translate' }
]

interface WebSearchState {
  /** 마지막 URL — 탭 전환/재시작 후 복원 */
  url: string
  /** 줌 배율 0.25~3.0 */
  zoom: number
  quickLinks: QuickLink[]
  loaded: boolean
  setUrl: (url: string) => void
  setZoom: (zoom: number) => void
  addQuickLink: (link: QuickLink) => void
  removeQuickLink: (index: number) => void
  hydrate: () => Promise<void>
}

export const useWebSearchStore = create<WebSearchState>((set, get) => ({
  url: HOME_URL,
  zoom: 1,
  quickLinks: DEFAULT_LINKS,
  loaded: false,

  setUrl: (url) => {
    set({ url })
    void window.nais.invoke('settings:set', { key: 'websearch_last_url', value: url })
  },
  setZoom: (zoom) => {
    const clamped = Math.min(3, Math.max(0.25, Math.round(zoom * 100) / 100))
    set({ zoom: clamped })
    void window.nais.invoke('settings:set', { key: 'websearch_zoom', value: String(clamped) })
  },
  addQuickLink: (link) => {
    const quickLinks = [...get().quickLinks, link]
    set({ quickLinks })
    void window.nais.invoke('settings:set', {
      key: 'websearch_quicklinks',
      value: JSON.stringify(quickLinks)
    })
  },
  removeQuickLink: (index) => {
    const quickLinks = get().quickLinks.filter((_, i) => i !== index)
    set({ quickLinks })
    void window.nais.invoke('settings:set', {
      key: 'websearch_quicklinks',
      value: JSON.stringify(quickLinks)
    })
  },

  hydrate: async () => {
    const [url, zoom, links] = await Promise.all([
      window.nais.invoke('settings:get', { key: 'websearch_last_url' }),
      window.nais.invoke('settings:get', { key: 'websearch_zoom' }),
      window.nais.invoke('settings:get', { key: 'websearch_quicklinks' })
    ])
    set({
      url: url.value || HOME_URL,
      zoom: zoom.value ? Number(zoom.value) : 1,
      quickLinks: links.value ? (JSON.parse(links.value) as QuickLink[]) : DEFAULT_LINKS,
      loaded: true
    })
  }
}))

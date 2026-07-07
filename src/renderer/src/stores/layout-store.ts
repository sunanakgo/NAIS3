import { create } from 'zustand'
import { recordNav } from '../lib/nav-history'

export type CenterMode = 'main' | 'scene' | 'director'

interface LayoutState {
  leftOpen: boolean
  rightOpen: boolean
  settingsOpen: boolean
  centerMode: CenterMode
  toggleLeft: () => void
  toggleRight: () => void
  setSettingsOpen: (open: boolean) => void
  setCenterMode: (mode: CenterMode) => void
  hydrate: () => Promise<void>
}

function persist(key: string, value: boolean): void {
  void window.nais.invoke('settings:set', { key, value: value ? '1' : '0' })
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  leftOpen: true,
  rightOpen: true,
  settingsOpen: false,
  centerMode: 'main',
  setCenterMode: (centerMode) => {
    if (centerMode !== get().centerMode) recordNav() // 마우스 뒤로/앞으로용 히스토리
    set({ centerMode })
  },
  toggleLeft: () => {
    const leftOpen = !get().leftOpen
    set({ leftOpen })
    persist('ui_left_open', leftOpen)
  },
  toggleRight: () => {
    const rightOpen = !get().rightOpen
    set({ rightOpen })
    persist('ui_right_open', rightOpen)
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  hydrate: async () => {
    const [left, right] = await Promise.all([
      window.nais.invoke('settings:get', { key: 'ui_left_open' }),
      window.nais.invoke('settings:get', { key: 'ui_right_open' })
    ])
    set({ leftOpen: left.value !== '0', rightOpen: right.value !== '0' })
  }
}))

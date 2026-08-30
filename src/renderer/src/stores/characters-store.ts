import { create } from 'zustand'
import type { CharacterCard, CharacterCardPatch, ListFolder } from '@shared/types'
import { canonicalize, moveRow, toOrderEntries } from '../lib/folder-list'
import { t } from '../lib/i18n'

/**
 * 캐릭터 단일 리스트 모델 (공용 폴더 리스트 로직 사용):
 * - 카드가 직접 enabled(생성 포함)·위치·순서를 가진다
 * - 수백 개 전제: 시작 시 1회 로드, 변경은 낙관적 패치 + 즉시 IPC
 */
interface CharactersState {
  folders: ListFolder[]
  items: CharacterCard[]
  loaded: boolean
  overlayOpen: boolean
  toggleOverlay: () => void
  setOverlayOpen: (open: boolean) => void
  load: () => Promise<void>
  createCard: (folderId: number | null, maxCharacters?: number) => Promise<void>
  updateCard: (id: number, patch: CharacterCardPatch, maxCharacters?: number) => void
  /** 활성 캐릭터 전체 해제 */
  disableAll: () => void
  removeCard: (id: number) => void
  duplicateCard: (id: number) => Promise<void>
  pickThumbnail: (id: number) => Promise<void>
  clearThumbnail: (id: number) => Promise<void>
  createFolder: (name: string) => Promise<void>
  renameFolder: (id: number, name: string) => void
  toggleCollapse: (id: number) => void
  setFolderColor: (id: number, color: string | null) => void
  removeFolder: (id: number) => void
  move: (activeKey: string, overKey: string) => void
  /** 메타데이터의 캐릭터를 라이브러리로 가져오기 (기존 enabled는 모두 해제 후 새로 추가) */
  importFromMetadata: (
    chars: { prompt: string; negativePrompt: string; center?: { x: number; y: number } }[],
    maxCharacters?: number
  ) => Promise<void>
}

export const useCharactersStore = create<CharactersState>((set, get) => ({
  folders: [],
  items: [],
  loaded: false,
  overlayOpen: false,
  toggleOverlay: () => set({ overlayOpen: !get().overlayOpen }),
  setOverlayOpen: (overlayOpen) => set({ overlayOpen }),

  load: async () => {
    const { folders, items } = await window.nais.invoke('chars:list', undefined)
    set({ folders, items: canonicalize(folders, items), loaded: true })
  },

  createCard: async (folderId, maxCharacters = 6) => {
    const { id } = await window.nais.invoke('chars:create', { name: '', folderId })
    const enabled = get().items.filter((c) => c.enabled && c.prompt.trim()).length < maxCharacters
    const card: CharacterCard = {
      id,
      name: '',
      prompt: '',
      negativePrompt: '',
      thumbnail: '',
      enabled,
      center: { x: 0.5, y: 0.5 },
      folderId
    }
    const { folders, items } = get()
    const next = canonicalize(folders, [...items, card])
    set({ items: next })
    get().updateCard(id, { enabled }, maxCharacters)
    void window.nais.invoke('chars:reorder', { order: toOrderEntries(folders, next) })
  },

  updateCard: (id, patch, maxCharacters = 6) => {
    if (patch.enabled === true) {
      const enabledCount = get().items.filter(
        (c) => c.enabled && c.prompt.trim() && c.id !== id
      ).length
      if (enabledCount >= maxCharacters) return
    }
    set({ items: get().items.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
    void window.nais.invoke('chars:update', { id, patch })
  },

  disableAll: () => {
    const enabled = get().items.filter((c) => c.enabled)
    if (!enabled.length) return
    set({ items: get().items.map((c) => (c.enabled ? { ...c, enabled: false } : c)) })
    for (const c of enabled)
      void window.nais.invoke('chars:update', { id: c.id, patch: { enabled: false } })
  },

  removeCard: (id) => {
    set({ items: get().items.filter((c) => c.id !== id) })
    void window.nais.invoke('chars:delete', { id })
  },

  duplicateCard: async (id) => {
    await window.nais.invoke('chars:duplicate', { id })
    await get().load()
  },

  pickThumbnail: async (id) => {
    const { thumbnail } = await window.nais.invoke('chars:pickThumbnail', { id })
    if (thumbnail === null) return
    set({ items: get().items.map((c) => (c.id === id ? { ...c, thumbnail } : c)) })
  },
  clearThumbnail: async (id) => {
    set({ items: get().items.map((c) => (c.id === id ? { ...c, thumbnail: '' } : c)) })
    await window.nais.invoke('chars:clearThumbnail', { id })
  },

  createFolder: async (name) => {
    const { id } = await window.nais.invoke('chars:folderCreate', { name })
    set({ folders: [...get().folders, { id, name, collapsed: false, color: null }] })
  },

  renameFolder: (id, name) => {
    set({ folders: get().folders.map((f) => (f.id === id ? { ...f, name } : f)) })
    void window.nais.invoke('chars:folderRename', { id, name })
  },

  toggleCollapse: (id) => {
    const folder = get().folders.find((f) => f.id === id)
    if (!folder) return
    set({
      folders: get().folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
    })
    void window.nais.invoke('chars:folderCollapse', { id, collapsed: !folder.collapsed })
  },

  setFolderColor: (id, color) => {
    set({ folders: get().folders.map((f) => (f.id === id ? { ...f, color } : f)) })
    void window.nais.invoke('chars:folderColor', { id, color })
  },

  removeFolder: (id) => {
    const { folders, items } = get()
    const nextItems = items.map((c) => (c.folderId === id ? { ...c, folderId: null } : c))
    const nextFolders = folders.filter((f) => f.id !== id)
    set({ folders: nextFolders, items: canonicalize(nextFolders, nextItems) })
    void window.nais.invoke('chars:folderDelete', { id })
  },

  importFromMetadata: async (chars, maxCharacters = 6) => {
    // 1) 기존 enabled 캐릭터 모두 해제 (메타 재현 = 정확히 그 캐릭터만)
    for (const c of get().items) if (c.enabled) get().updateCard(c.id, { enabled: false })
    // 2) 메타 캐릭터를 모델별 상한까지 새 카드로 생성
    for (let i = 0; i < Math.min(chars.length, maxCharacters); i++) {
      const ch = chars[i]
      const { id } = await window.nais.invoke('chars:create', {
        name: t('ui.importedCharacterValue', i + 1),
        folderId: null
      })
      const card: CharacterCard = {
        id,
        name: t('ui.importedCharacterValue', i + 1),
        prompt: ch.prompt,
        negativePrompt: ch.negativePrompt,
        thumbnail: '',
        enabled: true,
        center: ch.center ?? { x: 0.5, y: 0.5 },
        folderId: null
      }
      set({ items: canonicalize(get().folders, [...get().items, card]) })
      get().updateCard(
        id,
        {
          name: card.name,
          prompt: card.prompt,
          negativePrompt: card.negativePrompt,
          enabled: true,
          center: card.center
        },
        maxCharacters
      )
    }
  },

  move: (activeKey, overKey) => {
    const { folders, items } = get()
    const next = moveRow(folders, items, activeKey, overKey)
    set(next)
    void window.nais.invoke('chars:reorder', { order: toOrderEntries(next.folders, next.items) })
  }
}))

/** 생성에 포함될 캐릭터 (정규 순서 = v4 use_order 순서) */
export function enabledCharacters(): CharacterCard[] {
  return useCharactersStore.getState().items.filter((c) => c.enabled && c.prompt.trim())
}

import { create } from 'zustand'
import type { Fragment, ListFolder } from '@shared/types'
import { canonicalize, moveRow, toOrderEntries } from '../lib/folder-list'
import { t } from '../lib/i18n'

interface FragmentsState {
  folders: ListFolder[]
  items: Fragment[]
  loaded: boolean
  overlayOpen: boolean
  setOverlayOpen: (open: boolean) => void
  load: () => Promise<void>
  create: (folderId: number | null) => Promise<number>
  update: (id: number, patch: { name?: string; content?: string }) => void
  remove: (id: number) => void
  createFolder: (name: string) => Promise<void>
  renameFolder: (id: number, name: string) => void
  toggleCollapse: (id: number) => void
  setFolderColor: (id: number, color: string | null) => void
  removeFolder: (id: number) => void
  move: (activeKey: string, overKey: string) => void
  importTxt: () => Promise<number>
  exportTxt: (id: number) => Promise<void>
  exportAll: () => Promise<number>
  duplicate: (id: number) => Promise<void>
  /** 순차 선택(<*이름>) 카운터 리셋 — 다시 첫 줄부터 (NAIS2 기능) */
  resetSequential: () => Promise<void>
}

export const useFragmentsStore = create<FragmentsState>((set, get) => ({
  folders: [],
  items: [],
  loaded: false,
  overlayOpen: false,
  setOverlayOpen: (overlayOpen) => set({ overlayOpen }),

  load: async () => {
    const { folders, items } = await window.nais.invoke('frags:list', undefined)
    set({ folders, items: canonicalize(folders, items), loaded: true })
  },

  create: async (folderId) => {
    const { id } = await window.nais.invoke('frags:create', { name: t('ui.newFragment'), folderId })
    await get().load() // 이름 중복 처리(name-2 등)가 메인에서 일어나므로 재로드
    return id
  },

  update: (id, patch) => {
    set({ items: get().items.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
    void window.nais.invoke('frags:update', { id, patch })
  },

  remove: (id) => {
    set({ items: get().items.filter((f) => f.id !== id) })
    void window.nais.invoke('frags:delete', { id })
  },

  createFolder: async (name) => {
    const { id } = await window.nais.invoke('frags:folderCreate', { name })
    set({ folders: [...get().folders, { id, name, collapsed: false, color: null }] })
  },

  renameFolder: (id, name) => {
    set({ folders: get().folders.map((f) => (f.id === id ? { ...f, name } : f)) })
    void window.nais.invoke('frags:folderRename', { id, name })
  },

  toggleCollapse: (id) => {
    const folder = get().folders.find((f) => f.id === id)
    if (!folder) return
    set({
      folders: get().folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
    })
    void window.nais.invoke('frags:folderCollapse', { id, collapsed: !folder.collapsed })
  },

  setFolderColor: (id, color) => {
    set({ folders: get().folders.map((f) => (f.id === id ? { ...f, color } : f)) })
    void window.nais.invoke('frags:folderColor', { id, color })
  },

  removeFolder: (id) => {
    const { folders, items } = get()
    const nextItems = items.map((c) => (c.folderId === id ? { ...c, folderId: null } : c))
    const nextFolders = folders.filter((f) => f.id !== id)
    set({ folders: nextFolders, items: canonicalize(nextFolders, nextItems) })
    void window.nais.invoke('frags:folderDelete', { id })
  },

  move: (activeKey, overKey) => {
    const { folders, items } = get()
    const next = moveRow(folders, items, activeKey, overKey)
    set(next)
    void window.nais.invoke('frags:reorder', { order: toOrderEntries(next.folders, next.items) })
  },

  importTxt: async () => {
    const { count } = await window.nais.invoke('frags:importTxt', undefined)
    if (count > 0) await get().load()
    return count
  },

  exportTxt: async (id) => {
    await window.nais.invoke('frags:exportTxt', { id })
  },

  exportAll: async () => {
    const { count } = await window.nais.invoke('frags:exportAll', undefined)
    return count
  },

  duplicate: async (id) => {
    await window.nais.invoke('frags:duplicate', { id })
    await get().load()
  },

  resetSequential: async () => {
    await window.nais.invoke('frags:resetSequential', undefined)
  }
}))

/** 자동완성용: `<검색어`에 매칭되는 조각 경로 목록 */
export function fragmentPaths(query: string): string[] {
  const q = query.toLowerCase()
  const { items, folders } = useFragmentsStore.getState()
  const folderName = new Map(folders.map((f) => [f.id, f.name]))
  const paths = items.flatMap((f) => {
    const folder = f.folderId != null ? folderName.get(f.folderId) : null
    return folder ? [`${folder}/${f.name}`, f.name] : [f.name]
  })
  return [...new Set(paths)].filter((p) => p.toLowerCase().includes(q)).slice(0, 8)
}

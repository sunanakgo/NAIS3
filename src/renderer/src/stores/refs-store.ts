import { create } from 'zustand'
import type { CharRefItem, CharRefType, ListFolder, VibeItem } from '@shared/types'
import { canonicalize, moveRow, toOrderEntries } from '../lib/folder-list'

/**
 * 바이브 / 캐릭터 레퍼런스 라이브러리 스토어 팩토리.
 * 두 라이브러리가 완전히 같은 폴더 리스트 구조라 하나의 팩토리로 만든다.
 */

interface RefsState<T extends { id: number; folderId: number | null }> {
  folders: ListFolder[]
  items: T[]
  loaded: boolean
  overlayOpen: boolean
  toggleOverlay: () => void
  setOverlayOpen: (open: boolean) => void
  load: () => Promise<void>
  add: (folderId: number | null) => Promise<void>
  update: (id: number, patch: Record<string, unknown>) => void
  remove: (id: number) => void
  duplicate: (id: number) => Promise<void>
  createFolder: (name: string) => Promise<void>
  renameFolder: (id: number, name: string) => void
  toggleCollapse: (id: number) => void
  setFolderColor: (id: number, color: string | null) => void
  removeFolder: (id: number) => void
  move: (activeKey: string, overKey: string) => void
}

function makeRefsStore<T extends { id: number; folderId: number | null }>(ns: string) {
  const ch = {
    list: `${ns}:list`,
    add: `${ns}:add`,
    update: `${ns}:update`,
    delete: `${ns}:delete`,
    duplicate: `${ns}:duplicate`,
    reorder: `${ns}:reorder`,
    folderCreate: `${ns}:folderCreate`,
    folderRename: `${ns}:folderRename`,
    folderCollapse: `${ns}:folderCollapse`,
    folderColor: `${ns}:folderColor`,
    folderDelete: `${ns}:folderDelete`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  // 슬라이더 드래그가 포인터 이동마다 update를 부르므로 IPC(DB 쓰기)만 디바운스 —
  // 화면 반영(set)은 즉시, 저장은 항목별로 마지막 값만 보낸다
  const pendingPatch = new Map<number, Record<string, unknown>>()
  const patchTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const flushPatch = (id: number): void => {
    const patch = pendingPatch.get(id)
    pendingPatch.delete(id)
    patchTimers.delete(id)
    if (patch) void window.nais.invoke(ch.update, { id, patch })
  }

  return create<RefsState<T>>((set, get) => ({
    folders: [],
    items: [],
    loaded: false,
    overlayOpen: false,
    toggleOverlay: () => set({ overlayOpen: !get().overlayOpen }),
    setOverlayOpen: (overlayOpen) => set({ overlayOpen }),

    load: async () => {
      const { folders, items } = await window.nais.invoke(ch.list, undefined)
      set({ folders, items: canonicalize(folders, items as T[]), loaded: true })
    },
    add: async (folderId) => {
      const { count } = await window.nais.invoke(ch.add, { folderId })
      if (count > 0) await get().load()
    },
    update: (id, patch) => {
      set({ items: get().items.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
      pendingPatch.set(id, { ...(pendingPatch.get(id) ?? {}), ...patch })
      clearTimeout(patchTimers.get(id))
      patchTimers.set(
        id,
        setTimeout(() => flushPatch(id), 250)
      )
    },
    duplicate: async (id) => {
      await window.nais.invoke(ch.duplicate, { id })
      await get().load()
    },
    remove: (id) => {
      clearTimeout(patchTimers.get(id))
      pendingPatch.delete(id)
      set({ items: get().items.filter((c) => c.id !== id) })
      void window.nais.invoke(ch.delete, { id })
    },
    createFolder: async (name) => {
      const { id } = await window.nais.invoke(ch.folderCreate, { name })
      set({ folders: [...get().folders, { id, name, collapsed: false, color: null }] })
    },
    renameFolder: (id, name) => {
      set({ folders: get().folders.map((f) => (f.id === id ? { ...f, name } : f)) })
      void window.nais.invoke(ch.folderRename, { id, name })
    },
    toggleCollapse: (id) => {
      const folder = get().folders.find((f) => f.id === id)
      if (!folder) return
      set({
        folders: get().folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
      })
      void window.nais.invoke(ch.folderCollapse, { id, collapsed: !folder.collapsed })
    },
    setFolderColor: (id, color) => {
      set({ folders: get().folders.map((f) => (f.id === id ? { ...f, color } : f)) })
      void window.nais.invoke(ch.folderColor, { id, color })
    },
    removeFolder: (id) => {
      const { folders, items } = get()
      const nextItems = items.map((c) => (c.folderId === id ? { ...c, folderId: null } : c))
      const nextFolders = folders.filter((f) => f.id !== id)
      set({ folders: nextFolders, items: canonicalize(nextFolders, nextItems) })
      void window.nais.invoke(ch.folderDelete, { id })
    },
    move: (activeKey, overKey) => {
      const { folders, items } = get()
      const next = moveRow(folders, items, activeKey, overKey)
      set(next)
      void window.nais.invoke(ch.reorder, { order: toOrderEntries(next.folders, next.items) })
    }
  }))
}

export const useVibesStore = makeRefsStore<VibeItem>('vibes')
export const useCharRefsStore = makeRefsStore<CharRefItem>('crefs')

/** 오버레이가 kind로 스토어를 고를 때 쓰는 공통 타입 (두 스토어의 아이템 유니온) */
export type AnyRefsStore = ReturnType<typeof makeRefsStore<VibeItem | CharRefItem>>
export function refsStoreFor(kind: 'vibe' | 'charref'): AnyRefsStore {
  return (kind === 'vibe' ? useVibesStore : useCharRefsStore) as unknown as AnyRefsStore
}

export const CHARREF_TYPES: { value: CharRefType; label: string }[] = [
  { value: 'character', label: 'Character' },
  { value: 'style', label: 'Style' },
  { value: 'character&style', label: 'Character & Style' },
  { value: 'costume', label: 'Costume' },
  { value: 'delta', label: 'Delta' }
]

export function enabledRefCount(): { vibes: number; crefs: number } {
  return {
    vibes: useVibesStore.getState().items.filter((v) => v.enabled).length,
    crefs: useCharRefsStore.getState().items.filter((c) => c.enabled).length
  }
}

import { create } from 'zustand'
import type { LibraryImage, LibraryStack } from '@shared/types'
import { toast } from './toast-store'

const PAGE = 80 // 페이지 크기 (수만 장 대비: 한 번에 전부 로드 금지 — 씬 상세와 동일)
let loadSeq = 0 // load() 비동기 응답 순서 보장용
let selectionAnchor: number | null = null // 쉬프트 범위 선택 기준점

interface LibraryState {
  stacks: LibraryStack[]
  images: LibraryImage[]
  total: number
  loading: boolean
  loaded: boolean
  /** null = 루트, 값 = 열려 있는 스택 */
  currentStack: LibraryStack | null
  columns: number // 2~5
  cardOrientation: 'portrait' | 'landscape' | 'square' // 카드 비율 고정 (씬 모드와 동일)
  editMode: boolean
  selection: Set<number>

  load: (reset: boolean) => Promise<void>
  openStack: (stack: LibraryStack | null) => void
  setColumns: (n: number) => void
  setCardOrientation: (o: 'portrait' | 'landscape' | 'square') => void
  setEditMode: (v: boolean) => void
  toggleSelected: (id: number) => void
  /** 쉬프트 클릭 — 마지막 클릭 이미지와 이 이미지 사이(양끝 포함)를 모두 선택 */
  rangeSelect: (id: number) => void
  selectAll: () => void
  clearSelection: () => void

  /** 드래그 정렬 — 로드된 이미지들의 새 id 순서 반영 (낙관적) */
  reorder: (ids: number[]) => Promise<void>
  importDialog: () => Promise<void>
  importPaths: (filePaths: string[]) => Promise<void>
  importBase64: (images: { name: string; base64: string }[]) => Promise<void>
  remove: (ids: number[]) => Promise<void>
  stackSelected: (name: string) => Promise<void>
  unstackSelected: () => Promise<void>
  deleteStack: (id: number) => Promise<void>
  renameStack: (id: number, name: string) => Promise<void>

  /** 선택 이미지 일괄 내보내기 — 배치된 순서대로 001, 002… 파일명 */
  exportSelected: () => Promise<void>
  /** 이미지들을 스택으로 이동 (드래그/우클릭 공용, stackId null = 빼기) */
  moveToStack: (imageIds: number[], stackId: number | null) => Promise<void>
  /** 임의 이미지들로 새 스택 생성 (우클릭 "새 스택…") */
  createStackWith: (name: string, imageIds: number[]) => Promise<void>
  /** 파일 경로들을 특정 스택으로 가져오기 (스택 카드에 드롭) */
  importToStack: (stackId: number, filePaths: string[]) => Promise<void>
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  stacks: [],
  images: [],
  total: 0,
  loading: false,
  loaded: false,
  currentStack: null,
  columns: Number(localStorage.getItem('library_columns')) || 4,
  cardOrientation:
    (localStorage.getItem('library_orientation') as 'portrait' | 'landscape' | 'square') ||
    'square',
  editMode: false,
  selection: new Set(),

  load: async (reset) => {
    const seq = ++loadSeq
    const { currentStack } = get()
    const offset = reset ? 0 : get().images.length
    set({ loading: true })
    const res = await window.nais.invoke('library:list', {
      stackId: currentStack?.id ?? null,
      limit: PAGE,
      offset
    })
    if (seq !== loadSeq) return // 더 최신 로드가 있으면 폐기
    set({
      images: reset ? res.items : [...get().images, ...res.items],
      stacks: currentStack ? get().stacks : res.stacks,
      total: res.total,
      loading: false,
      loaded: true
    })
  },

  openStack: (stack) => {
    selectionAnchor = null
    set({ currentStack: stack, images: [], total: 0, selection: new Set(), editMode: false })
    void get().load(true)
  },

  setColumns: (columns) => {
    set({ columns })
    localStorage.setItem('library_columns', String(columns))
  },
  setCardOrientation: (cardOrientation) => {
    set({ cardOrientation })
    localStorage.setItem('library_orientation', cardOrientation)
  },
  setEditMode: (editMode) => {
    selectionAnchor = null
    set({ editMode, selection: new Set() })
  },
  toggleSelected: (id) => {
    const next = new Set(get().selection)
    next.has(id) ? next.delete(id) : next.add(id)
    selectionAnchor = id
    set({ selection: next })
  },
  rangeSelect: (id) => {
    const { images } = get()
    const from = images.findIndex((i) => i.id === selectionAnchor)
    const to = images.findIndex((i) => i.id === id)
    if (from === -1 || to === -1) {
      get().toggleSelected(id)
      return
    }
    const next = new Set(get().selection)
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(images[i].id)
    set({ selection: next })
  },
  selectAll: () => set({ selection: new Set(get().images.map((i) => i.id)) }),
  clearSelection: () => set({ selection: new Set() }),

  reorder: async (ids) => {
    const byId = new Map(get().images.map((i) => [i.id, i]))
    set({ images: ids.map((id) => byId.get(id)!).filter(Boolean) })
    await window.nais.invoke('library:reorder', { ids })
  },

  importDialog: async () => {
    const { count } = await window.nais.invoke('library:import', {
      stackId: get().currentStack?.id ?? null
    })
    if (count > 0) {
      toast(`${count}장 추가됨`, 'success')
      await get().load(true)
    }
  },
  importPaths: async (filePaths) => {
    const { count } = await window.nais.invoke('library:importPaths', {
      filePaths,
      stackId: get().currentStack?.id ?? null
    })
    if (count > 0) {
      toast(`${count}장 추가됨`, 'success')
      await get().load(true)
    }
  },
  importBase64: async (images) => {
    if (images.length === 0) return
    const { count } = await window.nais.invoke('library:importImages', {
      images,
      stackId: get().currentStack?.id ?? null
    })
    if (count > 0) {
      toast(`${count}장 추가됨`, 'success')
      await get().load(true)
    }
  },

  remove: async (ids) => {
    await window.nais.invoke('library:delete', { ids })
    set({ selection: new Set() })
    await get().load(true)
  },

  stackSelected: async (name) => {
    const ids = [...get().selection]
    if (ids.length === 0) return
    await window.nais.invoke('library:stackCreate', { name, imageIds: ids })
    set({ selection: new Set(), editMode: false })
    await get().load(true)
  },
  unstackSelected: async () => {
    const ids = [...get().selection]
    if (ids.length === 0) return
    await window.nais.invoke('library:stackSet', { imageIds: ids, stackId: null })
    set({ selection: new Set() })
    await get().load(true)
  },
  deleteStack: async (id) => {
    await window.nais.invoke('library:stackDelete', { id })
    if (get().currentStack?.id === id) get().openStack(null)
    else await get().load(true)
  },
  renameStack: async (id, name) => {
    await window.nais.invoke('library:stackRename', { id, name })
    const { currentStack } = get()
    if (currentStack?.id === id) set({ currentStack: { ...currentStack, name } })
    set({ stacks: get().stacks.map((s) => (s.id === id ? { ...s, name } : s)) })
  },

  exportSelected: async () => {
    const ids = [...get().selection]
    if (ids.length === 0) return
    const { count } = await window.nais.invoke('library:export', { ids })
    if (count > 0) toast(`${count}장 내보냄`, 'success')
  },
  moveToStack: async (imageIds, stackId) => {
    if (imageIds.length === 0) return
    await window.nais.invoke('library:stackSet', { imageIds, stackId })
    set({ selection: new Set() })
    toast(stackId != null ? `스택에 ${imageIds.length}장 추가됨` : '스택에서 뺐습니다', 'success')
    await get().load(true)
  },
  createStackWith: async (name, imageIds) => {
    await window.nais.invoke('library:stackCreate', { name, imageIds })
    set({ selection: new Set() })
    toast(`"${name}" 스택 생성됨`, 'success')
    await get().load(true)
  },
  importToStack: async (stackId, filePaths) => {
    const { count } = await window.nais.invoke('library:importPaths', { filePaths, stackId })
    if (count > 0) {
      toast(`스택에 ${count}장 추가됨`, 'success')
      await get().load(true)
    }
  }
}))

/**
 * 라이브러리에 복제 추가 — 우클릭 메뉴/라이트박스 L 단축키 등 라이브러리 밖에서 사용.
 * 항상 루트(미분류)로 들어가고, 원본 파일은 건드리지 않는다.
 */
export async function addToLibrary(filePaths: string[]): Promise<void> {
  const { count } = await window.nais.invoke('library:importPaths', { filePaths, stackId: null })
  if (count > 0) {
    toast(`라이브러리에 ${count}장 추가됨`, 'success')
    // 라이브러리 루트가 열려 있으면 즉시 갱신 (스택 안이면 루트로 나올 때 어차피 재로드)
    const st = useLibraryStore.getState()
    if (st.loaded && !st.currentStack) void st.load(true)
  }
}

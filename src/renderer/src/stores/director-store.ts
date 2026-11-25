import { create } from 'zustand'
import type { DirectorMethod, FreeBgRemovalProgress, LocalEditKind } from '@shared/types'
import { useGenerationStore } from './generation-store'
import { useLayoutStore } from './layout-store'
import { toast } from './toast-store'

interface DirectorState {
  /** 이미지 스택(base64) — 마지막이 현재. 툴 적용 시 결과가 자동으로 push되어 이어서 처리 */
  stack: string[]
  loading: boolean
  error: string | null
  /** 툴 클릭 한 번으로 바로 실행 (기본 off — 고른 뒤 하단 버튼으로 실행) */
  instantRun: boolean
  /** 무료 배경 제거(HF Space) 진행 상태 — 실행 중일 때만 */
  freeBgProgress: FreeBgRemovalProgress | null
  /** 무료 배경 제거의 외부 전송·라이선스 안내에 동의했는지 — 처음 한 번 확인 후 저장 */
  freeBgConsent: boolean

  /** 현재 이미지 (스택 top) */
  current: () => string | null
  setSource: (base64: string | null) => void
  run: (method: DirectorMethod, opts?: { prompt?: string; defry?: number }) => Promise<void>
  upscale: () => Promise<void>
  /** 공개 Hugging Face Space로 배경 제거 (Anlas 없음) — 결과는 스택 push + 히스토리 저장 */
  removeBackgroundFree: () => Promise<void>
  /** API 없는 로컬 편집(모자이크·도트화) 결과를 스택에 push + 히스토리 저장 */
  applyLocal: (base64: string, kind: LocalEditKind) => Promise<void>
  undo: () => void
  clear: () => void
  setInstantRun: (on: boolean) => void
  acceptFreeBgConsent: () => void
  hydrate: () => Promise<void>
}

export const useDirectorStore = create<DirectorState>((set, get) => ({
  stack: [],
  loading: false,
  error: null,
  instantRun: false,
  freeBgProgress: null,
  freeBgConsent: false,

  current: () => {
    const s = get().stack
    return s.length > 0 ? s[s.length - 1] : null
  },
  setSource: (base64) => set({ stack: base64 ? [base64] : [], error: null }),

  run: async (method, opts) => {
    const cur = get().current()
    if (!cur || get().loading) return
    set({ loading: true, error: null })

    const res = await window.nais.invoke('director:run', {
      method,
      imageBase64: cur,
      prompt: opts?.prompt,
      defry: opts?.defry
    })
    if ('error' in res) {
      set({ loading: false, error: null })
      toast(res.error, 'error')
      return
    }
    // 결과를 스택에 push → 자동으로 다음 입력이 됨 (이어서 처리)
    set({ loading: false, stack: [...get().stack, res.base64] })
    void useGenerationStore.getState().refreshHistory()
  },

  upscale: async () => {
    const cur = get().current()
    if (!cur || get().loading) return
    set({ loading: true, error: null })
    const res = await window.nais.invoke('images:upscale', { imageBase64: cur })
    if ('error' in res) {
      set({ loading: false, error: null })
      toast(res.error, 'error')
      return
    }
    set({ loading: false, stack: [...get().stack, res.base64] })
    void useGenerationStore.getState().refreshHistory()
  },

  removeBackgroundFree: async () => {
    const cur = get().current()
    if (!cur || get().loading) return
    set({ loading: true, error: null, freeBgProgress: null })
    const off = window.nais.on('images:removeBackgroundFreeProgress', (freeBgProgress) => {
      if (get().loading) set({ freeBgProgress })
    })
    // 대기가 길어 그사이 다른 이미지를 열 수 있다 — 스택이 바뀌었으면 결과는 히스토리에만 남긴다
    const stack = get().stack
    try {
      const res = await window.nais.invoke('images:removeBackgroundFree', { imageBase64: cur })
      if ('error' in res) {
        set({ loading: false, freeBgProgress: null })
        toast(res.error, 'error')
        return
      }
      set(
        get().stack === stack
          ? { loading: false, freeBgProgress: null, stack: [...stack, res.base64] }
          : { loading: false, freeBgProgress: null }
      )
      void useGenerationStore.getState().refreshHistory()
    } catch (e) {
      set({ loading: false, freeBgProgress: null })
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      off()
    }
  },

  applyLocal: async (base64, kind) => {
    // 로컬 연산이라 loading 없이 즉시 push — undo/결과 뱃지는 스택 기반이라 그대로 동작
    set({ stack: [...get().stack, base64], error: null })
    const res = await window.nais.invoke('images:saveLocal', { base64, kind })
    if ('error' in res) {
      toast(res.error, 'error')
      return
    }
    void useGenerationStore.getState().refreshHistory()
  },

  undo: () => {
    const s = get().stack
    if (s.length > 1) set({ stack: s.slice(0, -1), error: null })
  },

  clear: () => {
    const stack = get().stack
    const gen = useGenerationStore.getState()
    if (gen.source && stack.includes(gen.source.imageBase64)) gen.setSource(null)
    if (gen.inpaintTarget && stack.includes(gen.inpaintTarget.base64)) gen.cancelInpaint()
    set({ stack: [], error: null })
  },

  setInstantRun: (instantRun) => {
    set({ instantRun })
    void window.nais.invoke('settings:set', {
      key: 'director_instant_run',
      value: instantRun ? '1' : '0'
    })
  },

  acceptFreeBgConsent: () => {
    set({ freeBgConsent: true })
    void window.nais.invoke('settings:set', { key: 'director_free_bg_consent', value: '1' })
  },

  hydrate: async () => {
    const [instant, consent] = await Promise.all([
      window.nais.invoke('settings:get', { key: 'director_instant_run' }),
      window.nais.invoke('settings:get', { key: 'director_free_bg_consent' })
    ])
    set({ instantRun: instant.value === '1', freeBgConsent: consent.value === '1' })
  }
}))

/** 히스토리 등에서 이미지를 디렉터 툴로 열기 (base64 로드 후 페이지 전환) */
export async function openInDirector(filePath: string): Promise<void> {
  const res = await window.nais.invoke('images:readForSource', { filePath })
  if ('error' in res) {
    toast(res.error, 'error')
    return
  }
  useDirectorStore.getState().setSource(res.base64)
  useLayoutStore.getState().setCenterMode('director')
}

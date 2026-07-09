import { create } from 'zustand'
import type { GenerationRequest, HistoryItem, PromptParts, QueueStatus } from '@shared/types'
import { enabledCharacters } from './characters-store'
import { useVibesStore } from './refs-store'
import { toast } from './toast-store'

/**
 * UI 상태 전용 스토어 — persist 금지 (NAIS3 원칙).
 * 파라미터는 SQLite settings('main_params')에 저장/복원하고,
 * 큐/진행 상태의 진실 공급원은 메인 프로세스다 (이벤트 구독만).
 */

export const DEFAULT_REQUEST: GenerationRequest = {
  prompt: '',
  negativePrompt: '',
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  cfgScale: 5,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  seed: -1, // -1 = 랜덤
  variety: false,
  qualityToggle: true,
  ucPreset: 0,
  characterPrompts: [],
  useCoords: false
}

export function mergePromptParts(parts: PromptParts): string {
  return [parts.base, parts.additional, parts.detail].filter((p) => p.trim()).join(', ')
}

function withoutTransientSource(request: GenerationRequest): GenerationRequest {
  const rest = { ...request }
  delete rest.source
  return rest
}

interface GenerationState {
  request: GenerationRequest
  seedLocked: boolean
  batchCount: number
  promptSplitEnabled: boolean
  /** paper | tablet | scroll | opus — Anlas 추정용 */
  subscriptionTier: string | null
  setSubscriptionTier: (tier: string) => void
  anlasBalance: number | null
  refreshAnlas: () => Promise<void>
  queue: QueueStatus | null
  /** 진행 중 미리보기 (data URL 아님, base64) */
  previewPng: string | null
  progress: { stepIx: number; totalSteps: number } | null
  /** 현재 생성 시작 시각(ms). ETA 계산용 */
  genStartAt: number | null
  /** 최근 생성들의 평균 소요 시간(ms). 이전 기록 기반 예상 시간 */
  avgDurationMs: number | null
  /** 중앙에 표시할 이미지 (완성작 파일 경로) */
  viewingFilePath: string | null
  /** 생성 중 유저가 클릭해 고정한 보기 — 스트리밍보다 우선 표시 */
  viewPinned: boolean
  history: HistoryItem[]
  historyTotal: number

  patchRequest: (patch: Partial<GenerationRequest>) => void
  setSeedLocked: (locked: boolean) => void
  setBatchCount: (count: number) => void
  setPromptSplitEnabled: (enabled: boolean) => void
  patchPromptParts: (patch: Partial<PromptParts>) => void
  hydrate: () => Promise<void>
  generate: () => Promise<void>
  cancelAll: () => Promise<void>
  refreshHistory: () => Promise<void>
  view: (filePath: string | null) => void
  /** i2i/인페인트 소스 설정·해제 */
  source: { imageBase64: string; maskBase64?: string; width: number; height: number } | null
  setSource: (
    source: { imageBase64: string; maskBase64?: string; width: number; height: number } | null
  ) => void
  /** 인페인트 마스크 에디터 대상 (전역 — 어디서든 우클릭으로 열 수 있게). null=닫힘 */
  inpaintTarget: { base64: string; width: number; height: number } | null
  startInpaintFromPath: (filePath: string) => Promise<void>
  /** base64 이미지로 바로 인페인트 시작 (디렉터 등 파일 경로가 없는 소스용) */
  startInpaintFromImage: (base64: string, width: number, height: number) => void
  confirmInpaint: (maskBase64: string) => void
  cancelInpaint: () => void
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  request: DEFAULT_REQUEST,
  seedLocked: localStorage.getItem('seed_locked') === '1',
  batchCount: Number(localStorage.getItem('batch_count')) || 1,
  promptSplitEnabled: false,
  subscriptionTier: null,
  setSubscriptionTier: (tier) => {
    set({ subscriptionTier: tier })
    void window.nais.invoke('settings:set', { key: 'nai_tier', value: tier })
  },
  anlasBalance: null,
  refreshAnlas: async () => {
    // 잔액과 함께 구독 tier도 갱신 (무료 판정이 최신 tier를 쓰도록)
    const { anlas, tier } = await window.nais.invoke('nai:balance', undefined)
    set({ anlasBalance: anlas })
    if (tier) {
      set({ subscriptionTier: tier })
      void window.nais.invoke('settings:set', { key: 'nai_tier', value: tier })
    }
  },
  queue: null,
  previewPng: null,
  progress: null,
  genStartAt: null,
  avgDurationMs: Number(localStorage.getItem('gen_avg_ms')) || null,
  viewingFilePath: null,
  viewPinned: false,
  history: [],
  historyTotal: 0,

  patchRequest: (patch) => {
    const request = withoutTransientSource({ ...get().request, ...patch })
    set({ request })
    // 편집도 즉시 영속(디바운스) — 생성 안 하고 재시작해도 롤백되지 않게
    persistParams(request)
  },
  setSeedLocked: (seedLocked) => {
    // 시드가 -1(랜덤)인 채로 잠그면 아무것도 고정되지 않음 — 잠그는 순간 시드를 확정
    if (seedLocked && get().request.seed < 0) {
      get().patchRequest({ seed: randomSeed() })
    }
    set({ seedLocked })
    localStorage.setItem('seed_locked', seedLocked ? '1' : '0')
  },
  setBatchCount: (batchCount) => {
    const clamped = Math.max(1, Math.min(99, batchCount))
    set({ batchCount: clamped })
    localStorage.setItem('batch_count', String(clamped))
  },
  setPromptSplitEnabled: (promptSplitEnabled) => {
    const request = get().request
    const existingParts = request.promptParts
    const promptParts =
      existingParts && mergePromptParts(existingParts) === request.prompt
        ? existingParts
        : ({ base: request.prompt, additional: '', detail: '' } satisfies PromptParts)
    set({ promptSplitEnabled, request: { ...request, promptParts } })
    void window.nais.invoke('settings:set', {
      key: 'prompt_split_enabled',
      value: promptSplitEnabled ? '1' : '0'
    })
    persistParams({ ...request, promptParts })
  },
  patchPromptParts: (patch) => {
    const prev = get().request.promptParts ?? {
      base: get().request.prompt,
      additional: '',
      detail: ''
    }
    const promptParts = { ...prev, ...patch }
    get().patchRequest({ promptParts, prompt: mergePromptParts(promptParts) })
  },

  hydrate: async () => {
    const { value: tier } = await window.nais.invoke('settings:get', { key: 'nai_tier' })
    if (tier) set({ subscriptionTier: tier })
    const { value: split } = await window.nais.invoke('settings:get', {
      key: 'prompt_split_enabled'
    })
    set({ promptSplitEnabled: split === '1' })
    const { value } = await window.nais.invoke('settings:get', { key: 'main_params' })
    if (value) {
      try {
        set({ request: withoutTransientSource({ ...DEFAULT_REQUEST, ...JSON.parse(value) }) })
      } catch {
        // 손상된 저장값은 기본값으로
      }
    }
    const queue = await window.nais.invoke('queue:status', undefined)
    set({ queue })
    await get().refreshHistory()
    void get().refreshAnlas()
  },

  generate: async () => {
    const { request, seedLocked, batchCount } = get()
    const seed = seedLocked && request.seed >= 0 ? request.seed : randomSeed()
    const baseRequest = withoutTransientSource({ ...request, seed })
    // 캐릭터는 라이브러리의 enabled 카드에서 구성 (리스트 순서 = v4 use_order 순서)
    const characterPrompts = enabledCharacters().map((c) => ({
      prompt: c.prompt,
      negativePrompt: c.negativePrompt,
      center: c.center,
      enabled: true as const
    }))
    const src = get().source
    const finalRequest = {
      ...baseRequest,
      characterPrompts,
      source: src
        ? {
            imageBase64: src.imageBase64,
            maskBase64: src.maskBase64,
            // i2i 기본 strength/noise (파라미터 다이얼로그에서 조정 예정)
            strength: request.i2iStrength ?? 0.7,
            noise: request.i2iNoise ?? 0
          }
        : undefined,
      // i2i는 소스 이미지 해상도를 따른다
      ...(src ? { width: src.width, height: src.height } : {})
    }
    if (!seedLocked) set({ request: baseRequest })

    void window.nais.invoke('settings:set', {
      key: 'main_params',
      value: JSON.stringify(baseRequest)
    })
    set({ previewPng: null, progress: null, viewingFilePath: null })
    await window.nais.invoke('queue:enqueue', {
      request: finalRequest,
      count: batchCount
    })
  },

  cancelAll: async () => {
    const queue = get().queue
    if (!queue) return
    const ids = queue.items
      .filter((i) => i.state === 'pending' || i.state === 'generating')
      .map((i) => i.id)
    await window.nais.invoke('queue:cancel', { ids })
  },

  refreshHistory: async () => {
    const { items, total } = await window.nais.invoke('images:list', { limit: 60, offset: 0 })
    set({ history: items, historyTotal: total })
  },

  // 생성 중에 유저가 다른 이미지를 클릭하면 "고정 보기" — 스트리밍이 화면을 덮지 않는다 (B11)
  view: (viewingFilePath) => {
    const active =
      get().queue?.items.some((i) => i.state === 'pending' || i.state === 'generating') ?? false
    set({ viewingFilePath, viewPinned: viewingFilePath != null && active })
  },
  source: null,
  setSource: (source) =>
    set({
      source,
      inpaintTarget: null,
      request: withoutTransientSource(get().request)
    }),
  inpaintTarget: null,
  startInpaintFromPath: async (filePath) => {
    const res = await window.nais.invoke('images:readForSource', { filePath })
    if ('error' in res) {
      toast(res.error, 'error')
      return
    }
    set({ inpaintTarget: { base64: res.base64, width: res.width, height: res.height } })
  },
  startInpaintFromImage: (base64, width, height) =>
    set({ inpaintTarget: { base64, width, height } }),
  confirmInpaint: (maskBase64) => {
    const t = get().inpaintTarget
    if (!t) return
    // 인페인트 기본 strength 1.0 / noise 0 (NAI 웹)
    set({
      request: { ...get().request, i2iStrength: 1, i2iNoise: 0 },
      source: { imageBase64: t.base64, maskBase64, width: t.width, height: t.height },
      inpaintTarget: null
    })
  },
  cancelInpaint: () => set({ inpaintTarget: null })
}))

/** 히스토리/파일에서 i2i 소스 설정 (마스크 없이). filePath 또는 base64+크기 */
export async function setI2iSource(filePath: string): Promise<void> {
  const res = await window.nais.invoke('images:readForSource', { filePath })
  if ('error' in res) {
    toast(res.error, 'error')
    return
  }
  useGenerationStore.getState().setSource({
    imageBase64: res.base64,
    width: res.width,
    height: res.height
  })
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967295)
}

/** 파라미터를 settings('main_params')에 디바운스 저장 (편집 중 매 키 입력마다 쓰지 않도록) */
let persistTimer: ReturnType<typeof setTimeout> | undefined
function persistParams(request: GenerationRequest): void {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void window.nais.invoke('settings:set', {
      key: 'main_params',
      value: JSON.stringify(withoutTransientSource(request))
    })
  }, 400)
}

/** 메인 프로세스 이벤트 구독 — 앱 시작 시 1회 */
export function bindGenerationEvents(): () => void {
  // 생성 소요 시간 추적 (id별 시작 시각 → 완료 시 평균 갱신)
  const startTimes = new Map<string, number>()

  const offQueue = window.nais.on('queue:changed', (queue) => {
    const prev = useGenerationStore.getState().queue
    const prevStates = new Map(prev?.items.map((i) => [i.id, i.state]))

    // 새로 'generating'이 된 항목의 시작 시각 기록
    for (const item of queue.items) {
      if (item.state === 'generating' && prevStates.get(item.id) !== 'generating') {
        startTimes.set(item.id, Date.now())
      }
    }
    // 현재 생성 중 항목의 시작 시각(ETA용)
    const gen = queue.items.find((i) => i.state === 'generating')
    const genStartAt = gen ? (startTimes.get(gen.id) ?? Date.now()) : null

    // 완료된 항목의 소요 시간으로 평균(EMA) 갱신
    let avg = useGenerationStore.getState().avgDurationMs
    for (const item of queue.items) {
      if (item.state === 'done' && prevStates.get(item.id) !== 'done') {
        const start = startTimes.get(item.id)
        if (start) {
          const d = Date.now() - start
          if (d > 500 && d < 600000) avg = avg == null ? d : Math.round(avg * 0.7 + d * 0.3)
        }
      }
      if (item.state !== 'generating' && item.state !== 'pending') startTimes.delete(item.id)
    }
    if (avg !== useGenerationStore.getState().avgDurationMs && avg != null) {
      localStorage.setItem('gen_avg_ms', String(avg))
    }

    useGenerationStore.setState({ queue, genStartAt, avgDurationMs: avg })
    // 새로 실패한 항목은 토스트로 알림 (배지 대신 통합 처리)
    const prevFailed = new Set(prev?.items.filter((i) => i.state === 'failed').map((i) => i.id))
    for (const item of queue.items) {
      if (item.state === 'failed' && !prevFailed.has(item.id)) {
        toast(item.error ?? '생성 실패', 'error')
      }
    }
    // 방금 완료된 항목이 있으면 히스토리 갱신 + 중앙에 표시 (고정 보기 중엔 보기 유지)
    const prevDone = new Set(prev?.items.filter((i) => i.state === 'done').map((i) => i.id))
    const newlyDone = queue.items.find((i) => i.state === 'done' && !prevDone.has(i.id))
    if (newlyDone?.filePath) {
      const pinned = useGenerationStore.getState().viewPinned
      useGenerationStore.setState(
        pinned
          ? { previewPng: null, progress: null }
          : { viewingFilePath: newlyDone.filePath, previewPng: null, progress: null }
      )
      void useGenerationStore.getState().refreshHistory()
    }
    // 큐가 다 끝나면 고정 해제
    const stillActive = queue.items.some((i) => i.state === 'pending' || i.state === 'generating')
    if (!stillActive && useGenerationStore.getState().viewPinned) {
      useGenerationStore.setState({ viewPinned: false })
    }
  })
  const offProgress = window.nais.on('generation:progress', (e) => {
    useGenerationStore.setState({
      progress: { stepIx: e.stepIx, totalSteps: e.totalSteps },
      ...(e.previewPng ? { previewPng: e.previewPng } : {})
    })
  })
  const offAnlas = window.nais.on('anlas:balance', ({ anlas }) => {
    useGenerationStore.setState({ anlasBalance: anlas })
  })
  // 바이브 인코딩 완료 시 목록 재로드 → 카드의 인코딩 표시 갱신
  const offVibes = window.nais.on('vibes:encoded', () => {
    void useVibesStore.getState().load()
  })
  return () => {
    offQueue()
    offProgress()
    offAnlas()
    offVibes()
  }
}

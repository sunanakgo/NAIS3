import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import {
  normalizeDelayMs,
  normalizeDelayRandomization,
  randomizedGenerationDelayMs
} from '../../shared/generation-delay'
import { applyRandomCharacterPrompt } from '../../shared/random-character'
import type {
  CharacterPromptInput,
  GenerationDelayRandomization,
  GenerationRequest,
  QueueItem,
  QueueStatus
} from '../../shared/types'

/**
 * 생성 큐. 메인 프로세스 상주 — 렌더러가 리로드/크래시해도 큐는 살아있다.
 *
 * NAIS2에서 고치는 버그들의 구조적 해결 지점:
 * - 예약 취소 후 재예약 시 UI와 실제 큐 상태 불일치 → 큐가 단일 진실 공급원, UI는 'changed' 구독만
 * - 씬 모드에서 생성 지연시간 미적용 → 지연은 큐 루프 한 곳에서만 적용
 */
/** 재시도 대상 HTTP 상태 — 전이성(rate-limit/서버 일시 오류)만. 4xx 클라이언트 오류는 제외 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
/** 전이성 오류 최대 재시도 횟수 (초기 시도 제외) */
const MAX_RETRIES = 3
/** 백오프 기준·상한 (ms) — 실제 대기는 지수 백오프 + 지터, Retry-After가 더 크면 그걸 따름 */
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 20000

export class GenerationQueue extends EventEmitter {
  private items = new Map<string, QueueItem>()
  private controllers = new Map<string, AbortController>()
  private running = false
  private delayMs = 600
  private delayRandomization: GenerationDelayRandomization = {
    enabled: false,
    minusMs: 0,
    plusMs: 0
  }

  constructor(
    private readonly generate: (
      request: GenerationRequest,
      id: string,
      signal: AbortSignal
    ) => Promise<string>,
    private readonly random: () => number = Math.random
  ) {
    super()
  }

  enqueue(
    request: GenerationRequest,
    count: number,
    randomCharacterPrompts: readonly CharacterPromptInput[] = []
  ): string[] {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const id = randomUUID()
      // 배치는 장마다 시드+i — 같은 시드 N장(동일 그림 N장) 방지, 시드 고정 시에도 각 장 재현 가능
      const seededRequest =
        i === 0 ? request : { ...request, seed: (request.seed + i) % 4294967296 }
      const req = applyRandomCharacterPrompt(seededRequest, randomCharacterPrompts)
      this.items.set(id, { id, state: 'pending', request: req })
      ids.push(id)
    }
    this.emitChanged()
    void this.run()
    return ids
  }

  /** Publish a batch only after its synchronous reservation commit succeeds. */
  enqueueRequests(requests: GenerationRequest[], commit: () => void): string[] {
    const entries = requests.map((request): QueueItem => ({
      id: randomUUID(),
      state: 'pending',
      request
    }))
    try {
      for (const item of entries) this.items.set(item.id, item)
      commit()
    } catch (error) {
      for (const item of entries) this.items.delete(item.id)
      throw error
    }
    if (entries.length > 0) {
      this.emitChanged()
      void this.run()
    }
    return entries.map((item) => item.id)
  }

  cancel(ids: string[]): void {
    for (const id of ids) {
      const item = this.items.get(id)
      if (item && item.state === 'pending') {
        item.state = 'cancelled'
      } else if (item && item.state === 'generating') {
        this.controllers.get(id)?.abort()
      }
    }
    this.emitChanged()
  }

  setDelayMs(ms: number, randomization?: GenerationDelayRandomization): void {
    this.delayMs = normalizeDelayMs(ms)
    if (randomization) this.delayRandomization = normalizeDelayRandomization(randomization)
  }

  status(): QueueStatus {
    return { items: [...this.items.values()], running: this.running, delayMs: this.delayMs }
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      let next: QueueItem | undefined
      while ((next = this.nextPending())) {
        next.state = 'generating'
        const controller = new AbortController()
        this.controllers.set(next.id, controller)
        this.emitChanged()
        try {
          next.filePath = await this.generateWithRetry(next, controller)
          next.state = 'done'
        } catch (e) {
          if (controller.signal.aborted || isAbortError(e)) {
            next.state = 'cancelled'
          } else {
            next.state = 'failed'
            next.error = e instanceof Error ? e.message : String(e)
          }
        } finally {
          this.controllers.delete(next.id)
          next.retrying = false
        }
        this.emitChanged()
        if (this.nextPending()) {
          await sleep(this.nextDelayMs())
        }
      }
    } finally {
      this.running = false
      this.emitChanged()
    }
  }

  /**
   * 전이성 오류(429/5xx)면 백오프 후 재시도. 취소는 즉시 중단하고,
   * 재시도 대기 중엔 retrying 플래그로 UI에 알린다 (state는 'generating' 유지).
   * 같은 controller를 재시도 내내 공유하므로 대기 중 취소도 정상 반영된다.
   */
  private async generateWithRetry(item: QueueItem, controller: AbortController): Promise<string> {
    const { signal } = controller
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.generate(item.request, item.id, signal)
      } catch (e) {
        if (signal.aborted || isAbortError(e)) throw e
        if (attempt >= MAX_RETRIES || !isRetryableError(e)) throw e
        item.retrying = true
        this.emitChanged()
        await abortableSleep(retryDelayMs(e, attempt), signal)
        item.retrying = false
        if (signal.aborted) throw abortError()
        this.emitChanged()
      }
    }
  }

  private nextPending(): QueueItem | undefined {
    for (const item of this.items.values()) {
      if (item.state === 'pending') return item
    }
    return undefined
  }

  private nextDelayMs(): number {
    return randomizedGenerationDelayMs(this.delayMs, this.delayRandomization, this.random)
  }

  private emitChanged(): void {
    this.emit('changed', this.status())
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 취소 시 즉시 깨어나는 sleep — 백오프 대기 중 사용자가 취소하면 곧바로 반환 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error && (e.name === 'AbortError' || e.message.toLowerCase().includes('abort'))
  )
}

/** 전이성(재시도 가능) 오류인지 — NaiHttpError.status가 429/5xx 계열일 때만 */
function isRetryableError(e: unknown): boolean {
  const status = (e as { status?: number })?.status
  return typeof status === 'number' && RETRYABLE_STATUS.has(status)
}

/** 재시도 대기 시간 — 지수 백오프 + 지터, 서버가 준 Retry-After가 더 크면 그걸 존중 */
function retryDelayMs(e: unknown, attempt: number): number {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)
  const jittered = backoff + backoff * 0.25 * Math.random()
  const retryAfter = (e as { retryAfterMs?: number })?.retryAfterMs ?? 0
  return Math.max(jittered, retryAfter)
}

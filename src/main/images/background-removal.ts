/**
 * 무료 배경 제거 (NAIS2 이식) — 공개 Hugging Face Space에 이미지를 보내 배경을 지운다.
 * Anlas는 쓰지 않지만 인터넷이 필요하고, 이미지가 제3자 Space로 전송된다.
 * 1순위 BRIA RMBG 2.0, 실패·대기 초과 시 anime-remove-background로 폴백.
 */
import type { FreeBgRemovalProgress, FreeBgRemovalSpace } from '../../shared/types'

interface SpaceSpec {
  role: FreeBgRemovalSpace
  id: string
  endpoint: string
  /** 엔드포인트의 이미지 파라미터 이름 */
  param: string
  /** 출력 data에서 결과 이미지 후보를 우선순위대로 */
  pick: (data: unknown[]) => unknown[]
}

export const FREE_BG_REMOVAL_SPACES: readonly SpaceSpec[] = [
  {
    role: 'primary',
    id: 'briaai/BRIA-RMBG-2.0',
    endpoint: '/image',
    param: 'image',
    // 출력: [0] ImageSlider [결과(webp), 원본], [1] 투명 PNG 파일 — 무손실 PNG를 우선
    pick: (data) => [data[1], Array.isArray(data[0]) ? data[0][0] : undefined]
  },
  {
    role: 'fallback',
    id: 'skytnt/anime-remove-background',
    endpoint: '/rmbg_fn',
    param: 'img',
    // 출력: [0] 마스크(흑백), [1] RGBA 결과 — 마스크를 결과로 쓰지 않게 [1]만
    pick: (data) => [data[1]]
  }
]

/** Space 연결(잠든 Space 깨우기 포함) 제한 */
const CONNECT_TIMEOUT_MS = 45_000
/** 대기열 + 처리 제한 — 넘으면 작업을 취소하고 다음 Space로 */
const JOB_TIMEOUT_MS = 120_000
const DOWNLOAD_TIMEOUT_MS = 30_000
const MAX_RESULT_BYTES = 64 * 1024 * 1024

/** gradio 이벤트 중 여기서 쓰는 부분 */
type SpaceEvent =
  | { type: 'data'; data: unknown }
  | {
      type: 'status'
      stage: string
      queue?: boolean
      position?: number
      message?: unknown
      original_msg?: string
      progress_data?: unknown
    }
  | { type: string }

interface SpaceJob extends AsyncIterable<SpaceEvent> {
  cancel?: () => Promise<void>
}

export interface SpaceClient {
  submit: (
    endpoint: string,
    data: Record<string, unknown>,
    eventData?: unknown,
    triggerId?: number | null,
    allEvents?: boolean
  ) => SpaceJob
  close?: () => void
}

export interface FreeBgRemovalOptions {
  onProgress?: (progress: FreeBgRemovalProgress) => void
  /** 테스트용 주입 — 기본은 @gradio/client */
  connect?: (spaceId: string) => Promise<SpaceClient>
  fetch?: typeof fetch
  timeouts?: { connect?: number; job?: number; download?: number }
}

export interface FreeBgRemovalAttempt {
  spaceId: string
  reason: 'timeout' | 'error'
  message: string
}

/** 모든 Space가 실패 — 각 시도의 사유를 담는다 (메인에서 번역해 표시) */
export class FreeBgRemovalError extends Error {
  constructor(readonly attempts: FreeBgRemovalAttempt[]) {
    super(attempts.map((a) => `${a.spaceId}: ${a.message}`).join('; '))
    this.name = 'FreeBgRemovalError'
  }
}

class SpaceTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${Math.round(ms / 1000)}s`)
    this.name = 'SpaceTimeoutError'
  }
}

export async function removeBackgroundFree(
  image: Buffer,
  options: FreeBgRemovalOptions = {}
): Promise<{ image: Buffer; spaceId: string }> {
  const attempts: FreeBgRemovalAttempt[] = []
  for (const spec of FREE_BG_REMOVAL_SPACES) {
    try {
      return { image: await runSpace(spec, image, options), spaceId: spec.id }
    } catch (e) {
      attempts.push({
        spaceId: spec.id,
        reason: e instanceof SpaceTimeoutError ? 'timeout' : 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    }
  }
  throw new FreeBgRemovalError(attempts)
}

async function defaultConnect(spaceId: string): Promise<SpaceClient> {
  const { Client } = await import('@gradio/client')
  return (await Client.connect(spaceId)) as unknown as SpaceClient
}

async function runSpace(
  spec: SpaceSpec,
  image: Buffer,
  options: FreeBgRemovalOptions
): Promise<Buffer> {
  const report = (stage: FreeBgRemovalProgress['stage'], position?: number): void =>
    options.onProgress?.({ space: spec.role, stage, ...(position != null ? { position } : {}) })
  const connectMs = options.timeouts?.connect ?? CONNECT_TIMEOUT_MS
  const jobMs = options.timeouts?.job ?? JOB_TIMEOUT_MS

  report('connecting')
  const connecting = (options.connect ?? defaultConnect)(spec.id)
  // 제한 시간 뒤에 늦게 붙은 연결은 바로 닫는다
  const client = await withTimeout(connecting, connectMs, 'Connection', () => {
    void connecting.then(
      (late) => late.close?.(),
      () => {}
    )
  })
  try {
    // all_events=true — 대기열 순번·오류 상태도 받아서 진행 표시와 실패 판정에 쓴다
    const job = client.submit(
      spec.endpoint,
      { [spec.param]: new Blob([new Uint8Array(image)], { type: 'image/png' }) },
      undefined,
      undefined,
      true
    )
    const data = await withTimeout(collectData(job, report), jobMs, 'Queue', () => {
      void job.cancel?.().catch(() => {})
    })
    const output = spec.pick(Array.isArray(data) ? data : []).find((c) => c != null)
    if (output == null) throw new Error('Space returned no image')
    return await downloadOutput(output, options)
  } finally {
    try {
      client.close?.()
    } catch {
      // 이미 끊긴 연결
    }
  }
}

/** 이벤트 스트림에서 결과 data를 받을 때까지 진행 상태를 알린다 (gradio predict와 같은 판정) */
async function collectData(
  job: SpaceJob,
  report: (stage: FreeBgRemovalProgress['stage'], position?: number) => void
): Promise<unknown> {
  let result: unknown = undefined
  let gotData = false
  for await (const event of job) {
    if (event.type === 'data' && 'data' in event) {
      result = event.data
      gotData = true
      continue
    }
    if (event.type !== 'status' || !('stage' in event)) continue
    if (event.stage === 'error') {
      const msg = event.message
      throw new Error(
        typeof msg === 'string' && msg
          ? msg
          : msg
            ? JSON.stringify(msg)
            : 'The Space reported an error'
      )
    }
    if (event.stage === 'complete') {
      if (gotData) return result
      continue
    }
    // gradio는 처리 시작(process_starts)·진행률(progress)도 stage 'pending'으로 보낸다
    const started = event.original_msg === 'process_starts' || event.progress_data != null
    if (started || event.stage === 'generating' || event.stage === 'streaming') report('processing')
    else if (event.stage === 'pending' && event.queue) report('queued', event.position)
  }
  if (gotData) return result
  throw new Error('Space closed the connection without a result')
}

/** gradio 출력(FileData·URL·data URL) → 이미지 바이트. Space 호스트에서만 내려받는다 */
async function downloadOutput(output: unknown, options: FreeBgRemovalOptions): Promise<Buffer> {
  const ref =
    typeof output === 'string'
      ? output
      : output &&
          typeof output === 'object' &&
          typeof (output as { url?: unknown }).url === 'string'
        ? (output as { url: string }).url
        : null
  if (!ref) throw new Error('Unexpected Space output format')

  const dataUrl = /^data:image\/[\w.+-]+;base64,(.*)$/s.exec(ref)
  if (dataUrl) return Buffer.from(dataUrl[1], 'base64')

  let url: URL
  try {
    url = new URL(ref)
  } catch {
    throw new Error('Unexpected Space output URL')
  }
  if (!isHuggingFaceHost(url)) throw new Error(`Refusing to download from ${url.host}`)

  const downloadMs = options.timeouts?.download ?? DOWNLOAD_TIMEOUT_MS
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(downloadMs) })
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      throw new SpaceTimeoutError('Download', downloadMs)
    throw e
  }
  if (!response.ok) throw new Error(`Result download failed (${response.status})`)
  const buf = Buffer.from(await response.arrayBuffer())
  if (buf.length === 0) throw new Error('Space returned an empty image')
  if (buf.length > MAX_RESULT_BYTES) throw new Error('Space returned an oversized image')
  return buf
}

function isHuggingFaceHost(url: URL): boolean {
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return host.endsWith('.hf.space') || host === 'huggingface.co' || host.endsWith('.huggingface.co')
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
  onTimeout?: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(new SpaceTimeoutError(what, ms))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

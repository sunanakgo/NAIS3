/**
 * 무료 배경 제거 (NAIS2 이식) — 공개 Hugging Face Space에 이미지를 보내 배경을 지운다.
 * Anlas는 쓰지 않지만 인터넷이 필요하고, 이미지가 제3자 Space로 전송된다.
 * 1순위 BRIA RMBG 2.0, 실패·대기 초과 시 anime-remove-background로 폴백.
 */
import type SharpModule from 'sharp'
import type {
  FreeBgRemovalAttempt,
  FreeBgRemovalProgress,
  FreeBgRemovalSpace
} from '../../shared/types'

export type { FreeBgRemovalAttempt } from '../../shared/types'

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
const MAX_REDIRECTS = 3

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
  /**
   * Space 출력 → 최종 이미지(예: 투명 PNG 변환). 던지면 그 Space는 실패로 보고 다음 Space로 넘어간다
   * — HTTP 200으로 깨진 이미지나 HTML을 돌려주는 Space도 폴백되게. 기본은 그대로
   */
  decode?: (image: Buffer) => Promise<Buffer>
  /**
   * 업로드 전 원본 정리 (메타데이터 제거 등). 던지면 Space를 시도하지 않고 그대로 실패한다
   * — 입력 문제는 Space를 바꿔도 해결되지 않는다. 기본은 그대로
   */
  prepare?: (image: Buffer) => Promise<Buffer>
}

/**
 * 데스크톱·브라우저 개발 모드가 같이 쓰는 이미지 변환 — sharp는 호출하는 쪽 것을 받는다
 * (메인은 Electron용 로더를 거친 sharp, 개발 게이트웨이는 Node의 sharp).
 */
export function freeBgImageCodec(
  sharp: typeof SharpModule
): Required<Pick<FreeBgRemovalOptions, 'prepare' | 'decode'>> {
  return {
    // 업로드 전에 평범한 RGB PNG로 다시 인코딩한다. NAI PNG의 tEXt/iTXt(프롬프트·시드)와
    // 알파 채널 LSB의 스텔스 메타데이터가 제3자 Space로 나가지 않게. sharp는 기본으로
    // 메타데이터를 버린다. removeAlpha 대신 흰색으로 합성 — 투명 픽셀 밑에 숨은 RGB 값이 드러나지 않게
    prepare: (image) =>
      sharp(image).flatten({ background: '#ffffff' }).toColourspace('srgb').png().toBuffer(),
    // Space 출력이 webp일 수도 있어 투명도를 살린 PNG로 통일 — 이미지가 아니면 다음 Space로 넘어간다
    decode: (image) => sharp(image).ensureAlpha().png().toBuffer()
  }
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
  const upload = options.prepare ? await options.prepare(image) : image
  const attempts: FreeBgRemovalAttempt[] = []
  for (const spec of FREE_BG_REMOVAL_SPACES) {
    try {
      return { image: await runSpace(spec, upload, options), spaceId: spec.id }
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
    const downloaded = await downloadOutput(output, options)
    if (!options.decode) return downloaded
    try {
      return await options.decode(downloaded)
    } catch (e) {
      throw new Error(`Space returned an unreadable image (${e instanceof Error ? e.message : e})`)
    }
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
  if (dataUrl) {
    // 디코딩 전에 크기부터 — base64 4글자 = 3바이트
    if (Math.floor((dataUrl[1].length * 3) / 4) > MAX_RESULT_BYTES) throw oversized()
    const buf = Buffer.from(dataUrl[1], 'base64')
    if (buf.length === 0) throw new Error('Space returned an empty image')
    return buf
  }

  let url: URL
  try {
    url = new URL(ref)
  } catch {
    throw new Error('Unexpected Space output URL')
  }

  const downloadMs = options.timeouts?.download ?? DOWNLOAD_TIMEOUT_MS
  const signal = AbortSignal.timeout(downloadMs)
  try {
    // 리다이렉트는 직접 따라가며 매 단계 호스트를 확인한다 — 허용 호스트를 거쳐 다른 곳으로 새지 않게
    for (let hop = 0; ; hop++) {
      if (!isHuggingFaceHost(url)) throw new Error(`Refusing to download from ${url.host}`)
      const response = await (options.fetch ?? fetch)(url, { signal, redirect: 'manual' })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => {})
        if (!location || hop >= MAX_REDIRECTS) throw new Error('Too many redirects')
        url = new URL(location, url)
        continue
      }
      if (!response.ok) throw new Error(`Result download failed (${response.status})`)
      const buf = await readCapped(response)
      if (buf.length === 0) throw new Error('Space returned an empty image')
      return buf
    }
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      throw new SpaceTimeoutError('Download', downloadMs)
    throw e
  }
}

function oversized(): Error {
  return new Error('Space returned an oversized image')
}

/** 응답 본문을 받으면서 크기를 센다 — 다 받은 뒤 검사하면 큰 응답이 이미 메모리를 차지한다 */
async function readCapped(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESULT_BYTES) {
    await response.body?.cancel().catch(() => {})
    throw oversized()
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESULT_BYTES) {
      await reader.cancel().catch(() => {})
      throw oversized()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
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

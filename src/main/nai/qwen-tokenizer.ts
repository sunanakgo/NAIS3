import { app } from 'electron'
import { Worker } from 'worker_threads'
import { join } from 'path'
import workerPath from './qwen-tokenizer.worker?modulePath'
import type {
  QwenTokenizerRequest,
  QwenTokenizerResponse,
  QwenTokenizerWorkerData
} from './qwen-tokenizer-messages'

const IDLE_TIMEOUT_MS = 5 * 60 * 1000

interface PendingRequest {
  resolve: (counts: number[]) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let nextRequestId = 1
let idleTimer: NodeJS.Timeout | null = null
const pending = new Map<number, PendingRequest>()

function clearIdleTimer(): void {
  if (!idleTimer) return
  clearTimeout(idleTimer)
  idleTimer = null
}

function rejectPending(error: Error): void {
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}

function scheduleIdleTermination(): void {
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (pending.size > 0 || !worker) return
    const idleWorker = worker
    worker = null
    void idleWorker.terminate()
  }, IDLE_TIMEOUT_MS)
  idleTimer.unref()
}

function getWorker(): Worker {
  if (worker) return worker

  const workerData: QwenTokenizerWorkerData = {
    resourceDir: join(app.getAppPath(), 'resources', 'qwen35')
  }
  const created = new Worker(workerPath, { workerData })
  worker = created
  created.unref()

  created.on('message', (response: QwenTokenizerResponse) => {
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if ('error' in response) request.reject(new Error(response.error))
    else request.resolve(response.counts)
    if (pending.size === 0) scheduleIdleTermination()
  })

  created.on('error', (error) => {
    if (worker !== created) return
    worker = null
    clearIdleTimer()
    rejectPending(error)
  })

  created.on('exit', (code) => {
    if (worker !== created) return
    worker = null
    clearIdleTimer()
    if (code !== 0) rejectPending(new Error(`Qwen tokenizer worker exited with code ${code}`))
  })

  return created
}

export function countQwenTokens(texts: string[]): Promise<number[]> {
  if (texts.length === 0) return Promise.resolve([])
  clearIdleTimer()

  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pending.set(id, { resolve, reject })
    const request: QwenTokenizerRequest = { id, texts }
    try {
      getWorker().postMessage(request)
    } catch (error) {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

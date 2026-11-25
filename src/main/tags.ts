import { app } from 'electron'
import { Worker } from 'worker_threads'
import { join } from 'path'
import workerPath from './tags.worker?modulePath'
import { normalizeTagQuery, type TagEntry } from '../shared/tag-search'
import type { TagSearchRequest, TagSearchResponse, TagWorkerData } from './tags-messages'

/**
 * 단부루 태그 자동완성 데이터 (resources/tags.json, 게시물 10건 이상).
 * NAIS2는 이걸 렌더러 번들에 넣었지만, NAIS3는 메인 쪽 워커 스레드에서 lazy 로드 + IPC 검색으로 서빙
 * — 렌더러 메모리/번들에 대용량 데이터를 싣지 않고, 파싱·검색이 메인 스레드도 막지 않는다.
 * 한동안 안 쓰면 워커를 내려 인덱스 메모리를 돌려준다.
 */

export type { TagEntry } from '../shared/tag-search'

const IDLE_TIMEOUT_MS = 10 * 60 * 1000

interface PendingRequest {
  resolve: (items: TagEntry[]) => void
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

  const workerData: TagWorkerData = {
    tagsPath: join(app.getAppPath(), 'resources', 'tags.json')
  }
  const created = new Worker(workerPath, { workerData })
  worker = created
  created.unref()

  created.on('message', (response: TagSearchResponse) => {
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if ('error' in response) request.reject(new Error(response.error))
    else request.resolve(response.items)
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
    if (code !== 0) rejectPending(new Error(`Tag search worker exited with code ${code}`))
  })

  return created
}

export function searchTags(query: string, limit?: number): Promise<TagEntry[]> {
  // 두 글자 미만은 워커를 깨우지 않는다
  if (normalizeTagQuery(query).length < 2) return Promise.resolve([])
  clearIdleTimer()

  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pending.set(id, { resolve, reject })
    const request: TagSearchRequest = { id, query, limit }
    try {
      getWorker().postMessage(request)
    } catch (error) {
      pending.delete(id)
      if (pending.size === 0) scheduleIdleTermination()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

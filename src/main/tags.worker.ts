import { readFileSync } from 'fs'
import { parentPort, workerData } from 'worker_threads'
import {
  buildTagIndex,
  createTagSearcher,
  type RawTag,
  type TagSearcher
} from '../shared/tag-search'
import type { TagSearchRequest, TagSearchResponse, TagWorkerData } from './tags-messages'

const port = parentPort
if (!port) throw new Error('Tag search worker requires a parent port')

const { tagsPath } = workerData as TagWorkerData
let searcher: TagSearcher | null = null

port.on('message', (request: TagSearchRequest) => {
  let response: TagSearchResponse
  try {
    // 18MB JSON 파싱·인덱스 구축은 워커에서 한 번만 — 메인 스레드를 막지 않는다
    searcher ??= createTagSearcher(
      buildTagIndex(JSON.parse(readFileSync(tagsPath, 'utf-8')) as RawTag[])
    )
    response = { id: request.id, items: searcher.search(request.query, request.limit) }
  } catch (error) {
    response = { id: request.id, error: error instanceof Error ? error.message : String(error) }
  }
  port.postMessage(response)
})

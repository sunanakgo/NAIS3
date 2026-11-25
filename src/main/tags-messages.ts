import type { TagEntry } from '../shared/tag-search'

export interface TagSearchRequest {
  id: number
  query: string
  limit?: number
}

export type TagSearchResponse = { id: number; items: TagEntry[] } | { id: number; error: string }

export interface TagWorkerData {
  tagsPath: string
}

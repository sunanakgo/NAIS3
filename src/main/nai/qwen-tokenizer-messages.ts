export interface QwenTokenizerRequest {
  id: number
  texts: string[]
}

export type QwenTokenizerResponse = { id: number; counts: number[] } | { id: number; error: string }

export interface QwenTokenizerWorkerData {
  resourceDir: string
}

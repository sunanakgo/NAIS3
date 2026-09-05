import { parentPort, workerData } from 'worker_threads'
import { countWithQwenTokenizer, loadQwenTokenizer } from './qwen-tokenizer-core'
import type {
  QwenTokenizerRequest,
  QwenTokenizerResponse,
  QwenTokenizerWorkerData
} from './qwen-tokenizer-messages'

const port = parentPort
if (!port) throw new Error('Qwen tokenizer worker requires a parent port')

const { resourceDir } = workerData as QwenTokenizerWorkerData
let tokenizer: ReturnType<typeof loadQwenTokenizer> | null = null

port.on('message', (request: QwenTokenizerRequest) => {
  let response: QwenTokenizerResponse
  try {
    tokenizer ??= loadQwenTokenizer(resourceDir)
    response = {
      id: request.id,
      counts: countWithQwenTokenizer(tokenizer, request.texts)
    }
  } catch (error) {
    response = {
      id: request.id,
      error: error instanceof Error ? error.message : String(error)
    }
  }
  port.postMessage(response)
})

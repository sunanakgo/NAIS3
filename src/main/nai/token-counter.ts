import { isV5Model } from '../../shared/nai-models'
import { countQwenTokens } from './qwen-tokenizer'
import { countTokens as countT5Tokens } from './tokenizer'

export async function countPromptTokens(texts: string[], model: string): Promise<number[]> {
  if (isV5Model(model)) return countQwenTokens(texts)
  return texts.map(countT5Tokens)
}

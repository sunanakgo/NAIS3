import { Tokenizer } from '@huggingface/tokenizers'
import { gunzipSync } from 'zlib'
import { readFileSync } from 'fs'
import { join } from 'path'

function readCompressedJson(path: string): object {
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf-8')) as object
}

export function loadQwenTokenizer(resourceDir: string): Tokenizer {
  const tokenizer = readCompressedJson(join(resourceDir, 'tokenizer.json.gz'))
  const config = readCompressedJson(join(resourceDir, 'tokenizer_config.json.gz'))
  return new Tokenizer(tokenizer, config)
}

export function countWithQwenTokenizer(tokenizer: Tokenizer, texts: string[]): number[] {
  return texts.map((text) => tokenizer.encode(text, { add_special_tokens: false }).ids.length)
}

import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { countWithQwenTokenizer, loadQwenTokenizer } from '../src/main/nai/qwen-tokenizer-core'

const resourceDir = resolve(process.cwd(), 'resources', 'qwen35')

describe('Qwen 3.5 토크나이저', () => {
  const tokenizer = loadQwenTokenizer(resourceDir)

  it('NovelAI 웹 Qwen 3.5 기준 예시를 동일하게 센다', () => {
    const [count] = countWithQwenTokenizer(tokenizer, [
      '1girl, blue eyes, very long hair, 桜の下に立つ少女'
    ])
    expect(count).toBe(16)
  })

  it('특수 토큰을 덧붙이지 않고 빈 문자열을 0으로 센다', () => {
    expect(countWithQwenTokenizer(tokenizer, ['', 'hello'])).toEqual([0, 1])
  })

  it('NFC 정규화를 적용한다', () => {
    expect(countWithQwenTokenizer(tokenizer, ['é', 'e\u0301'])).toEqual([1, 1])
  })

  it('검증된 고정 리소스를 사용한다', () => {
    const hash = createHash('sha256')
      .update(readFileSync(resolve(resourceDir, 'tokenizer.json.gz')))
      .digest('hex')
    expect(hash).toBe('7104f128b1d5cd95dbdbdb086b0a40c358e1b9cc8e7f1ea63998a61b9618132b')
  })
})

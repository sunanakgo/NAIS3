import { describe, expect, it, vi } from 'vitest'
import type { CharacterPromptInput, GenerationRequest } from '../src/shared/types'
import { GenerationQueue } from '../src/main/queue/generation-queue'

/** NaiHttpError를 흉내낸 최소 오류 — 큐는 status 필드만 본다 */
class HttpErr extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number
  ) {
    super(`http ${status}`)
    this.name = 'NaiHttpError'
  }
}

const REQ = {} as GenerationRequest // count=1이면 seed 접근 없음

const RANDOM_CANDIDATES: CharacterPromptInput[] = [
  { prompt: 'alpha', negativePrompt: '', enabled: true },
  { prompt: 'beta', negativePrompt: '', enabled: true }
]

describe('GenerationQueue 랜덤 캐릭터', () => {
  it('연속 생성의 각 큐 항목마다 후보 캐릭터를 독립 추첨한다', async () => {
    const random = vi
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.75)
      .mockReturnValueOnce(0.75)
    const q = new GenerationQueue(async () => '/img.png')
    q.setDelayMs(0)

    const ids = q.enqueue(
      {
        ...REQ,
        seed: 42,
        characterPrompts: [{ prompt: 'previous', negativePrompt: '', enabled: true }]
      },
      3,
      RANDOM_CANDIDATES
    )

    await vi.waitFor(() => {
      expect(
        q
          .status()
          .items.filter((item) => ids.includes(item.id))
          .every((item) => item.state === 'done')
      ).toBe(true)
    })
    expect(
      q
        .status()
        .items.filter((item) => ids.includes(item.id))
        .map((item) => item.request.characterPrompts.map((character) => character.prompt))
    ).toEqual([['alpha'], ['beta'], ['beta']])
    random.mockRestore()
  })
})

describe('GenerationQueue 생성 간격 랜덤화', () => {
  it('활성화하면 설정한 마이너스 범위까지 생성 간격을 줄인다', async () => {
    vi.useFakeTimers()
    try {
      const startedAt: number[] = []
      const q = new GenerationQueue(
        async () => {
          startedAt.push(Date.now())
          return '/img.png'
        },
        () => 0
      )
      q.setDelayMs(1000, { enabled: true, minusMs: 300, plusMs: 700 })

      q.enqueue(REQ, 2)
      await vi.runAllTimersAsync()

      expect(startedAt[1] - startedAt[0]).toBe(700)
    } finally {
      vi.useRealTimers()
    }
  })

  it('활성화하면 설정한 플러스 범위 안에서 생성 간격을 늘린다', async () => {
    vi.useFakeTimers()
    try {
      const startedAt: number[] = []
      const q = new GenerationQueue(
        async () => {
          startedAt.push(Date.now())
          return '/img.png'
        },
        () => 0.5
      )
      q.setDelayMs(1000, { enabled: true, minusMs: 0, plusMs: 400 })

      q.enqueue(REQ, 2)
      await vi.runAllTimersAsync()

      expect(startedAt[1] - startedAt[0]).toBe(1200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('비활성화하면 기존의 고정 생성 간격을 유지한다', async () => {
    vi.useFakeTimers()
    try {
      const startedAt: number[] = []
      const q = new GenerationQueue(
        async () => {
          startedAt.push(Date.now())
          return '/img.png'
        },
        () => 0
      )
      q.setDelayMs(1000, { enabled: false, minusMs: 300, plusMs: 700 })

      q.enqueue(REQ, 2)
      await vi.runAllTimersAsync()

      expect(startedAt[1] - startedAt[0]).toBe(1000)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('GenerationQueue 재시도', () => {
  it('전이성 오류(429)는 백오프 후 재시도해 성공한다', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const q = new GenerationQueue(async () => {
        calls++
        if (calls === 1) throw new HttpErr(429)
        return '/img.png'
      })
      // 방출 시점의 값을 즉시 읽어 기록 (items 객체는 재사용되므로 나중에 읽으면 뒤덮임)
      const retryingSeen: boolean[] = []
      q.on('changed', (s) => retryingSeen.push(!!s.items[0]?.retrying))
      q.enqueue(REQ, 1)
      await vi.runAllTimersAsync()

      expect(calls).toBe(2)
      expect(q.status().items[0].state).toBe('done')
      expect(q.status().items[0].filePath).toBe('/img.png')
      // 대기 중 retrying=true가 한 번은 방송됐다 (UI 안내용)
      expect(retryingSeen.some(Boolean)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('4xx 클라이언트 오류는 재시도하지 않고 즉시 실패한다', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const q = new GenerationQueue(async () => {
        calls++
        throw new HttpErr(400)
      })
      q.enqueue(REQ, 1)
      await vi.runAllTimersAsync()

      expect(calls).toBe(1)
      expect(q.status().items[0].state).toBe('failed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('전이성 오류가 계속되면 재시도를 소진하고 실패한다 (1 + 3회)', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const q = new GenerationQueue(async () => {
        calls++
        throw new HttpErr(503)
      })
      q.enqueue(REQ, 1)
      await vi.runAllTimersAsync()

      expect(calls).toBe(4)
      expect(q.status().items[0].state).toBe('failed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('백오프 대기 중 취소하면 즉시 취소되고 더는 호출하지 않는다', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const q = new GenerationQueue(async () => {
        calls++
        throw new HttpErr(429)
      })
      const [id] = q.enqueue(REQ, 1)
      // 첫 시도 실패 + 백오프 진입까지만 진행 (백오프 최소 2s라 타이머는 미만료)
      await vi.advanceTimersByTimeAsync(10)
      q.cancel([id])
      await vi.runAllTimersAsync()

      expect(calls).toBe(1)
      expect(q.status().items[0].state).toBe('cancelled')
    } finally {
      vi.useRealTimers()
    }
  })
})

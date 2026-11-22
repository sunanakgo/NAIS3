import { describe, expect, it, vi } from 'vitest'
import {
  FREE_BG_REMOVAL_SPACES,
  FreeBgRemovalError,
  removeBackgroundFree,
  type SpaceClient
} from '../src/main/images/background-removal'
import type { FreeBgRemovalProgress } from '../src/shared/types'

const BRIA = 'briaai/BRIA-RMBG-2.0'
const ANIME = 'skytnt/anime-remove-background'
const input = Buffer.from('input-png')

const file = (url: string): Record<string, unknown> => ({
  path: '/tmp/gradio/x/image.png',
  url,
  meta: { _type: 'gradio.FileData' }
})

type Event = Record<string, unknown> & { type: string }
type Mock = ReturnType<typeof vi.fn>
interface FakeClient {
  client: SpaceClient
  submit: Mock
  cancel: Mock
  close: Mock
}

/** gradio submit 스트림 흉내 — events를 차례로 내보내고, hang이면 끝나지 않는다 */
function fakeClient(events: Event[], opts: { hang?: boolean } = {}): FakeClient {
  const cancel = vi.fn(async () => {})
  const close = vi.fn()
  const submit = vi.fn(() => {
    async function* stream(): AsyncGenerator<Event> {
      for (const event of events) yield event
      if (opts.hang) await new Promise(() => {})
    }
    return Object.assign(stream(), { cancel })
  })
  return { client: { submit, close } as unknown as SpaceClient, submit, cancel, close }
}

const success = (data: unknown[]): Event[] => [
  { type: 'status', stage: 'pending', queue: true, position: 2 },
  { type: 'status', stage: 'pending', queue: true, position: 0, original_msg: 'process_starts' },
  { type: 'data', data },
  { type: 'status', stage: 'complete', queue: true }
]

function fetchReturning(body = 'result-png'): Mock {
  return vi.fn(async () => new Response(Buffer.from(body)))
}

describe('free background removal via Hugging Face Spaces', () => {
  it('declares BRIA RMBG 2.0 first and the anime Space as fallback', () => {
    expect(FREE_BG_REMOVAL_SPACES.map((s) => [s.id, s.endpoint, s.param])).toEqual([
      [BRIA, '/image', 'image'],
      [ANIME, '/rmbg_fn', 'img']
    ])
  })

  it('uses the lossless PNG file from BRIA and reports progress', async () => {
    const bria = fakeClient(
      success([
        [file('https://bria.hf.space/file=slider.webp'), file('https://bria.hf.space/orig.webp')],
        file('https://briaai-bria-rmbg-2-0.hf.space/gradio_api/file=/tmp/no_bg_image.png')
      ])
    )
    const connect = vi.fn(async () => bria.client)
    const fetchMock = fetchReturning()
    const progress: FreeBgRemovalProgress[] = []

    const result = await removeBackgroundFree(input, {
      connect,
      fetch: fetchMock as unknown as typeof fetch,
      onProgress: (p) => progress.push(p)
    })

    expect(result.spaceId).toBe(BRIA)
    expect(result.image).toEqual(Buffer.from('result-png'))
    expect(connect).toHaveBeenCalledExactlyOnceWith(BRIA)
    const [endpoint, data, , , allEvents] = bria.submit.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      unknown,
      unknown,
      boolean
    ]
    expect(endpoint).toBe('/image')
    expect(allEvents).toBe(true)
    expect(data.image).toBeInstanceOf(Blob)
    expect(Buffer.from(await (data.image as Blob).arrayBuffer())).toEqual(input)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://briaai-bria-rmbg-2-0.hf.space/gradio_api/file=/tmp/no_bg_image.png'
    )
    expect(progress).toEqual([
      { space: 'primary', stage: 'connecting' },
      { space: 'primary', stage: 'queued', position: 2 },
      { space: 'primary', stage: 'processing' }
    ])
    expect(bria.close).toHaveBeenCalled()
  })

  it('falls back to the BRIA slider image when the file output is missing', async () => {
    const bria = fakeClient(success([[file('https://bria.hf.space/file=result.webp'), null], null]))
    const fetchMock = fetchReturning()
    await removeBackgroundFree(input, {
      connect: async () => bria.client,
      fetch: fetchMock as unknown as typeof fetch
    })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://bria.hf.space/file=result.webp')
  })

  it('falls back to the anime Space when BRIA reports an error, using its RGBA result not the mask', async () => {
    const bria = fakeClient([
      { type: 'status', stage: 'error', message: 'You have exceeded your GPU quota' }
    ])
    const anime = fakeClient(
      success([
        file('https://skytnt-anime-remove-background.hf.space/file=mask.png'),
        file('https://skytnt-anime-remove-background.hf.space/file=result.png')
      ])
    )
    const connect = vi.fn(async (id: string) => (id === BRIA ? bria.client : anime.client))
    const fetchMock = fetchReturning()
    const progress: FreeBgRemovalProgress[] = []

    const result = await removeBackgroundFree(input, {
      connect,
      fetch: fetchMock as unknown as typeof fetch,
      onProgress: (p) => progress.push(p)
    })

    expect(result.spaceId).toBe(ANIME)
    expect(anime.submit.mock.calls[0][0]).toBe('/rmbg_fn')
    expect(Object.keys(anime.submit.mock.calls[0][1] as object)).toEqual(['img'])
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://skytnt-anime-remove-background.hf.space/file=result.png'
    )
    expect(progress.some((p) => p.space === 'fallback' && p.stage === 'connecting')).toBe(true)
  })

  it('falls back when the primary Space cannot be reached', async () => {
    const anime = fakeClient(success([null, 'data:image/png;base64,' + btoa('inline')]))
    const connect = vi.fn(async (id: string) => {
      if (id === BRIA) throw new Error('Space is sleeping')
      return anime.client
    })
    const fetchMock = fetchReturning()

    const result = await removeBackgroundFree(input, {
      connect,
      fetch: fetchMock as unknown as typeof fetch
    })
    expect(result).toEqual({ image: Buffer.from('inline'), spaceId: ANIME })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels a job stuck in the queue and reports timeouts when every Space fails', async () => {
    const bria = fakeClient([{ type: 'status', stage: 'pending', queue: true, position: 40 }], {
      hang: true
    })
    const anime = fakeClient([{ type: 'status', stage: 'error', message: 'Runtime error' }])

    const error = await removeBackgroundFree(input, {
      connect: async (id) => (id === BRIA ? bria.client : anime.client),
      fetch: fetchReturning() as unknown as typeof fetch,
      timeouts: { job: 20 }
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(FreeBgRemovalError)
    expect((error as FreeBgRemovalError).attempts).toEqual([
      { spaceId: BRIA, reason: 'timeout', message: expect.stringContaining('timed out') },
      { spaceId: ANIME, reason: 'error', message: 'Runtime error' }
    ])
    expect(bria.cancel).toHaveBeenCalled()
    expect(bria.close).toHaveBeenCalled()
  })

  it('times out a connection that never completes', async () => {
    const anime = fakeClient(success([null, file('https://x.hf.space/file=r.png')]))
    const result = await removeBackgroundFree(input, {
      connect: (id) =>
        id === BRIA ? new Promise<SpaceClient>(() => {}) : Promise.resolve(anime.client),
      fetch: fetchReturning() as unknown as typeof fetch,
      timeouts: { connect: 20 }
    })
    expect(result.spaceId).toBe(ANIME)
  })

  it('refuses to download results from hosts outside Hugging Face', async () => {
    const bria = fakeClient(success([null, file('https://example.com/evil.png')]))
    const anime = fakeClient(success([null, file('http://skytnt.hf.space/file=r.png')]))
    const fetchMock = fetchReturning()

    const error = await removeBackgroundFree(input, {
      connect: async (id) => (id === BRIA ? bria.client : anime.client),
      fetch: fetchMock as unknown as typeof fetch
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(FreeBgRemovalError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a failed result download or a stream without data as a Space failure', async () => {
    const bria = fakeClient(success([null, file('https://bria.hf.space/file=r.png')]))
    const anime = fakeClient([{ type: 'status', stage: 'complete', queue: true }])
    const fetchMock = vi.fn(async () => new Response('gone', { status: 404 }))

    const error = await removeBackgroundFree(input, {
      connect: async (id) => (id === BRIA ? bria.client : anime.client),
      fetch: fetchMock as unknown as typeof fetch
    }).catch((e: unknown) => e)

    expect((error as FreeBgRemovalError).attempts.map((a) => a.message)).toEqual([
      'Result download failed (404)',
      'Space closed the connection without a result'
    ])
  })

  it('checks every redirect hop against the Hugging Face hosts', async () => {
    // BRIA는 외부 호스트로 리다이렉트 → 따라가지 않고 실패, anime은 HF CDN으로 → 따라간다
    const bria = fakeClient(success([null, file('https://bria.hf.space/file=r.png')]))
    const anime = fakeClient(success([null, file('https://skytnt.hf.space/file=r.png')]))
    const redirect = (location: string): Response =>
      new Response(null, { status: 302, headers: { location } })
    const fetchMock = vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url.host === 'bria.hf.space') return redirect('https://example.com/evil.png')
      if (url.host === 'skytnt.hf.space') return redirect('https://cdn-lfs.huggingface.co/r.png')
      return new Response(Buffer.from('result-png'))
    })

    const result = await removeBackgroundFree(input, {
      connect: async (id) => (id === BRIA ? bria.client : anime.client),
      fetch: fetchMock as unknown as typeof fetch
    })

    expect(result.spaceId).toBe(ANIME)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://bria.hf.space/file=r.png',
      'https://skytnt.hf.space/file=r.png',
      'https://cdn-lfs.huggingface.co/r.png'
    ])
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true)
  })

  it('rejects an oversized result before reading it all', async () => {
    const bria = fakeClient(success([null, file('https://bria.hf.space/file=r.png')]))
    const anime = fakeClient(
      success([null, 'data:image/png;base64,' + 'A'.repeat(90 * 1024 * 1024)])
    )
    const fetchMock = vi.fn(
      async () =>
        new Response(Buffer.from('x'), { headers: { 'content-length': String(65 * 1024 * 1024) } })
    )

    const error = await removeBackgroundFree(input, {
      connect: async (id) => (id === BRIA ? bria.client : anime.client),
      fetch: fetchMock as unknown as typeof fetch
    }).catch((e: unknown) => e)

    expect((error as FreeBgRemovalError).attempts.map((a) => a.message)).toEqual([
      'Space returned an oversized image',
      'Space returned an oversized image'
    ])
  })

  it('falls back when the result cannot be decoded as an image', async () => {
    const bria = fakeClient(success([null, file('https://bria.hf.space/file=r.png')]))
    const anime = fakeClient(success([null, 'data:image/png;base64,' + btoa('inline')]))
    const decode = vi.fn(async (image: Buffer) => {
      if (image.toString() === 'not-an-image') throw new Error('unsupported image format')
      return Buffer.from('png:' + image.toString())
    })

    const result = await removeBackgroundFree(input, {
      connect: async (id) => (id === BRIA ? bria.client : anime.client),
      fetch: fetchReturning('not-an-image') as unknown as typeof fetch,
      decode
    })

    expect(result.spaceId).toBe(ANIME)
    expect(result.image.toString()).toBe('png:inline')
    expect(decode).toHaveBeenCalledTimes(2)
  })
})

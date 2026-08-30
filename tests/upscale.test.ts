import { afterEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { UPSCALE_MODEL, UPSCALE_SCALE, upscaleImage } from '../src/main/nai/client'
import { ENDPOINTS } from '../src/main/nai/endpoints'

describe('V5 upscaler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the shared V5 Curated 2x upscaler request', async () => {
    const zip = new JSZip()
    zip.file('image_0.png', Buffer.from('upscaled-png'))
    const responseBody = await zip.generateAsync({ type: 'uint8array' })
    const sourceImage = Buffer.from('source-image')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(responseBody, { status: 200 }))

    const png = await upscaleImage(' token ', sourceImage.toString('base64'))

    expect(UPSCALE_SCALE).toBe(2)
    expect(png).toEqual(Buffer.from('upscaled-png'))
    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ENDPOINTS.upscale)
    expect(url).toBe('https://image.novelai.net/ai/upscale')
    expect(init?.method).toBe('POST')

    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer token')
    expect(headers.get('content-type')).toBeNull()

    const body = init?.body
    expect(body).toBeInstanceOf(FormData)
    const image = (body as FormData).get('image')
    expect(image).toBeInstanceOf(Blob)
    expect((image as Blob).type).toBe('image/png')
    expect(Buffer.from(await (image as Blob).arrayBuffer())).toEqual(sourceImage)

    const request = (body as FormData).get('request')
    expect(request).toBeInstanceOf(Blob)
    expect(JSON.parse(await (request as Blob).text())).toEqual({
      image: 'image',
      model: UPSCALE_MODEL,
      declared_blur_sigma: 0
    })
  })
})

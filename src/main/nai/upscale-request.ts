export const UPSCALE_MODEL = 'nai-diffusion-5-curated'
export const UPSCALE_SCALE = 2

/** Shared multipart contract for Electron and the browser development gateway. */
export function upscaleRequest(token: string, imageBase64: string): RequestInit {
  const body = new FormData()
  body.append('image', new Blob([Buffer.from(imageBase64, 'base64')], { type: 'image/png' }))
  body.append(
    'request',
    new Blob([JSON.stringify({ image: 'image', model: UPSCALE_MODEL, declared_blur_sigma: 0 })], {
      type: 'application/json'
    })
  )
  return {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      'x-correlation-id': Math.random().toString(36).slice(2, 8),
      'x-initiated-at': new Date().toISOString()
    },
    body
  }
}

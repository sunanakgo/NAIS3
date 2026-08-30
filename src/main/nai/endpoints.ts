/**
 * NAI 엔드포인트.
 *
 * 2026-06 이전: user 계열이 api.novelai.net에서 image.novelai.net으로 이동했다.
 * 2026-08 V5 업스케일러 전환으로 /ai/upscale도 image 호스트를 사용한다.
 */
export const NAI_HOST = 'https://image.novelai.net'

export const ENDPOINTS = {
  generateImage: `${NAI_HOST}/ai/generate-image`,
  generateImageStream: `${NAI_HOST}/ai/generate-image-stream`,
  suggestTags: `${NAI_HOST}/ai/generate-image/suggest-tags`,
  encodeVibe: `${NAI_HOST}/ai/encode-vibe`,
  augmentImage: `${NAI_HOST}/ai/augment-image`,
  login: `${NAI_HOST}/user/login`,
  userData: `${NAI_HOST}/user/data`,
  userInfo: `${NAI_HOST}/user/information`,
  subscription: `${NAI_HOST}/user/subscription`,
  upscale: `${NAI_HOST}/ai/upscale`
} as const

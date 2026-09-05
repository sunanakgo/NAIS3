import type { GenerationRequest } from '../../shared/types'

/**
 * NAI 웹과 바이트 단위로 동일한 payload를 만드는 것이 이 모듈의 존재 이유다 (P1).
 *
 * 확정 소스: NAI 웹 devtools 실캡처 (2026-07-05, nai-diffusion-4-5-full,
 * tests/fixtures/nai-web-t2i-*.json) — 이 fixture와의 동일성 테스트가 이 모듈의 명세다.
 *
 * 캡처로 확정된 사실:
 * - UC 프리셋은 클라이언트 병합: 프리셋 텍스트가 유저 네거티브 "앞"에 ", "로 붙는다.
 *   ucPreset 인덱스는 메타데이터로만 전송 (NAIS2 이슈 #5의 원인).
 * - autoSmea: false (V4.5)
 * - legacy_uc 키는 어디에도 없음 (NAIS2가 보내던 것과 다름)
 * - 레거시 characterPrompts 배열을 v4_prompt와 병행 전송: {prompt, uc, center, enabled}
 * - image_format: "png", 스트리밍 시 stream: "msgpack"
 * - 웹은 multipart/form-data + recaptcha_token(세션 인증)으로 보내지만,
 *   Bearer 토큰(pst-)의 서드파티 호출은 플레인 JSON으로 동작 (NAIS2 2.7.3에서 검증)
 * - 캐릭터 위치 "AI's Choice" = use_coords: false (좌표는 0.5/0.5로 채워 보냄).
 *   수동 지정 = use_coords: true + 5×5 그리드 좌표(0.1~0.9)가 3곳(v4_prompt·
 *   v4_negative_prompt·characterPrompts)에 동일하게 들어감
 */

// 프리셋 텍스트·병합 규칙은 shared로 이동 (렌더러의 토큰 카운트도 병합 후 텍스트 기준이어야 해서 공유)
export {
  QUALITY_TAGS_SUFFIX,
  UC_PRESETS_V45_FULL,
  mergeQualityTags,
  mergeUcPreset,
  removeComments
} from '../../shared/nai-presets'
import {
  mergeQualityTags,
  mergeUcPreset,
  mergeUcPresetForModel,
  QUALITY_PRESET_HINT,
  UC_PRESET_HINT,
  removeComments
} from '../../shared/nai-presets'
import { isV5Model, modelCapabilities } from '../../shared/nai-models'
import { applyAutoText } from '../../shared/nai-auto-text'

/**
 * Variety+(skip_cfg_above_sigma) 값.
 *
 * - 계수는 모델 의존: V4.5 계열=58 (실캡처 확정), V4 계열=19
 * - 해상도 스케일: 계수 × √(픽셀수/(832×1216)) — 실캡처 확정
 *   (1024×1024 캡처의 59.04722600415217이 이 공식과 마지막 비트까지 일치)
 * - 캐릭터 레퍼런스와의 동시 전송: 일부 서드파티 구현은 "서버가 깨진 결과물을 만든다"며
 *   제거하지만, 2026-07-05 실캡처에서 웹은 CharRef + Variety+ 58을 동시 전송했다.
 *   웹 패리티가 명세이므로 자동 해제하지 않는다 (과거 서버 버그가 수정된 것으로 추정).
 */
export function varietySigma(opts: {
  model: string
  variety: boolean
  width: number
  height: number
}): number | null {
  if (!opts.variety) return null
  const coef = opts.model.includes('nai-diffusion-4-5') ? 58 : 19
  const pixelRatio = (opts.width * opts.height) / (832 * 1216)
  return coef * Math.sqrt(pixelRatio)
}

export interface NaiImagePayload {
  action: 'generate' | 'img2img' | 'infill'
  input: string
  model: string
  parameters: Record<string, unknown>
}

/**
 * i2i 파라미터 (실캡처 확정, action: "img2img"):
 * strength/noise는 상단에, extra_noise_seed/color_correct는 별도 top-level 필드로 들어간다
 * (img2img 서브오브젝트로 싸지 않고 t2i 파이프라인과 동일 평면).
 * 이미지 원본: 웹은 별도 multipart 업로드 후 image_cache_secret_key로 참조.
 * 서드파티 Bearer JSON은 기존처럼 image(base64) 필드 사용.
 * extra_noise_seed 생성 규칙은 미확정 (캡처에서 seed-1이었으나 표본 1개) — TODO(fixture).
 */
export interface I2iOptions {
  strength: number
  noise: number
  extraNoiseSeed: number
  colorCorrect: boolean
  /** 웹 캐시 업로드 방식 (fixture 재현용) */
  imageCacheSecretKey?: string
  /** 서드파티 JSON 방식 */
  imageBase64?: string
  /**
   * 인페인트 마스크 (흰색=재생성 영역). 있으면 action이 infill로 바뀐다.
   * TODO(fixture): 인페인트 실캡처 미확보 — mask 전송 형태·필드는 교차 자료 기반 추정
   */
  maskBase64?: string
}

/**
 * 캐릭터 레퍼런스 (실캡처 확정):
 * - secondary_strength_values = 1 − fidelity (fidelity 1 → 0)
 * - information_extracted는 항상 1
 * - descriptions.caption.base_caption = 'character' | 'character&style' (+ legacy_uc: false)
 * - 이미지: 웹은 director_reference_images_cached({cache_secret_key}), 서드파티는 base64 배열
 */
export interface CharacterReferenceOptions {
  /** 실캡처는 character&style. costume/delta는 웹 번들 enum에서 확인된 신규 타입 */
  referenceType: 'character' | 'style' | 'character&style' | 'costume' | 'delta'
  strength: number
  fidelity: number
  cacheSecretKey?: string
  imageBase64?: string
}

/**
 * 바이브 트랜스퍼 (실캡처 확정):
 * - JSON에는 reference_strength_multiple만 — information extracted는 encode-vibe
 *   단계에서 인코딩에 반영되므로 생성 요청 JSON에 나타나지 않는다
 * - 이미지: 웹은 reference_image_multiple_cached({cache_secret_key, data: 파트명}),
 *   서드파티는 reference_image_multiple(인코딩된 바이브 base64)
 */
export interface VibeOptions {
  strength: number
  cached?: { cacheSecretKey: string; data: string }
  encodedVibeBase64?: string
}

export interface BuildOptions {
  /** 스트리밍 미리보기 사용 시 'msgpack' (웹 캡처 기준) */
  stream?: 'msgpack'
  i2i?: I2iOptions
  characterReferences?: CharacterReferenceOptions[]
  vibes?: VibeOptions[]
  /** 출력 이미지 포맷 (NAI 지원: png/webp). 기본 png */
  imageFormat?: 'png' | 'webp'
  /** V5 native alpha generation. */
  transparentBackground?: boolean
}

export function buildGenerateImagePayload(
  req: GenerationRequest,
  opts: BuildOptions = {}
): NaiImagePayload {
  const v5 = isV5Model(req.model)
  const capabilities = modelCapabilities(req.model)
  const transparent = v5 && (opts.transparentBackground ?? req.transparentBackground ?? false)
  const userPrompt = removeComments(req.prompt)
  const qualityPrompt = mergeQualityTags(userPrompt, req.qualityToggle)
  const promptWithQuality = transparent
    ? mergeQualityTags(
        userPrompt ? `${userPrompt}, transparent background` : 'transparent background',
        req.qualityToggle
      )
    : qualityPrompt
  const negative = v5
    ? mergeUcPresetForModel(removeComments(req.negativePrompt), req.ucPreset, req.model, userPrompt)
    : mergeUcPreset(removeComments(req.negativePrompt), req.ucPreset)

  // 캐릭터 프롬프트도 주석(#) 제거 — 기본/네거만 걸러지고 캐릭터 칸은 그대로 전송되던 버그 수정
  const activeChars = req.characterPrompts
    .map((c) => ({
      ...c,
      prompt: removeComments(c.prompt),
      negativePrompt: removeComments(c.negativePrompt)
    }))
    .filter((c) => c.enabled && c.prompt.trim())
    .slice(0, capabilities.maxCharacters)
  // V5 웹의 Auto Text: 따옴표 속 문구를 마지막 `teXt:` 블록으로 반복해 문자 렌더링에 전달한다.
  // 품질 태그의 `no text` 뒤에 와야 하며, input과 v4_prompt.base_caption은 같은 값을 써야 한다.
  const prompt = v5
    ? applyAutoText(promptWithQuality, activeChars, req.useCoords)
    : promptWithQuality
  const center = (c: (typeof activeChars)[number]): { x: number; y: number } =>
    req.useCoords ? (c.center ?? { x: 0.5, y: 0.5 }) : { x: 0.5, y: 0.5 }

  return {
    action: opts.i2i ? (opts.i2i.maskBase64 ? 'infill' : 'img2img') : 'generate',
    input: prompt,
    model: req.model,
    parameters: {
      params_version: v5 ? 4 : 3,
      width: req.width,
      height: req.height,
      scale: req.cfgScale,
      sampler: req.sampler,
      steps: req.steps,
      n_samples: 1,
      ...(opts.i2i
        ? opts.i2i.maskBase64
          ? {
              // 인페인트: NativeInfillingRequest + noise 0. mask는 8px 격자 정렬.
              noise: opts.i2i.noise,
              request_type: 'NativeInfillingRequest',
              ...(opts.i2i.imageCacheSecretKey
                ? { image_cache_secret_key: opts.i2i.imageCacheSecretKey }
                : {}),
              ...(opts.i2i.imageBase64 ? { image: opts.i2i.imageBase64 } : {}),
              mask: opts.i2i.maskBase64
            }
          : {
              strength: opts.i2i.strength,
              noise: opts.i2i.noise,
              extra_noise_seed: opts.i2i.extraNoiseSeed,
              color_correct: opts.i2i.colorCorrect,
              ...(opts.i2i.imageCacheSecretKey
                ? { image_cache_secret_key: opts.i2i.imageCacheSecretKey }
                : {}),
              ...(opts.i2i.imageBase64 ? { image: opts.i2i.imageBase64 } : {})
            }
        : {}),
      ucPreset: req.ucPreset,
      qualityToggle: req.qualityToggle,
      ...(v5
        ? {
            tag_hint_qt: req.qualityToggle
              ? QUALITY_PRESET_HINT.standard
              : QUALITY_PRESET_HINT.none,
            tag_hint_uc_preset: UC_PRESET_HINT[req.ucPreset],
            ...(transparent
              ? {
                  straight_alpha: true,
                  tag_hint_transparent_background: true
                }
              : {})
          }
        : {}),
      autoSmea: false,
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      // 인페인트는 add_original_image=true: 서버가 마스크 밖을 원본으로 합성
      add_original_image: true,
      cfg_rescale: req.cfgRescale,
      noise_schedule: v5 ? 'karras' : req.noiseSchedule,
      legacy_v3_extend: false,
      ...(capabilities.variety
        ? {
            skip_cfg_above_sigma: varietySigma({
              model: req.model,
              variety: req.variety,
              width: req.width,
              height: req.height
            })
          }
        : {}),
      use_coords: req.useCoords,
      normalize_reference_strength_multiple: true,
      // 인페인트는 strength를 여기로 (NAIS2: inpaintImg2ImgStrength = userStrength 0.7)
      inpaintImg2ImgStrength: opts.i2i?.maskBase64 ? opts.i2i.strength : 1,
      seed: req.seed,
      v4_prompt: {
        caption: {
          base_caption: prompt,
          char_captions: activeChars.map((c) => ({
            char_caption: c.prompt,
            centers: [center(c)]
          }))
        },
        use_coords: req.useCoords,
        use_order: true
      },
      v4_negative_prompt: {
        caption: {
          base_caption: negative,
          char_captions: activeChars.map((c) => ({
            char_caption: c.negativePrompt,
            centers: [center(c)]
          }))
        }
      },
      characterPrompts: activeChars.map((c) => ({
        prompt: c.prompt,
        uc: c.negativePrompt,
        center: center(c),
        enabled: true
      })),
      ...(capabilities.characterReferences && opts.characterReferences?.length
        ? {
            director_reference_descriptions: opts.characterReferences.map((r) => ({
              caption: { base_caption: r.referenceType, char_captions: [] },
              legacy_uc: false
            })),
            director_reference_information_extracted: opts.characterReferences.map(() => 1),
            director_reference_strength_values: opts.characterReferences.map((r) => r.strength),
            director_reference_secondary_strength_values: opts.characterReferences.map(
              (r) => 1 - r.fidelity
            ),
            ...(opts.characterReferences.some((r) => r.cacheSecretKey)
              ? {
                  director_reference_images_cached: opts.characterReferences
                    .filter((r) => r.cacheSecretKey)
                    .map((r) => ({ cache_secret_key: r.cacheSecretKey }))
                }
              : {}),
            ...(opts.characterReferences.some((r) => r.imageBase64)
              ? {
                  director_reference_images: opts.characterReferences
                    .filter((r) => r.imageBase64)
                    .map((r) => r.imageBase64)
                }
              : {})
          }
        : {}),
      ...(capabilities.vibes && opts.vibes?.length
        ? {
            reference_strength_multiple: opts.vibes.map((v) => v.strength),
            ...(opts.vibes.some((v) => v.cached)
              ? {
                  reference_image_multiple_cached: opts.vibes
                    .filter((v) => v.cached)
                    .map((v) => ({
                      cache_secret_key: v.cached!.cacheSecretKey,
                      data: v.cached!.data
                    }))
                }
              : {}),
            ...(opts.vibes.some((v) => v.encodedVibeBase64)
              ? {
                  reference_image_multiple: opts.vibes
                    .filter((v) => v.encodedVibeBase64)
                    .map((v) => v.encodedVibeBase64)
                }
              : {})
          }
        : {}),
      negative_prompt: negative,
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true,
      image_format: opts.imageFormat ?? 'png',
      ...(opts.stream ? { stream: opts.stream } : {})
    }
  }
}

import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { GenerationRequest, UcPresetIndex } from '../src/shared/types'
import {
  buildGenerateImagePayload,
  mergeUcPreset,
  removeComments,
  varietySigma,
  UC_PRESETS_V45_FULL,
  QUALITY_TAGS_SUFFIX,
  type NaiImagePayload
} from '../src/main/nai/payload'

const baseRequest: GenerationRequest = {
  prompt: '1girl, silver hair',
  negativePrompt: 'lowres',
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  cfgScale: 5,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  seed: 1234567890,
  variety: false,
  qualityToggle: false,
  ucPreset: 2, // None (추정)
  characterPrompts: [],
  useCoords: false
}

describe('payload builder', () => {
  it('주석은 #로 시작하는 줄만 (NAIS2 동일) — 줄 중간 #는 태그의 일부로 유지', () => {
    expect(removeComments('a\n# comment\nb')).toBe('a\nb')
    expect(removeComments('  # indented comment\nkeep')).toBe('keep')
    // 줄 중간 #는 주석이 아님 — sours#OOO 같은 아티스트 태그 실사용 케이스
    expect(removeComments('sours#OOO, tag2\ntag3')).toBe('sours#OOO, tag2\ntag3')
    expect(removeComments('tag1, tag2 # 메모\ntag3')).toBe('tag1, tag2 # 메모\ntag3')
  })

  it('UC 프리셋 None(4)은 네거티브를 그대로 두고, 3은 Human Focus다 (실캡처 매핑)', () => {
    expect(mergeUcPreset('lowres', 4)).toBe('lowres')
    expect(mergeUcPreset('lowres', 3)).toBe(UC_PRESETS_V45_FULL[3] + ', lowres')
  })

  it('UC 프리셋은 유저 네거티브 앞에 ", "로 병합된다 (실캡처 확정 규칙)', () => {
    expect(mergeUcPreset('lowres', 0)).toBe(UC_PRESETS_V45_FULL[0] + ', lowres')
    expect(mergeUcPreset('', 0)).toBe(UC_PRESETS_V45_FULL[0])
  })

  it('시드와 핵심 파라미터가 요청 그대로 payload에 들어간다', () => {
    const p = buildGenerateImagePayload(baseRequest)
    expect(p.parameters.seed).toBe(1234567890)
    expect(p.parameters.scale).toBe(5)
    expect(p.parameters.width).toBe(832)
    expect(p.model).toBe('nai-diffusion-4-5-full')
  })

  it('input과 v4_prompt.base_caption은 항상 동일하다 (NAIS2 이슈 #2 회귀 방지)', () => {
    const p = buildGenerateImagePayload({ ...baseRequest, prompt: 'a\n# x\nb' })
    expect(p.input).toBe(
      (p.parameters.v4_prompt as { caption: { base_caption: string } }).caption.base_caption
    )
  })

  describe('variety+ (skip_cfg_above_sigma)', () => {
    it('기본 픽셀수에서 V4.5는 58(실캡처 확정), V4는 19', () => {
      expect(
        varietySigma({ model: 'nai-diffusion-4-5-full', variety: true, width: 832, height: 1216 })
      ).toBe(58)
      expect(
        varietySigma({ model: 'nai-diffusion-4-full', variety: true, width: 832, height: 1216 })
      ).toBe(19)
    })

    it('해상도에 따라 √(픽셀비)로 스케일된다', () => {
      const v = varietySigma({
        model: 'nai-diffusion-4-5-full',
        variety: true,
        width: 1216,
        height: 1216
      })
      expect(v).toBeCloseTo(58 * Math.sqrt((1216 * 1216) / (832 * 1216)), 10)
    })

    it('variety가 꺼져 있으면 null', () => {
      expect(
        varietySigma({ model: 'nai-diffusion-4-5-full', variety: false, width: 832, height: 1216 })
      ).toBeNull()
    })
  })

  it('비활성 캐릭터 프롬프트는 payload에 들어가지 않는다', () => {
    const p = buildGenerateImagePayload({
      ...baseRequest,
      characterPrompts: [
        { prompt: 'girl A', negativePrompt: '', enabled: true },
        { prompt: 'girl B', negativePrompt: '', enabled: false }
      ]
    })
    const v4 = p.parameters.v4_prompt as { caption: { char_captions: unknown[] } }
    expect(v4.caption.char_captions).toHaveLength(1)
    expect(p.parameters.characterPrompts).toHaveLength(1)
  })

  it('useCoords가 꺼져 있으면 좌표는 항상 (0.5, 0.5)다', () => {
    const p = buildGenerateImagePayload({
      ...baseRequest,
      useCoords: false,
      characterPrompts: [
        { prompt: 'girl', negativePrompt: '', center: { x: 0.1, y: 0.9 }, enabled: true }
      ]
    })
    const v4 = p.parameters.v4_prompt as {
      caption: { char_captions: { centers: { x: number; y: number }[] }[] }
    }
    expect(v4.caption.char_captions[0].centers[0]).toEqual({ x: 0.5, y: 0.5 })
  })

  it('퀄리티 태그는 프롬프트 뒤에 그대로 이어 붙는다 (실캡처: ",,"이 생겨도 그대로)', () => {
    const p = buildGenerateImagePayload({
      ...baseRequest,
      prompt: 'dynamic angle,',
      qualityToggle: true
    })
    expect(p.input).toBe('dynamic angle,' + QUALITY_TAGS_SUFFIX)
  })
})

describe('NAI 웹 실캡처 fixture 동일성 (2026-07-05, V4.5 full)', () => {
  function loadFixture(name: string): NaiImagePayload {
    return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'))
  }

  /** fixture payload에서 유저가 UI에 입력했을 값들을 역산해 GenerationRequest를 만든다 */
  function requestFromFixture(fx: NaiImagePayload): GenerationRequest {
    const p = fx.parameters as Record<string, never> & {
      negative_prompt: string
      characterPrompts: { prompt: string; uc: string; center: { x: number; y: number } }[]
      [k: string]: unknown
    }
    const ucPreset = p.ucPreset as UcPresetIndex
    const presetText = UC_PRESETS_V45_FULL[ucPreset]
    // 캡처의 negative는 프리셋이 이미 병합된 결과 — 유저 입력분만 분리 (None이면 병합 없음)
    let userNegative = p.negative_prompt
    if (presetText) {
      expect(p.negative_prompt).toMatch(new RegExp('^' + escapeRegExp(presetText + ', ')))
      userNegative = p.negative_prompt.slice(presetText.length + 2)
    }

    // 캡처의 input은 퀄리티 태그가 이미 병합된 결과 — 유저 입력분만 분리
    let userPrompt = fx.input
    if (p.qualityToggle) {
      expect(fx.input.endsWith(QUALITY_TAGS_SUFFIX)).toBe(true)
      userPrompt = fx.input.slice(0, -QUALITY_TAGS_SUFFIX.length)
    }

    return {
      prompt: userPrompt,
      negativePrompt: userNegative,
      model: fx.model,
      width: p.width as number,
      height: p.height as number,
      steps: p.steps as number,
      cfgScale: p.scale as number,
      cfgRescale: p.cfg_rescale as number,
      sampler: p.sampler as string,
      noiseSchedule: p.noise_schedule as string,
      seed: p.seed as number,
      variety: p.skip_cfg_above_sigma !== null,
      qualityToggle: p.qualityToggle as boolean,
      ucPreset,
      useCoords: p.use_coords as boolean,
      characterPrompts: p.characterPrompts.map((c) => ({
        prompt: c.prompt,
        negativePrompt: c.uc,
        center: c.center,
        enabled: true
      }))
    }
  }

  it.each([
    'nai-web-t2i-default.json',
    'nai-web-t2i-variety.json',
    'nai-web-t2i-2char.json',
    'nai-web-t2i-quality.json',
    'nai-web-t2i-uc-light.json',
    'nai-web-t2i-uc-humanfocus.json',
    'nai-web-t2i-variety-1024.json',
    'nai-web-t2i-coords.json',
    'nai-web-t2i-uc-none.json'
  ])('%s — 같은 입력이면 웹과 동일한 payload를 만든다', (name) => {
    const fx = loadFixture(name)
    const built = buildGenerateImagePayload(requestFromFixture(fx), { stream: 'msgpack' })
    expect(built).toEqual(fx)
  })

  it('nai-web-charref.json — 캐릭터 레퍼런스: secondary = 1−fidelity, Variety+ 유지', () => {
    const fx = loadFixture('nai-web-charref.json')
    const built = buildGenerateImagePayload(requestFromFixture(fx), {
      stream: 'msgpack',
      characterReferences: [
        {
          referenceType: 'character&style',
          strength: 1,
          fidelity: 1, // → secondary_strength_values [0]
          cacheSecretKey: '12bb9310725054bf049a3d9e430b192f8d65a760ea672a99820566d732cd412d'
        }
      ]
    })
    expect(built).toEqual(fx)
    // 실캡처 핵심: CharRef가 있어도 skip_cfg_above_sigma는 58 그대로다
    expect(built.parameters.skip_cfg_above_sigma).toBe(58)
  })

  it('nai-web-vibe.json — 바이브: strength만 JSON에, info extracted는 인코딩에 반영', () => {
    const fx = loadFixture('nai-web-vibe.json')
    const built = buildGenerateImagePayload(requestFromFixture(fx), {
      stream: 'msgpack',
      vibes: [
        {
          strength: 0.6,
          cached: {
            cacheSecretKey: 'f9d2847f65435071139359950e3f4e2faf27533fe12f4ee9b0405bddf67aec6e',
            data: 'ref_multiple_0'
          }
        }
      ]
    })
    expect(built).toEqual(fx)
  })

  it('nai-web-i2i.json — i2i도 웹과 동일한 payload를 만든다 (action, strength/noise, 캐시 키)', () => {
    const fx = loadFixture('nai-web-i2i.json')
    const p = fx.parameters as {
      strength: number
      noise: number
      extra_noise_seed: number
      color_correct: boolean
      image_cache_secret_key: string
    }
    const built = buildGenerateImagePayload(requestFromFixture(fx), {
      stream: 'msgpack',
      i2i: {
        strength: p.strength,
        noise: p.noise,
        extraNoiseSeed: p.extra_noise_seed,
        colorCorrect: p.color_correct,
        imageCacheSecretKey: p.image_cache_secret_key
      }
    })
    expect(built).toEqual(fx)
  })
})

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

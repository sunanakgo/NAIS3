import { describe, expect, it } from 'vitest'
import {
  baseModelForSelect,
  effectiveSteps,
  effortOf,
  generationDefaultsForModel,
  hasEffortToggle,
  isMediumEffortModel,
  withEffort,
  canEnableAnotherCharacter,
  inpaintingModelFor,
  isV5Model,
  modelCapabilities,
  promptTokenLimit
} from '../src/shared/nai-models'

describe('NAI 모델별 동작', () => {
  it('V5 Curated와 Full을 식별한다', () => {
    expect(isV5Model('nai-diffusion-5-curated')).toBe(true)
    expect(isV5Model('nai-diffusion-5-full')).toBe(true)
    expect(isV5Model('nai-diffusion-4-5-full')).toBe(false)
  })

  it('V5 웹 기본값은 23 steps, CFG 7, Euler Ancestral이다', () => {
    expect(generationDefaultsForModel('nai-diffusion-5-full')).toMatchObject({
      steps: 23,
      cfgScale: 7,
      sampler: 'k_euler_ancestral',
      noiseSchedule: 'karras',
      variety: false
    })
  })

  it('V5는 출시 시점에 바이브·정밀 레퍼런스·Variety+를 지원하지 않는다', () => {
    expect(modelCapabilities('nai-diffusion-5-curated')).toMatchObject({
      vibes: false,
      characterReferences: false,
      variety: false,
      noiseScheduleSelection: false,
      transparency: true,
      maxCharacters: 32
    })
  })

  it('V5는 캐릭터 32명까지, V4.5는 6명까지 활성화할 수 있다', () => {
    expect(canEnableAnotherCharacter('nai-diffusion-5-full', 31)).toBe(true)
    expect(canEnableAnotherCharacter('nai-diffusion-5-full', 32)).toBe(false)
    expect(canEnableAnotherCharacter('nai-diffusion-4-5-full', 5)).toBe(true)
    expect(canEnableAnotherCharacter('nai-diffusion-4-5-full', 6)).toBe(false)
  })

  it('프롬프트 한도는 V5 Curated 703, Full 1471이고 V4.5는 512다', () => {
    expect(promptTokenLimit('nai-diffusion-5-curated')).toBe(703)
    expect(promptTokenLimit('nai-diffusion-5-full')).toBe(1471)
    expect(promptTokenLimit('nai-diffusion-4-5-full')).toBe(512)
  })

  it('V5 Full은 전용 인페인트, Curated는 V4.5 Curated 인페인트를 쓴다', () => {
    expect(inpaintingModelFor('nai-diffusion-5-full')).toBe('nai-diffusion-5-full-inpainting')
    expect(inpaintingModelFor('nai-diffusion-5-curated')).toBe(
      'nai-diffusion-4-5-curated-inpainting'
    )
  })
})

describe('V5 Full Effort 토글 (Medium/High)', () => {
  it('Medium은 별도 모델 id이며 V5 Full에서만 토글된다', () => {
    expect(withEffort('nai-diffusion-5-full', 'medium')).toBe('nai-diffusion-5-full-medium')
    expect(withEffort('nai-diffusion-5-full-medium', 'high')).toBe('nai-diffusion-5-full')
    expect(withEffort('nai-diffusion-5-curated', 'medium')).toBe('nai-diffusion-5-curated')
    expect(hasEffortToggle('nai-diffusion-5-full-medium')).toBe(true)
    expect(hasEffortToggle('nai-diffusion-4-5-full')).toBe(false)
    expect(effortOf('nai-diffusion-5-full')).toBe('high')
    expect(effortOf('nai-diffusion-5-full-medium-inpainting')).toBe('medium')
    expect(baseModelForSelect('nai-diffusion-5-full-medium')).toBe('nai-diffusion-5-full')
  })

  it('Medium은 전용 인페인트 모델을 쓰고 V5 Full의 한도·기본값을 공유한다', () => {
    expect(inpaintingModelFor('nai-diffusion-5-full-medium')).toBe(
      'nai-diffusion-5-full-medium-inpainting'
    )
    expect(isMediumEffortModel('nai-diffusion-5-full-medium-inpainting')).toBe(true)
    expect(promptTokenLimit('nai-diffusion-5-full-medium')).toBe(1471)
    expect(modelCapabilities('nai-diffusion-5-full-medium')).toEqual(
      modelCapabilities('nai-diffusion-5-full')
    )
  })

  it('Medium은 실제 전송 스텝이 14로 고정된다', () => {
    expect(effectiveSteps('nai-diffusion-5-full-medium', 28)).toBe(14)
    expect(effectiveSteps('nai-diffusion-5-full', 28)).toBe(28)
  })
})

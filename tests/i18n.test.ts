import { describe, expect, it } from 'vitest'
import { format, isLang, translate } from '../src/shared/i18n'
import { EN } from '../src/shared/i18n/catalog-en'
import { KO } from '../src/shared/i18n/catalog-ko'

describe('i18n core', () => {
  it('안정적인 메시지 ID로 언어별 카탈로그를 조회한다', () => {
    expect(translate('ko', 'ui.settings', [])).toBe('설정')
    expect(translate('en', 'ui.settings', [])).toBe('Settings')
    expect(translate('ko', 'ui.valueImages', [3])).toBe('3장')
  })

  it('한국어와 영어 카탈로그의 메시지 ID가 완전히 일치한다', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(KO).sort())
  })

  it('메시지 ID는 표시 언어와 분리된 stable ID다', () => {
    for (const id of Object.keys(KO)) {
      expect(id).toMatch(/^ui\.[A-Za-z0-9.]+$/)
      expect(id).not.toMatch(/[가-힣]/)
    }
  })

  it('영어 복수형 {0|a|b}는 1일 때만 단수', () => {
    expect(format('{0} {0|image|images}', [1])).toBe('1 image')
    expect(format('{0} {0|image|images}', [2])).toBe('2 images')
    expect(format('{0} {0|image|images}', [0])).toBe('0 images')
  })

  it('복수형 판정은 {0}이 아닌 인덱스도 따른다', () => {
    expect(format('{0}: {1} {1|image|images}', ['씬', 1])).toBe('씬: 1 image')
    expect(format('{0}: {1} {1|image|images}', ['씬', 5])).toBe('씬: 5 images')
  })

  it('toLocaleString으로 콤마가 낀 수는 복수로 본다', () => {
    expect(format('{0} {0|image|images}', ['1'])).toBe('1 image')
    expect(format('{0} {0|image|images}', ['1,234'])).toBe('1,234 images')
  })

  it('인자가 없으면 템플릿을 건드리지 않는다', () => {
    expect(format('{0} {0|image|images}', [])).toBe('{0} {0|image|images}')
  })

  it('한국어 메시지에는 복수형 문법이 없어 ko 경로에 영향이 없다', () => {
    for (const value of Object.values(KO)) expect(value).not.toMatch(/\{\d+\|/)
  })

  it('언어별 메시지의 플레이스홀더는 일치한다', () => {
    // 값은 같은 인덱스를 두 번 쓸 수 있다 ({0} + {0|scene|scenes}) — 집합으로 비교
    const slots = (s: string): string[] => [
      ...new Set([...s.matchAll(/\{(\d+)[|}]/g)].map((m) => m[1]))
    ]
    for (const id of Object.keys(KO) as (keyof typeof KO)[]) {
      expect([id, slots(EN[id]).sort()]).toEqual([id, slots(KO[id]).sort()])
    }
  })

  it('isLang은 알 수 없는 값을 거른다', () => {
    expect(isLang('ko')).toBe(true)
    expect(isLang('en')).toBe(true)
    expect(isLang('jp')).toBe(false)
    expect(isLang(null)).toBe(false)
  })
})

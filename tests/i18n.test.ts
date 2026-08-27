import { describe, expect, it } from 'vitest'
import { format, isLang, localeToLang, translate } from '../src/shared/i18n'
import { EN } from '../src/shared/i18n/dict-en'
import { ZH_CN } from '../src/shared/i18n/dict-zh-CN'

describe('i18n core', () => {
  it('한국어 모드는 원문을 그대로 돌려준다 (기존 사용자 무영향)', () => {
    expect(translate(EN, 'ko', '설정', [])).toBe('설정')
    expect(translate(EN, 'ko', '{0}장', [3])).toBe('3장')
    // 사전에 있는 키라도 ko에서는 절대 영어가 나오면 안 된다
    for (const key of Object.keys(EN).slice(0, 50)) {
      expect(translate(EN, 'ko', key, [])).toBe(key)
    }
  })

  it('사전에 없는 키는 한국어로 폴백한다', () => {
    expect(translate(EN, 'en', '사전에 없는 문구', [])).toBe('사전에 없는 문구')
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

  it('한국어 키에는 복수형 문법이 없어 ko 경로에 영향이 없다', () => {
    for (const key of Object.keys(EN)) expect(key).not.toMatch(/\{\d+\|/)
  })

  it('사전 값의 플레이스홀더는 키와 일치한다', () => {
    // 값은 같은 인덱스를 두 번 쓸 수 있다 ({0} + {0|scene|scenes}) — 집합으로 비교
    const slots = (s: string): string[] => [
      ...new Set([...s.matchAll(/\{(\d+)[|}]/g)].map((m) => m[1]))
    ]
    for (const [key, value] of Object.entries(EN)) {
      expect([key, slots(value).sort()]).toEqual([key, slots(key).sort()])
    }
  })

  it('isLang은 알 수 없는 값을 거른다', () => {
    expect(isLang('ko')).toBe(true)
    expect(isLang('en')).toBe(true)
    expect(isLang('zh-CN')).toBe(true)
    expect(isLang('zh')).toBe(false)
    expect(isLang('zh-TW')).toBe(false)
    expect(isLang('jp')).toBe(false)
    expect(isLang(null)).toBe(false)
  })

  it('간체 모드는 ZH_CN 사전을 사용한다', () => {
    expect(translate(ZH_CN, 'zh-CN', '설정', [])).toBe('设置')
  })

  it('ZH_CN에 없는 키는 한국어로 폴백한다', () => {
    expect(translate(ZH_CN, 'zh-CN', '사전에 없는 문구', [])).toBe('사전에 없는 문구')
  })

  it('한국어 모드는 ZH_CN을 넘겨도 원문을 돌려준다', () => {
    expect(translate(ZH_CN, 'ko', '설정', [])).toBe('설정')
  })

  it('ZH_CN 키 집합은 EN과 같다', () => {
    expect(Object.keys(ZH_CN).sort()).toEqual(Object.keys(EN).sort())
  })

  it('ZH_CN 값의 플레이스홀더는 키와 일치한다', () => {
    const slots = (s: string): string[] => [
      ...new Set([...s.matchAll(/\{(\d+)[|}]/g)].map((m) => m[1]))
    ]
    for (const [key, value] of Object.entries(ZH_CN)) {
      expect([key, slots(value).sort()]).toEqual([key, slots(key).sort()])
    }
  })

  it('ZH_CN 값에는 영어 복수형 문법이 없다', () => {
    for (const value of Object.values(ZH_CN)) expect(value).not.toMatch(/\{\d+\|/)
  })

  it('localeToLang은 간체만 zh-CN으로, 번체는 en으로 매핑한다', () => {
    expect(localeToLang('ko')).toBe('ko')
    expect(localeToLang('ko-KR')).toBe('ko')
    expect(localeToLang('zh-CN')).toBe('zh-CN')
    expect(localeToLang('zh-Hans')).toBe('zh-CN')
    expect(localeToLang('zh-Hans-CN')).toBe('zh-CN')
    expect(localeToLang('zh_CN')).toBe('zh-CN')
    expect(localeToLang('zh-SG')).toBe('zh-CN')
    expect(localeToLang('zh')).toBe('zh-CN')
    expect(localeToLang('zh-TW')).toBe('en')
    expect(localeToLang('zh-HK')).toBe('en')
    expect(localeToLang('zh-MO')).toBe('en')
    expect(localeToLang('zh-Hant')).toBe('en')
    expect(localeToLang('zh-Hant-TW')).toBe('en')
    expect(localeToLang('en-US')).toBe('en')
    expect(localeToLang('ja')).toBe('en')
  })
})

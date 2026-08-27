import { EN } from './dict-en'
import { ZH_CN } from './dict-zh-CN'

/**
 * 한국어 원문을 키로 쓰는 최소 i18n 레이어.
 * - ko: 키(원문)를 그대로 사용
 * - 그 외: 전달된 dict에서 매핑, 없으면 원문 폴백
 * 파라미터는 {0}, {1} 위치 플레이스홀더로 치환한다.
 *
 * 저장 코드는 'zh-CN' (간체). 공용 'zh'는 쓰지 않는다 —
 * 번체는 이번 범위가 아니며, 이후 기여자가 별도 코드를 넣을 여지를 남긴다.
 */
export type Lang = 'ko' | 'en' | 'zh-CN'

export function isLang(value: unknown): value is Lang {
  return value === 'ko' || value === 'en' || value === 'zh-CN'
}

/** ko 경로는 dict를 읽지 않으므로 EN을 넘겨도 된다. */
export function dictFor(lang: Lang): Record<string, string> {
  if (lang === 'zh-CN') return ZH_CN
  return EN
}

/**
 * OS/Chromium locale → UI Lang. 새 설치 초기값에만 사용.
 * 'zh-CN'은 간체 카탈로그(중국만이 아님: zh-SG/zh-Hans도 여기로).
 * 번체(zh-TW / zh-HK / zh-MO / Hant)와 그 외 언어는 지금은 en.
 */
export function localeToLang(locale: string): Lang {
  const n = locale.toLowerCase().replace(/_/g, '-')
  if (n === 'ko' || n.startsWith('ko-')) return 'ko'
  if (n === 'zh' || n.startsWith('zh-')) {
    if (
      n.includes('hant') ||
      n.startsWith('zh-tw') ||
      n.startsWith('zh-hk') ||
      n.startsWith('zh-mo')
    ) {
      return 'en'
    }
    return 'zh-CN'
  }
  return 'en'
}

/**
 * {0}, {1}, ... 플레이스홀더를 args로 치환.
 * 영어 복수형은 {0|image|images} 형태로 args[0]이 1인지에 따라 고른다.
 * (한국어는 복수형이 없어 키에 이 문법이 등장하지 않는다 — 한국어 모드는 무영향)
 */
export function format(template: string, args: readonly (string | number)[]): string {
  if (args.length === 0) return template
  return template
    .replace(/\{(\d+)\|([^|{}]*)\|([^|{}]*)\}/g, (match, index, one, many) => {
      const value = args[Number(index)]
      return value === undefined ? match : Number(value) === 1 ? one : many
    })
    .replace(/\{(\d+)\}/g, (match, index) => {
      const value = args[Number(index)]
      return value === undefined ? match : String(value)
    })
}

export function translate(
  dict: Record<string, string>,
  lang: Lang,
  key: string,
  args: readonly (string | number)[]
): string {
  return format(lang === 'ko' ? key : (dict[key] ?? key), args)
}

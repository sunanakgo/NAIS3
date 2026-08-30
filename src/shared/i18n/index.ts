import { EN } from './catalog-en'
import { KO, type MessageCatalog, type MessageId } from './catalog-ko'

export type { MessageCatalog, MessageId } from './catalog-ko'

export type Lang = 'ko' | 'en'

const CATALOGS: Record<Lang, MessageCatalog> = { ko: KO, en: EN }

export function isLang(value: unknown): value is Lang {
  return value === 'ko' || value === 'en'
}

/**
 * {0}, {1}, ... 플레이스홀더를 args로 치환.
 * 영어 복수형은 {0|image|images} 형태로 args[0]이 1인지에 따라 고른다.
 * Korean messages do not use the plural form syntax.
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

export function translate(lang: Lang, id: MessageId, args: readonly (string | number)[]): string {
  return format(CATALOGS[lang][id], args)
}

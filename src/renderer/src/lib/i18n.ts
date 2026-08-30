import { create } from 'zustand'
import { isLang, translate, type Lang, type MessageId } from '@shared/i18n'

interface LanguageState {
  lang: Lang
  setLang: (lang: Lang) => void
  /** SQLite settings에서 초기값 로드. 미설정이면 OS 로케일로 결정 */
  hydrate: () => Promise<void>
}

export const useLanguageStore = create<LanguageState>((set) => ({
  lang: 'ko',
  setLang: (lang) => {
    set({ lang })
    void window.nais.invoke('settings:set', { key: 'ui_language', value: lang })
  },
  hydrate: async () => {
    // 메인이 시작 시 ui_language를 확정·저장한다(기존 설치=ko, 새 설치=OS 로케일).
    // 여기서 OS 로케일로 폴백하면 그 판정을 덮어써서 기존 사용자가 영어로 뒤집힌다.
    const { value } = await window.nais.invoke('settings:get', { key: 'ui_language' })
    set({ lang: isLang(value) ? value : 'ko' })
  }
}))

/**
 * Translate a stable message ID using the current language.
 * 컴포넌트 렌더 경로에서는 언어 변경 시 리렌더가 필요하므로 useT()를 쓴다.
 */
export function t(id: MessageId, ...args: (string | number)[]): string {
  return translate(useLanguageStore.getState().lang, id, args)
}

/** 언어 store를 구독해 언어 변경 시 리렌더되는 t */
export function useT(): typeof t {
  useLanguageStore((s) => s.lang)
  return t
}

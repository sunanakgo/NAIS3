import { app } from 'electron'
import { dictFor, isLang, localeToLang, translate, type Lang } from '../shared/i18n'
import { getDb } from './db'
import { getSetting, setSetting } from './db/settings'

/** DB가 아직 없거나 실패해도 안전하게 현재 언어를 결정 */
function currentLang(): Lang {
  try {
    const value = getSetting('ui_language')
    if (isLang(value)) return value
  } catch {
    // DB 초기화 전 — 로케일 폴백
  }
  // 여기 도달 = resolveInitialLanguage 이전(DB 미초기화). 기존 사용자 보호를 위해 한국어.
  return 'ko'
}

/** 메인 프로세스용 번역 (다이얼로그 제목, 네이티브 UI, 업데이트 알림 등) */
export function t(key: string, ...args: (string | number)[]): string {
  const lang = currentLang()
  return translate(dictFor(lang), lang, key, args)
}

/**
 * 최초 1회 언어 결정 후 settings에 고정한다. DB 초기화 직후 호출.
 *
 * 기존 사용자 방어: ui_language가 없는 설치는 두 가지다 —
 *   (a) 이 기능 이전부터 쓰던 기존 사용자 → 지금까지 한국어로 써왔으므로 무조건 'ko'.
 *       OS 로케일로 넘기면 영어 OS를 쓰는 한국 사용자가 업데이트만 했는데 UI가 뒤집힌다.
 *   (b) 완전 새 설치(settings 테이블이 빔) → 그때만 OS 로케일을 따른다.
 * 한 번 정해지면 값이 남으므로 이 판정은 다시 실행되지 않는다.
 */
export function resolveInitialLanguage(): Lang {
  const existing = getSetting('ui_language')
  if (isLang(existing)) return existing

  let lang: Lang = 'ko'
  try {
    const row = getDb().prepare('SELECT 1 AS x FROM settings LIMIT 1').get() as
      { x: number } | undefined
    const freshInstall = row === undefined
    if (freshInstall) lang = localeToLang(app.getLocale())
  } catch {
    // 판정 불가 = 안전한 쪽(한국어)으로
  }

  try {
    setSetting('ui_language', lang)
  } catch {
    // 저장 실패해도 이번 실행은 lang으로 동작
  }
  return lang
}

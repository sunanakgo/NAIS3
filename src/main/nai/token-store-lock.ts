import { getNaiTokenStoreLock, NaiTokenStoreLockedError } from '../db/settings'
import { t } from '../i18n'
import type { NaiTokenStoreLockReason } from '../../shared/types'

export function naiTokenStoreLockMessage(reason: NaiTokenStoreLockReason): string {
  return reason === 'corrupt' ? t('ui.naiTokenStoreCorrupt') : t('ui.naiTokenStoreLocked')
}

/** 토큰 저장 IPC가 저장소를 쓸 수 없을 때 돌려주는 거절 결과 (이유에 맞는 안내 문구) */
export function tokenStoreLockedResult(reason: NaiTokenStoreLockReason): {
  valid: false
  error: string
} {
  return { valid: false, error: naiTokenStoreLockMessage(reason) }
}

/**
 * 저장된 토큰을 읽을 수 없으면 덮어쓰지 않고 거절한다.
 * 토큰 검증(네트워크)을 하기 전에 미리 걸러 헛된 요청을 줄이는 용도다.
 */
export function lockedTokenStoreResult(): { valid: false; error: string } | null {
  const reason = getNaiTokenStoreLock()
  return reason ? tokenStoreLockedResult(reason) : null
}

/**
 * 저장소 변경을 실행하고, 그 사이 저장소가 잠겨 NaiTokenStoreLockedError가 나면
 * 번역되지 않은 오류를 렌더러로 흘리지 않고 onLocked의 결과로 바꾼다.
 * (미리 검사한 뒤 verifyToken을 기다리는 동안 키체인이 잠길 수 있다)
 * 다른 오류는 그대로 던진다.
 */
export function catchTokenStoreLock<T, F>(
  mutate: () => T,
  onLocked: (reason: NaiTokenStoreLockReason) => F
): T | F {
  try {
    return mutate()
  } catch (err) {
    if (err instanceof NaiTokenStoreLockedError) return onLocked(err.reason)
    throw err
  }
}

import type { MessageId } from './i18n'
import type { FreeBgRemovalAttempt } from './types'

type Translate = (id: MessageId, ...args: (string | number)[]) => string

/** 모든 Space가 실패했을 때의 안내 — 데스크톱(메인)과 브라우저 개발 모드가 같은 문구를 쓴다 */
export function freeBgRemovalFailureMessage(
  attempts: readonly FreeBgRemovalAttempt[],
  t: Translate
): string {
  const detail = attempts
    .map(
      (a) =>
        `${a.spaceId}: ${a.reason === 'timeout' ? t('ui.freeBgRemovalTimeout') : a.message.slice(0, 120)}`
    )
    .join('; ')
  return t('ui.freeBgRemovalFailed', detail)
}

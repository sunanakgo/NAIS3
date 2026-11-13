import type { NaiTokenStoreLockReason } from '@shared/types'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { askConfirm } from '../stores/dialog-store'
import { useGenerationStore } from '../stores/generation-store'
import { Button } from './ui/button'

/**
 * 저장된 NAI 토큰을 읽을 수 없을 때 (키체인 잠김 / 값 손상) 이유를 알리고,
 * 키체인을 되살릴 수 없을 때를 위한 "잠긴 토큰 삭제" 탈출구를 준다.
 * 설정 대화상자와 온보딩 계정 단계가 함께 쓴다.
 */
export function NaiTokenStoreLockNotice({
  reason,
  plaintextStorage,
  onCleared,
  className
}: {
  reason: NaiTokenStoreLockReason
  /** 키체인을 쓸 수 없는 실행 — 지운 뒤 다시 넣는 토큰은 평문으로 저장된다 */
  plaintextStorage: boolean
  /** 삭제를 마친 뒤 — 호출한 쪽이 계정 목록을 다시 읽는다 */
  onCleared: () => void
  className?: string
}): React.JSX.Element {
  const t = useT()

  async function clearLockedTokens(): Promise<void> {
    const ok = await askConfirm(t('ui.clearLockedNaiTokens'), {
      message: plaintextStorage
        ? `${t('ui.clearLockedNaiTokensConfirm')}\n\n${t('ui.naiTokenPlaintextStorageWarning')}`
        : t('ui.clearLockedNaiTokensConfirm'),
      confirmLabel: t('ui.delete'),
      danger: true
    })
    if (!ok) return
    await window.nais.invoke('nai:deleteToken', undefined)
    useGenerationStore.setState({ anlasBalance: null, opusUsage: null, subscriptionTier: null })
    onCleared()
  }

  return (
    <div
      role="alert"
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-lg border border-danger/50 bg-danger/10 p-2.5 text-[11.5px] text-danger-ink',
        className
      )}
    >
      <p className="min-w-0 flex-1">
        {reason === 'corrupt' ? t('ui.naiTokenStoreCorrupt') : t('ui.naiTokenStoreLocked')}
      </p>
      <Button size="sm" variant="ghost" onClick={() => void clearLockedTokens()}>
        {t('ui.clearLockedNaiTokens')}
      </Button>
    </div>
  )
}

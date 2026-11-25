import { ArchiveRestore } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RecoverableBackup } from '@shared/types'
import {
  backupKindLabel,
  describeCounts,
  formatBackupDate,
  restoreRecoverableBackup
} from '../lib/backup-recovery'
import { useT } from '../lib/i18n'
import { useLayoutStore } from '../stores/layout-store'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

/**
 * 작업 공간이 비었는데 앱 내부 백업에 데이터가 남아 있으면 시작할 때 한 번 알린다.
 * 닫으면 그 백업으로는 다시 띄우지 않고(메인이 기억), 설정의 백업 목록에서 언제든 복원할 수 있다.
 * 새 설치 온보딩 중에는 띄우지 않는다 — 온보딩의 불러오기 단계가 같은 백업을 보여 준다
 */
export function RecoveryNotice({ ready }: { ready: boolean }): React.JSX.Element {
  const t = useT()
  const [backup, setBackup] = useState<RecoverableBackup | null>(null)
  const [restarting, setRestarting] = useState(false)
  const checked = useRef(false)

  useEffect(() => {
    if (!ready || checked.current) return
    checked.current = true
    if (useLayoutStore.getState().onboardingOpen) return
    let alive = true
    void window.nais
      .invoke('backup:recoveryNotice', undefined)
      .then((result) => alive && setBackup(result.backup))
      .catch(() => {
        // 부가 안내 — 확인하지 못해도 평소처럼 시작한다
      })
    return () => {
      alive = false
    }
  }, [ready])

  const dismiss = (): void => {
    if (!backup || restarting) return
    void window.nais.invoke('backup:dismissRecoveryNotice', { id: backup.id }).catch(() => {})
    setBackup(null)
  }

  return (
    <Dialog open={!!backup} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="max-w-[440px] p-5">
        {backup && (
          <>
            <div className="mb-2.5 flex items-center gap-2.5 pr-8">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
                <ArchiveRestore size={17} />
              </span>
              <DialogTitle>{t('ui.recoveryNoticeTitle')}</DialogTitle>
            </div>
            <DialogDescription className="text-[13px] leading-relaxed">
              {t(
                'ui.recoveryNoticeBody',
                formatBackupDate(backup.createdAt),
                backupKindLabel(t, backup.kind, backup.schemaVersion)
              )}
            </DialogDescription>
            <p className="mt-3 rounded-lg bg-surface-2/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink">
              {describeCounts(t, backup.counts)}
            </p>
            <p className="mt-3 text-[11.5px] text-faint">
              {t('ui.recoveryNoticeHint', t('ui.storage'))}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" disabled={restarting} onClick={dismiss}>
                {t('ui.recoveryNoticeLater')}
              </Button>
              <Button
                variant="accent"
                autoFocus
                disabled={restarting}
                onClick={async () => {
                  if (await restoreRecoverableBackup(backup)) setRestarting(true)
                }}
              >
                {restarting ? t('ui.recoveryRestartingShort') : t('ui.restoreThisBackup')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

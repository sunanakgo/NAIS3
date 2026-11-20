import { ArchiveRestore } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { IpcInvokeMap } from '@shared/types'
import { totalWorkspaceCount } from '@shared/workspace-counts'
import {
  backupKindLabel,
  describeCounts,
  formatBackupDate,
  restoreRecoverableBackup
} from '../lib/backup-recovery'
import { useT } from '../lib/i18n'
import { Button } from './ui/button'

type ListResult = IpcInvokeMap['backup:listRecoverable']['res']

/**
 * 설정 › 저장: 앱이 데이터 폴더에 남긴 DB 백업 중 데이터가 있는 것 (최신순).
 * 지금보다 데이터가 많은 백업은 조용히 표시만 한다 — 일부를 지운 것은 사용자가 의도했을 수 있다
 */
export function RecoverableBackups(): React.JSX.Element {
  const t = useT()
  const [list, setList] = useState<ListResult | null>(null)
  // 확인 창부터 앱이 다시 시작될 때까지 다른 복원을 막는다
  const [busy, setBusy] = useState(false)
  const [restartingId, setRestartingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.nais
      .invoke('backup:listRecoverable', undefined)
      .then((result) => alive && setList(result))
      .catch((error: unknown) => {
        if (alive) setList({ error: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="mt-1 border-t border-line pt-3">
      <p className="text-[13px] text-ink">{t('ui.recoverableBackups')}</p>
      <p className="mt-0.5 text-[11.5px] text-faint">{t('ui.recoverableBackupsHint')}</p>
      {list === null ? (
        <p className="mt-2 text-[12px] text-muted">{t('ui.loading')}</p>
      ) : 'error' in list ? (
        <p className="mt-2 text-[12px] text-danger-ink">
          {t('ui.recoverableBackupsLoadFailed', list.error)}
        </p>
      ) : (
        <>
          <p className="mt-2 text-[12px] text-muted">
            {totalWorkspaceCount(list.current) > 0
              ? t('ui.recoverableBackupsCurrent', describeCounts(t, list.current))
              : t('ui.recoverableBackupsCurrentEmpty')}
          </p>
          {list.items.length === 0 ? (
            <p className="mt-2 text-[12px] text-faint">{t('ui.recoverableBackupsEmpty')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
              {list.items.map((backup) => {
                const date = formatBackupDate(backup.createdAt)
                const counts = describeCounts(t, backup.counts)
                return (
                  <li key={backup.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink">
                        <span>{date}</span>
                        <span className="text-muted">
                          {backupKindLabel(t, backup.kind, backup.schemaVersion)}
                        </span>
                        {backup.hasMoreThanCurrent && (
                          <span className="rounded bg-accent-soft px-1.5 py-px text-[10.5px] text-accent-ink">
                            {t('ui.recoveryHasMore')}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-faint" title={counts}>
                        {counts}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 gap-1.5"
                      aria-label={t('ui.restoreBackupFrom', date)}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        if (await restoreRecoverableBackup(backup)) setRestartingId(backup.id)
                        else setBusy(false)
                      }}
                    >
                      <ArchiveRestore size={13} />
                      {restartingId === backup.id
                        ? t('ui.recoveryRestartingShort')
                        : t('ui.restore')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

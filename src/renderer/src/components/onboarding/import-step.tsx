import { ArchiveRestore, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RecoverableBackup } from '@shared/types'
import { importBackup } from '../../lib/backup-import'
import {
  backupKindLabel,
  describeCounts,
  formatBackupDate,
  restoreRecoverableBackup
} from '../../lib/backup-recovery'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { ResultBox, type StepProps } from './parts'
import { FOOT_NOTE, PANEL } from './styles'

export function ImportStep({ done, onDone, busy, onBusyChange }: StepProps): React.JSX.Element {
  const t = useT()
  // 방금 불러왔으면 사라진 버튼 대신 결과 상자로 포커스를 옮긴다 (단계를 다시 열 때는 제목으로)
  const [justImported, setJustImported] = useState(false)
  // 지운 nais3.db 옆에 앱이 남긴 백업이 있으면 (데이터 폴더를 지우지 않고 다시 설치한 경우 등) 먼저 권한다
  const [found, setFound] = useState<RecoverableBackup | null>(null)

  useEffect(() => {
    let alive = true
    void window.nais
      .invoke('backup:listRecoverable', undefined)
      .then((result) => {
        if (alive && 'items' in result) setFound(result.items[0] ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="w-full max-w-[560px]">
      {done ? (
        <ResultBox focusOnMount={justImported} title={t('ui.onboardingImportDone')} />
      ) : (
        <>
          {found && (
            <div className={cn(PANEL, 'mb-4 p-4')}>
              <div className="flex items-start gap-3">
                <ArchiveRestore size={20} className="mt-0.5 shrink-0 text-accent-ink" />
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink">
                    {t('ui.onboardingRecoveryFound')}
                  </p>
                  <p className="mt-1 text-[13px] text-muted">
                    {backupKindLabel(t, found.kind, found.schemaVersion)} ·{' '}
                    {formatBackupDate(found.createdAt)}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted">{describeCounts(t, found.counts)}</p>
                </div>
              </div>
              <Button
                variant="accent"
                size="lg"
                className="mt-3.5 w-full gap-2 rounded-xl"
                disabled={busy}
                onClick={async () => {
                  onBusyChange(true)
                  // 성공하면 앱이 다시 시작된다 — 그때까지 온보딩 이동을 잠가 둔다
                  if (!(await restoreRecoverableBackup(found))) onBusyChange(false)
                }}
              >
                <ArchiveRestore size={16} /> {t('ui.restoreThisBackup')}
              </Button>
            </div>
          )}
          <Button
            size="lg"
            className="h-14 w-full gap-2.5 rounded-xl text-[15px]"
            disabled={busy}
            onClick={async () => {
              onBusyChange(true)
              try {
                if (await importBackup()) {
                  setJustImported(true)
                  onDone()
                }
              } finally {
                onBusyChange(false)
              }
            }}
          >
            <Download size={18} /> {t('ui.importData')}
          </Button>
        </>
      )}
      <p className={FOOT_NOTE}>{t('ui.onboardingImportOptional')}</p>
    </div>
  )
}

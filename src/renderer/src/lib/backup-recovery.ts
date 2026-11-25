import type { MessageId } from '@shared/i18n'
import type { RecoverableBackup, RecoverableBackupKind, WorkspaceCounts } from '@shared/types'
import { WORKSPACE_COUNT_KEYS } from '@shared/workspace-counts'
import { askConfirm } from '../stores/dialog-store'
import { toast } from '../stores/toast-store'
import { t, useLanguageStore } from './i18n'

type Translate = typeof t

const COUNT_LABELS: Record<keyof WorkspaceCounts, MessageId> = {
  characters: 'ui.recoveryCountCharacters',
  fragments: 'ui.recoveryCountFragments',
  promptPresets: 'ui.recoveryCountPromptPresets',
  scenes: 'ui.recoveryCountScenes',
  vibes: 'ui.recoveryCountVibes',
  characterReferences: 'ui.recoveryCountCharacterReferences',
  library: 'ui.recoveryCountLibrary',
  history: 'ui.recoveryCountHistory'
}

/** "캐릭터 12 · 조각 30 · …" — 0인 항목은 뺀다 */
export function describeCounts(tr: Translate, counts: WorkspaceCounts): string {
  return WORKSPACE_COUNT_KEYS.filter((key) => counts[key] > 0)
    .map((key) => tr(COUNT_LABELS[key], counts[key].toLocaleString()))
    .join(' · ')
}

export function backupKindLabel(
  tr: Translate,
  kind: RecoverableBackupKind,
  schemaVersion: number
): string {
  switch (kind) {
    case 'upgrade-original':
      return tr('ui.recoveryKindUpgradeOriginal', schemaVersion)
    case 'upgrade':
      return tr('ui.recoveryKindUpgrade', schemaVersion)
    case 'import':
      return tr('ui.recoveryKindImport')
    case 'restore':
      return tr('ui.recoveryKindRestore')
    case 'auto':
      return tr('ui.recoveryKindAuto')
  }
}

export function formatBackupDate(createdAt: number): string {
  const lang = useLanguageStore.getState().lang
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(
    createdAt
  )
}

/**
 * 확인을 받고 백업으로 되돌린다. 성공하면 메인이 곧 앱을 다시 시작하므로 true만 돌려준다.
 * 지금 데이터는 메인이 backups/pre-restore/에 먼저 남긴다
 */
export async function restoreRecoverableBackup(backup: RecoverableBackup): Promise<boolean> {
  const ok = await askConfirm(t('ui.recoveryRestoreTitle'), {
    message: t(
      'ui.recoveryRestoreMessage',
      formatBackupDate(backup.createdAt),
      backupKindLabel(t, backup.kind, backup.schemaVersion)
    ),
    confirmLabel: t('ui.restoreThisBackup'),
    danger: true
  })
  if (!ok) return false
  const result = await window.nais.invoke('backup:restore', { id: backup.id })
  if ('error' in result) {
    toast(t('ui.recoveryRestoreFailed', result.error), 'error')
    return false
  }
  toast(t('ui.recoveryRestarting'), 'success')
  return true
}

import {
  BatteryCharging,
  Coins,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Info,
  Keyboard,
  KeyRound,
  Image as ImageIcon,
  Palette,
  RotateCcw,
  Trash2,
  Upload
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { displayOpusUsagePercent, opusUsagePercentSegments } from '@shared/anlas'
import type { MessageId } from '@shared/i18n'
import type { NaiAccountInfo } from '@shared/types'
import discordSvg from '../assets/discord.svg'
import nais3Logo from '../assets/nais3-logo.svg'
import { playChime } from '../lib/completion-alert'
import { useLanguageStore, useT } from '../lib/i18n'
import type { Lang } from '@shared/i18n'
import { cn } from '../lib/utils'
import { THEME_PRESETS } from '../lib/theme-presets'
import { useGenerationStore } from '../stores/generation-store'
import { useLayoutStore, type CenterMode } from '../stores/layout-store'
import { useThemeStore } from '../stores/theme-store'
import { useCharactersStore } from '../stores/characters-store'
import { useFragmentsStore } from '../stores/fragments-store'
import { useVibesStore, useCharRefsStore } from '../stores/refs-store'
import { usePromptPresetsStore } from '../stores/prompt-presets-store'
import { useScenesStore } from '../stores/scenes-store'
import { useUpdateStore } from '../stores/update-store'
import { askConfirm } from '../stores/dialog-store'
import { toast } from '../stores/toast-store'
import {
  SHORTCUT_LABELS,
  comboFromEvent,
  formatCombo,
  useShortcutsStore,
  type ShortcutAction
} from '../stores/shortcuts-store'
import { ThemeToggle } from './theme-toggle'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

type SectionId = 'appearance' | 'generation' | 'storage' | 'shortcuts' | 'account' | 'about'

const NAV: { id: SectionId; label: MessageId; icon: typeof Info }[] = [
  { id: 'appearance', label: 'ui.appearance', icon: Palette },
  { id: 'generation', label: 'ui.generate', icon: ImageIcon },
  { id: 'storage', label: 'ui.storage', icon: FolderOpen },
  { id: 'shortcuts', label: 'ui.shortcuts', icon: Keyboard },
  { id: 'account', label: 'ui.naiAccount', icon: KeyRound },
  { id: 'about', label: 'ui.about', icon: Info }
]

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] text-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function AppearanceSection(): React.JSX.Element {
  const t = useT()
  const lang = useLanguageStore((s) => s.lang)
  const setLang = useLanguageStore((s) => s.setLang)
  const presetId = useThemeStore((s) => s.presetId)
  const setPreset = useThemeStore((s) => s.setPreset)
  const uiFont = useThemeStore((s) => s.uiFont)
  const setUiFont = useThemeStore((s) => s.setUiFont)
  const uiSize = useThemeStore((s) => s.uiSize)
  const setUiSize = useThemeStore((s) => s.setUiSize)
  const promptSize = useThemeStore((s) => s.promptSize)
  const setPromptSize = useThemeStore((s) => s.setPromptSize)

  return (
    <div className="divide-y divide-line">
      <Row label={t('ui.language')}>
        <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ko">한국어</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label={t('ui.colorMode')}>
        <ThemeToggle />
      </Row>
      <Row label={t('ui.themePreset')}>
        <Select value={presetId} onValueChange={setPreset}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label={t('ui.uiFont')} hint={t('ui.leaveEmptyForDefaultFont')}>
        <Input
          className="w-44"
          value={uiFont}
          placeholder="Pretendard"
          onChange={(e) => setUiFont(e.target.value)}
        />
      </Row>
      <Row label={t('ui.uiSizeValuePx', uiSize)}>
        <Slider
          className="w-44"
          min={11}
          max={18}
          step={0.5}
          value={[uiSize]}
          onValueChange={([v]) => setUiSize(v)}
        />
      </Row>
      <Row
        label={t('ui.promptFontSizeValuePx', promptSize)}
        hint={t('ui.baseCharacterPromptInputBoxes')}
      >
        <Slider
          className="w-44"
          min={12}
          max={22}
          step={0.5}
          value={[promptSize]}
          onValueChange={([v]) => setPromptSize(v)}
        />
      </Row>
      <Row label={t('ui.visibleTabs')} hint={t('ui.tabsTurnedOffAreHiddenFromTheTopBar')}>
        <PageToggles />
      </Row>
    </div>
  )
}

const TOGGLABLE_PAGES: { id: CenterMode; label: MessageId }[] = [
  { id: 'scene', label: 'ui.scene' },
  { id: 'director', label: 'ui.director' },
  { id: 'library', label: 'ui.library' },
  { id: 'websearch', label: 'ui.web' }
]

function PageToggles(): React.JSX.Element {
  const t = useT()
  const hiddenPages = useLayoutStore((s) => s.hiddenPages)
  const setPageHidden = useLayoutStore((s) => s.setPageHidden)
  return (
    <div className="flex gap-1">
      {TOGGLABLE_PAGES.map((p) => {
        const on = !hiddenPages.includes(p.id)
        return (
          <button
            key={p.id}
            onClick={() => setPageHidden(p.id, on)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
              on
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-line text-faint hover:text-ink'
            )}
          >
            {t(p.label)}
          </button>
        )
      })}
    </div>
  )
}

function GenerationSection(): React.JSX.Element {
  const t = useT()
  const [streaming, setStreaming] = useState(true)
  const [delay, setDelay] = useState(600)
  const [alertSound, setAlertSound] = useState(false)
  const [alertNative, setAlertNative] = useState(false)
  const promptSplitEnabled = useGenerationStore((s) => s.promptSplitEnabled)
  const setPromptSplitEnabled = useGenerationStore((s) => s.setPromptSplitEnabled)

  useEffect(() => {
    void window.nais.invoke('settings:get', { key: 'gen_streaming' }).then(({ value }) => {
      setStreaming(value !== '0')
    })
    void window.nais.invoke('settings:get', { key: 'gen_delay_ms' }).then(({ value }) => {
      if (value != null && value !== '') setDelay(Number(value))
    })
    void window.nais.invoke('settings:get', { key: 'alert_sound' }).then(({ value }) => {
      setAlertSound(value === '1')
    })
    void window.nais.invoke('settings:get', { key: 'alert_native' }).then(({ value }) => {
      setAlertNative(value === '1')
    })
  }, [])

  return (
    <div className="divide-y divide-line">
      <Row label={t('ui.streamingGeneration')} hint={t('ui.livePreviewWhileGenerating')}>
        <Switch
          checked={streaming}
          onCheckedChange={(v) => {
            setStreaming(v)
            void window.nais.invoke('settings:set', { key: 'gen_streaming', value: v ? '1' : '0' })
          }}
        />
      </Row>
      <Row label={t('ui.value3PartPromptSplit')} hint={t('ui.splitIntoFixedVariableDetailBoxes')}>
        <Switch checked={promptSplitEnabled} onCheckedChange={setPromptSplitEnabled} />
      </Row>
      <Row
        label={t('ui.generationDelayValueS', (delay / 1000).toFixed(1))}
        hint={t('ui.intervalBetweenConsecutiveGenerations')}
      >
        <Slider
          className="w-44"
          min={0}
          max={5000}
          step={100}
          value={[delay]}
          onValueChange={([v]) => setDelay(v)}
          onValueCommit={([v]) => void window.nais.invoke('gen:setDelay', { ms: v })}
        />
      </Row>
      <Row label={t('ui.completionSound')} hint={t('ui.playAChimeWhenTheQueueFinishes')}>
        <Switch
          checked={alertSound}
          onCheckedChange={(v) => {
            setAlertSound(v)
            void window.nais.invoke('settings:set', { key: 'alert_sound', value: v ? '1' : '0' })
            if (v) playChime() // 미리 듣기
          }}
        />
      </Row>
      <Row
        label={t('ui.completionNotificationSystem')}
        hint={t('ui.showAMacosWindowsNotificationWhenAnotherWindowIsFocused')}
      >
        <Switch
          checked={alertNative}
          onCheckedChange={(v) => {
            setAlertNative(v)
            void window.nais.invoke('settings:set', { key: 'alert_native', value: v ? '1' : '0' })
          }}
        />
      </Row>
    </div>
  )
}

/** 저장 폴더 한 줄 (메인/씬 공용) — 경로 표시 + 변경 + 기본값 복귀 */
function SaveDirRow({
  target,
  label,
  hint
}: {
  target: 'main' | 'scene'
  label: string
  hint: string
}): React.JSX.Element {
  const t = useT()
  const [dir, setDir] = useState('')
  const [isDefault, setIsDefault] = useState(true)
  const refresh = (): void => {
    void window.nais.invoke('settings:getSaveDir', { target }).then((r) => {
      setDir(r.dir)
      setIsDefault(r.isDefault)
    })
  }
  useEffect(refresh, [target])
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <p className="text-[13px] text-ink">{label}</p>
        <p className="text-[11.5px] text-faint">{hint}</p>
      </div>
      <div className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden">
        <div
          className="w-0 min-w-0 flex-1 truncate rounded-md border border-line bg-surface-2/60 px-3 py-2 font-mono text-[12px] text-muted"
          title={dir}
        >
          {dir}
        </div>
        <Button
          variant="default"
          className="gap-1"
          onClick={async () => {
            const r = await window.nais.invoke('settings:pickSaveDir', { target })
            if (r.dir) refresh()
          }}
        >
          <FolderOpen size={14} /> {t('ui.change')}
        </Button>
        {!isDefault && (
          <Button
            variant="ghost"
            title={t('ui.resetToDefaultFolder')}
            onClick={async () => {
              await window.nais.invoke('settings:resetSaveDir', { target })
              refresh()
            }}
          >
            <RotateCcw size={14} />
          </Button>
        )}
      </div>
    </div>
  )
}

function StorageSection(): React.JSX.Element {
  const t = useT()
  const [autoSave, setAutoSave] = useState(true)
  const [format, setFormat] = useState('png')
  const [dateFolders, setDateFolders] = useState(true)
  const [historyDeleteFile, setHistoryDeleteFile] = useState(false)

  useEffect(() => {
    void window.nais
      .invoke('settings:get', { key: 'auto_save' })
      .then(({ value }) => setAutoSave(value !== '0'))
    void window.nais
      .invoke('settings:get', { key: 'image_format' })
      .then(({ value }) => setFormat(value || 'png'))
    void window.nais
      .invoke('settings:get', { key: 'date_folders' })
      .then(({ value }) => setDateFolders(value !== '0'))
    void window.nais
      .invoke('settings:get', { key: 'history_delete_file' })
      .then(({ value }) => setHistoryDeleteFile(value === '1'))
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="-mb-1 divide-y divide-line">
        <Row
          label={t('ui.autoSave')}
          hint={t('ui.whenOffMainGenerationsAreNotSavedToFilesHistoryKeepsOnlyTheLast28457b8e')}
        >
          <Switch
            checked={autoSave}
            onCheckedChange={(v) => {
              setAutoSave(v)
              void window.nais.invoke('settings:set', { key: 'auto_save', value: v ? '1' : '0' })
            }}
          />
        </Row>
        <Row
          label={t('ui.dateFolders')}
          hint={t('ui.organizeTheMainSaveFolderIntoYyyyMmSubfolders')}
        >
          <Switch
            checked={dateFolders}
            onCheckedChange={(v) => {
              setDateFolders(v)
              void window.nais.invoke('settings:set', { key: 'date_folders', value: v ? '1' : '0' })
            }}
          />
        </Row>
        <Row
          label={t('ui.alsoDeleteFilesWhenDeletingHistory')}
          hint={t('ui.whenOffOnlyTheHistoryEntryIsRemovedAndSavedFilesAreKept')}
        >
          <Switch
            checked={historyDeleteFile}
            onCheckedChange={(v) => {
              setHistoryDeleteFile(v)
              void window.nais.invoke('settings:set', {
                key: 'history_delete_file',
                value: v ? '1' : '0'
              })
            }}
          />
        </Row>
        <Row label={t('ui.imageFormat')} hint={t('ui.webpFilesAreSmaller')}>
          <Select
            value={format}
            onValueChange={(v) => {
              setFormat(v)
              void window.nais.invoke('settings:set', { key: 'image_format', value: v })
            }}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="png">PNG</SelectItem>
              <SelectItem value="webp">WEBP</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </div>
      <SaveDirRow
        target="main"
        label={t('ui.mainSaveFolder')}
        hint={t('ui.regularGenerationsAreSavedDirectlyIntoThisFolder')}
      />
      <SaveDirRow
        target="scene"
        label={t('ui.sceneSaveFolder')}
        hint={t('ui.organizedUnderThisFolderByPresetSceneName')}
      />

      <div className="mt-1 border-t border-line pt-3">
        <p className="text-[13px] text-ink">{t('ui.dataBackup')}</p>
        <p className="mt-0.5 text-[11.5px] text-faint">
          {t('ui.fullLibraryJsonNais2BackupCompatible')}
        </p>
        <BackupButtons />
      </div>
    </div>
  )
}

function BackupButtons(): React.JSX.Element {
  const t = useT()
  return (
    <div className="mt-2 flex items-center gap-2">
      <Button
        variant="default"
        className="gap-1.5"
        onClick={async () => {
          const r = await window.nais.invoke('backup:export', undefined)
          if (r.saved) toast(t('ui.exportComplete'), 'success')
        }}
      >
        <Upload size={14} /> {t('ui.export')}
      </Button>
      <Button
        variant="default"
        className="gap-1.5"
        onClick={async () => {
          const ok = await askConfirm(t('ui.importData'), {
            message: t('ui.importingDataMayOverwriteExistingDataContinue'),
            confirmLabel: t('ui.import'),
            danger: true
          })
          if (!ok) return
          const r = await window.nais.invoke('backup:import', undefined)
          if ('canceled' in r) return
          if ('error' in r) {
            toast(t('ui.importErrorValue', r.error), 'error')
            return
          }
          toast(r.summary, 'success')
          // 관련 스토어 새로고침
          void useCharactersStore.getState().load()
          void useFragmentsStore.getState().load()
          void useVibesStore.getState().load()
          void useCharRefsStore.getState().load()
          void usePromptPresetsStore.getState().load()
          void useScenesStore.getState().loadPresets()
          // 메인 프롬프트가 바뀌었으면 재하이드레이트
          if (r.needsPromptReload) void useGenerationStore.getState().hydrate()
        }}
      >
        <Download size={14} /> {t('ui.import')}
      </Button>
    </div>
  )
}

function ShortcutsSection(): React.JSX.Element {
  const t = useT()
  const bindings = useShortcutsStore((s) => s.bindings)
  const recording = useShortcutsStore((s) => s.recording)
  const setRecording = useShortcutsStore((s) => s.setRecording)
  const setBinding = useShortcutsStore((s) => s.setBinding)
  const resetDefaults = useShortcutsStore((s) => s.resetDefaults)

  // 녹화 중 키 입력을 캡처
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const combo = comboFromEvent(e)
      if (combo) setBinding(recording, combo)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, setBinding, setRecording])

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11.5px] text-faint">{t('ui.clickAnItemThenPressANewKeyCombination')}</p>
        <Button size="sm" variant="ghost" className="gap-1" onClick={resetDefaults}>
          <RotateCcw size={12} /> {t('ui.defaults')}
        </Button>
      </div>
      <div className="divide-y divide-line">
        {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((action) => (
          <div key={action} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-[13px] text-ink">{t(SHORTCUT_LABELS[action])}</span>
            <button
              onClick={() => setRecording(recording === action ? null : action)}
              className={cn(
                'min-w-24 rounded-md border px-3 py-1 text-center font-mono text-[12px] transition-colors',
                recording === action
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line bg-surface-2/60 text-muted hover:text-ink'
              )}
            >
              {recording === action ? t('ui.pressKeys') : formatCombo(bindings[action])}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function AccountSection(): React.JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [label, setLabel] = useState('')
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')
  const [message, setMessage] = useState('')
  const [accounts, setAccounts] = useState<NaiAccountInfo[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [usage, setUsage] = useState<{ today: number; week: number } | null>(null)
  const anlasBalance = useGenerationStore((s) => s.anlasBalance)
  const opusUsage = useGenerationStore((s) => s.opusUsage)
  const subscriptionTier = useGenerationStore((s) => s.subscriptionTier)
  const refreshAnlas = useGenerationStore((s) => s.refreshAnlas)

  const refresh = useCallback(
    (includeBalance = true): void => {
      void window.nais.invoke('nai:listAccounts', undefined).then(({ accounts: next }) => {
        setAccounts(next)
      })
      void window.nais.invoke('nai:anlasUsage', undefined).then(setUsage)
      if (includeBalance) void refreshAnlas().catch(() => undefined)
    },
    [refreshAnlas]
  )
  useEffect(() => {
    refresh()
    return window.nais.on('nai:accountChanged', () => refresh(false))
  }, [refresh])

  async function toggleReveal(id: string): Promise<void> {
    if (revealed[id]) {
      setRevealed((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      return
    }
    const { token } = await window.nais.invoke('nai:revealAccountToken', { id })
    if (token) setRevealed((current) => ({ ...current, [id]: token }))
  }

  async function addAccount(): Promise<void> {
    if (!draft.trim()) return
    setStatus('checking')
    const result = await window.nais.invoke('nai:addAccount', {
      token: draft.trim(),
      ...(label.trim() ? { label: label.trim() } : {})
    })
    if (result.valid) {
      setStatus('ok')
      if (result.subscription) {
        useGenerationStore.getState().setSubscriptionTier(result.subscription.tier)
      }
      setMessage(t('ui.accountAddedValue', result.subscription?.tier ?? '?'))
      setDraft('')
      setLabel('')
      refresh()
    } else {
      setStatus('fail')
      setMessage(result.error ?? t('ui.tokenValidationFailed'))
    }
  }

  async function activateAccount(id: string): Promise<void> {
    setBusyId(id)
    try {
      const result = await window.nais.invoke('nai:setActiveAccount', { id })
      if (result.active) {
        useGenerationStore.setState({
          anlasBalance: result.anlas,
          opusUsage: result.usage ?? null,
          subscriptionTier: result.tier
        })
      }
      refresh(false)
    } finally {
      setBusyId(null)
    }
  }

  async function removeAccount(account: NaiAccountInfo): Promise<void> {
    const ok = await askConfirm(t('ui.deleteAccountValue', account.label), {
      message: t('ui.onlyTheSavedApiTokenIsDeletedYourNovelaiAccountItselfIsUnaffected'),
      confirmLabel: t('ui.delete'),
      danger: true
    })
    if (!ok) return
    setBusyId(account.id)
    try {
      const { activeId } = await window.nais.invoke('nai:deleteAccount', { id: account.id })
      setRevealed((current) => {
        const next = { ...current }
        delete next[account.id]
        return next
      })
      if (!activeId) {
        useGenerationStore.setState({
          anlasBalance: null,
          opusUsage: null,
          subscriptionTier: null
        })
      } else {
        void refreshAnlas().catch(() => undefined)
      }
      refresh(false)
    } finally {
      setBusyId(null)
    }
  }

  const activeAccount = accounts.find((account) => account.active)
  const opusUsageSegments = opusUsage ? opusUsagePercentSegments(opusUsage) : [0]

  return (
    <div className="flex min-h-full min-w-0 flex-col gap-3 overflow-x-hidden">
      <div className="min-w-0">
        <p className="text-[13px] text-ink">{t('ui.naiAccount')}</p>
        <p className="mt-0.5 text-[11.5px] text-faint">
          {t('ui.tokensAreEncryptedWithTheOsKeychainWhenTheV5GaugeReaches0TheNextfc0344e')}
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)_auto] gap-1.5">
        <Input
          className="w-28 shrink-0"
          value={label}
          placeholder={t('ui.accountValue', accounts.length + 1)}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          className="min-w-0 font-mono"
          value={draft}
          placeholder="pst-..."
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value)
            setStatus('idle')
          }}
          onKeyDown={(e) => e.key === 'Enter' && void addAccount()}
        />
        <Button variant="accent" disabled={status === 'checking'} onClick={() => void addAccount()}>
          {status === 'checking' ? t('ui.checking') : t('ui.add')}
        </Button>
      </div>
      {status === 'ok' && <span className="text-[12px] text-accent">{message}</span>}
      {status === 'fail' && <span className="text-[12px] text-danger">{message}</span>}

      <div className="min-w-0 space-y-1.5">
        {accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-4 text-center text-[11.5px] text-faint">
            {t('ui.noAccountsRegistered')}
          </div>
        ) : (
          accounts.map((account) => {
            const percent = account.usage ? displayOpusUsagePercent(account.usage) : null
            const masked = `${account.prefix}${'*'.repeat(Math.max(4, account.length - 8))}${account.suffix}`
            return (
              <div
                key={account.id}
                className={cn(
                  'flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border bg-surface-2/40 p-2.5',
                  account.active ? 'border-accent/70' : 'border-line'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  disabled={busyId !== null || account.active}
                  onClick={() => void activateAccount(account.id)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">
                      {account.label}
                    </span>
                    {account.active && (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] text-accent">
                        {t('ui.active')}
                      </span>
                    )}
                    {account.tier && (
                      <span className="text-[10px] uppercase text-faint">{account.tier}</span>
                    )}
                  </div>
                  <p className="mt-1 truncate font-mono text-[10.5px] text-faint">
                    {revealed[account.id] ?? masked}
                  </p>
                  <p className="mt-1 text-[10.5px] text-muted">
                    {account.tier === 'opus'
                      ? percent === null
                        ? t('ui.v5GaugeUnavailable')
                        : account.usage?.isNegative
                          ? t('ui.v5ValueDepleted', percent)
                          : `V5 ${percent}%`
                      : account.tier
                        ? `Anlas ${account.anlas?.toLocaleString() ?? '—'}`
                        : t('ui.statusUnavailable')}
                  </p>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  title={revealed[account.id] ? t('ui.hideToken') : t('ui.showToken')}
                  onClick={() => void toggleReveal(account.id)}
                >
                  {revealed[account.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="hover:text-danger"
                  disabled={busyId !== null}
                  title={t('ui.deleteAccount')}
                  onClick={() => void removeAccount(account)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            )
          })
        )}
      </div>

      {activeAccount && subscriptionTier === 'opus' && (
        <div className="min-w-0 rounded-lg border border-line bg-surface-2/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
              <BatteryCharging
                size={13}
                className={opusUsage?.isNegative ? 'text-danger' : 'text-accent'}
              />
              {t('ui.v5Usage')}
            </p>
            <span className="font-mono text-[15px] text-ink">
              {opusUsage ? `${displayOpusUsagePercent(opusUsage)}%` : '—'}
            </span>
          </div>
          {/* 부스트로 100%를 넘으면 100 단위로 칸이 늘어난다(198% = 100+98).
              flex-1 대신 grid minmax(0,1fr) — 칸이 늘어도 폭을 벗어나지 않는다 (PR #6) */}
          <div
            className="grid h-2 w-full min-w-0 gap-1 overflow-hidden"
            style={{ gridTemplateColumns: `repeat(${opusUsageSegments.length}, minmax(0, 1fr))` }}
          >
            {opusUsageSegments.map((percent, index) => (
              <div key={index} className="h-full min-w-0 overflow-hidden rounded-full bg-paper">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-300',
                    opusUsage?.isNegative ? 'bg-danger' : 'bg-accent'
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-faint">
            {opusUsage
              ? opusUsage.isNegative
                ? accounts.length > 1
                  ? t('ui.depletedWillSwitchToAnAvailableAccountBeforeTheNextV5Generation')
                  : t('ui.depletedV5GenerationsWillUseAnlasUntilItRecharges')
                : t(
                    'ui.aboutValueHUntilTheNext1',
                    Math.max(0, opusUsage.timeUntilNextPercent / 3600).toFixed(1)
                  )
              : t('ui.checkingUsage')}
          </p>
        </div>
      )}

      {/* Anlas 사용량 — 잔액 스냅샷 간 감소분 합산 */}
      <div className="min-w-0 rounded-lg border border-line bg-surface-2/50 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
          <Coins size={13} className="text-[#c9a34f]" /> Anlas
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="font-mono text-[15px] text-ink">
              {anlasBalance !== null ? anlasBalance.toLocaleString() : '—'}
            </p>
            <p className="text-[10.5px] text-faint">{t('ui.currentBalance')}</p>
          </div>
          <div>
            <p className="font-mono text-[15px] text-ink">
              {usage ? usage.today.toLocaleString() : '—'}
            </p>
            <p className="text-[10.5px] text-faint">{t('ui.usedToday')}</p>
          </div>
          <div>
            <p className="font-mono text-[15px] text-ink">
              {usage ? usage.week.toLocaleString() : '—'}
            </p>
            <p className="text-[10.5px] text-faint">{t('ui.last7Days')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function AboutSection(): React.JSX.Element {
  const t = useT()
  const [version, setVersion] = useState('')
  const updateStatus = useUpdateStore((s) => s.status)
  const updateVersion = useUpdateStore((s) => s.version)
  const updatePercent = useUpdateStore((s) => s.percent)
  const startUpdate = useUpdateStore((s) => s.start)

  useEffect(() => {
    void window.nais.invoke('app:version', undefined).then((r) => setVersion(r.version))
  }, [])

  return (
    <div className="flex flex-col gap-1.5 text-[12.5px] text-muted">
      {/* 로고(흰색)라 라이트 모드에선 invert로 어둡게 */}
      <img src={nais3Logo} className="h-9 w-auto self-start dark:invert-0 invert" alt="NAIS3" />
      <p className="mt-1">NovelAI Image Studio 3</p>
      <p className="font-mono text-[11.5px] text-faint">{t('ui.versionValue', version || '…')}</p>

      {/* 업데이트 상태 */}
      <div className="mt-1">
        {updateStatus === 'available' ? (
          <Button variant="accent" className="gap-1.5" onClick={startUpdate}>
            <Download size={14} /> {t('ui.updateToVersionValue', updateVersion ?? '')}
          </Button>
        ) : updateStatus === 'downloading' ? (
          <span className="text-[12px] text-accent">
            {t('ui.downloadingUpdateValue', updatePercent)}
          </span>
        ) : updateStatus === 'downloaded' ? (
          <span className="text-[12px] text-accent">{t('ui.installingUpdateRestartingSoon')}</span>
        ) : (
          <span className="text-[12px] text-faint">{t('ui.youReOnTheLatestVersion')}</span>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => window.open('https://discord.gg/bFxP5Qvaz', '_blank')}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-2/60 px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <img src={discordSvg} className="size-4" alt="" /> Discord
        </button>
        <button
          onClick={() => window.open('https://www.patreon.com/c/sunakgo', '_blank')}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-2/60 px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <PatreonIcon /> Patreon
        </button>
      </div>
    </div>
  )
}

/** Patreon 로고 (currentColor) */
function PatreonIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14.82 2.41c3.96 0 7.18 3.24 7.18 7.21 0 3.96-3.22 7.18-7.18 7.18-3.97 0-7.21-3.22-7.21-7.18 0-3.97 3.24-7.21 7.21-7.21M2 21.6h3.5V2.41H2V21.6z" />
    </svg>
  )
}

export function SettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const [section, setSection] = useState<SectionId>('appearance')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="grid h-[62vh] max-w-[640px] grid-rows-[1fr] gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">{t('ui.settings')}</DialogTitle>
        <Tabs
          value={section}
          onValueChange={(v) => setSection(v as SectionId)}
          className="flex h-full w-full min-h-0 min-w-0 overflow-hidden"
          orientation="vertical"
        >
          <nav className="flex w-40 shrink-0 flex-col border-r border-line bg-surface-2/50 p-2">
            <TabsList className="flex flex-col items-stretch gap-0.5 bg-transparent p-0">
              {NAV.map(({ id, label, icon: Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className={cn(
                    'flex items-center justify-start gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:text-ink',
                    'data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-none'
                  )}
                >
                  <Icon size={14} />
                  {t(label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </nav>
          <div className="flex w-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* 헤더 — 섹션명. 우측 상단 X가 이 영역 위에 놓여 본문과 겹치지 않는다 */}
            <div className="flex shrink-0 items-center border-b border-line px-6 py-3.5">
              <h2 className="text-[14px] font-semibold text-ink">
                {t(NAV.find((n) => n.id === section)?.label ?? 'ui.settings')}
              </h2>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-5 no-scrollbar">
              {/* 패딩 박스 안에서 w-full을 중첩하면 flex 폭 계산상 우측 패딩만큼 넘칠 수 있다.
                  단일 minmax 트랙에 탭을 stretch해 실제 content box 폭을 상한으로 삼는다. */}
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
                <TabsContent value="appearance" className="m-0 min-w-0">
                  <AppearanceSection />
                </TabsContent>
                <TabsContent value="generation" className="m-0 min-w-0">
                  <GenerationSection />
                </TabsContent>
                <TabsContent value="storage" className="m-0 min-w-0">
                  <StorageSection />
                </TabsContent>
                <TabsContent value="shortcuts" className="m-0 min-w-0">
                  <ShortcutsSection />
                </TabsContent>
                <TabsContent value="account" className="m-0 min-h-full min-w-0">
                  <AccountSection />
                </TabsContent>
                <TabsContent value="about" className="m-0 min-w-0">
                  <AboutSection />
                </TabsContent>
              </div>
            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

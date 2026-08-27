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

const NAV: { id: SectionId; label: string; icon: typeof Info }[] = [
  { id: 'appearance', label: '모양', icon: Palette },
  { id: 'generation', label: '생성', icon: ImageIcon },
  { id: 'storage', label: '저장', icon: FolderOpen },
  { id: 'shortcuts', label: '단축키', icon: Keyboard },
  { id: 'account', label: 'NAI 계정', icon: KeyRound },
  { id: 'about', label: '정보', icon: Info }
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
      <Row label={t('언어')}>
        <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ko">한국어</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="zh-CN">简体中文</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label={t('색상 모드')}>
        <ThemeToggle />
      </Row>
      <Row label={t('테마 프리셋')}>
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
      <Row label={t('UI 폰트')} hint={t('비우면 기본 폰트')}>
        <Input
          className="w-44"
          value={uiFont}
          placeholder="Pretendard"
          onChange={(e) => setUiFont(e.target.value)}
        />
      </Row>
      <Row label={t('UI 크기 — {0}px', uiSize)}>
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
        label={t('프롬프트 폰트 크기 — {0}px', promptSize)}
        hint={t('기본/캐릭터 프롬프트 입력 박스')}
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
      <Row label={t('표시할 탭')} hint={t('끈 탭은 상단에서 숨김')}>
        <PageToggles />
      </Row>
    </div>
  )
}

const TOGGLABLE_PAGES: { id: CenterMode; label: string }[] = [
  { id: 'scene', label: '씬' },
  { id: 'director', label: '디렉터' },
  { id: 'library', label: '라이브러리' },
  { id: 'websearch', label: '웹' }
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
      <Row label={t('스트리밍 생성')} hint={t('생성 과정을 실시간 미리보기')}>
        <Switch
          checked={streaming}
          onCheckedChange={(v) => {
            setStreaming(v)
            void window.nais.invoke('settings:set', { key: 'gen_streaming', value: v ? '1' : '0' })
          }}
        />
      </Row>
      <Row label={t('프롬프트 3분할')} hint={t('고정 / 가변 / 디테일 칸으로 나누기')}>
        <Switch checked={promptSplitEnabled} onCheckedChange={setPromptSplitEnabled} />
      </Row>
      <Row label={t('생성 지연 — {0}초', (delay / 1000).toFixed(1))} hint={t('연속 생성 간격')}>
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
      <Row label={t('완료 알림음')} hint={t('큐가 다 끝나면 알림음 재생')}>
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
        label={t('완료 알림 (시스템)')}
        hint={t('다른 창을 보고 있을 때 macOS/Windows 알림 표시')}
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
          <FolderOpen size={14} /> {t('변경')}
        </Button>
        {!isDefault && (
          <Button
            variant="ghost"
            title={t('기본 폴더로')}
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
          label={t('자동 저장')}
          hint={t(
            '끄면 메인 생성을 파일로 저장하지 않음 (히스토리에 최근 20장만 임시 보관) · 씬 모드는 항상 저장'
          )}
        >
          <Switch
            checked={autoSave}
            onCheckedChange={(v) => {
              setAutoSave(v)
              void window.nais.invoke('settings:set', { key: 'auto_save', value: v ? '1' : '0' })
            }}
          />
        </Row>
        <Row label={t('날짜별 폴더')} hint={t('메인 저장 폴더 안을 YYYY-MM으로 정리')}>
          <Switch
            checked={dateFolders}
            onCheckedChange={(v) => {
              setDateFolders(v)
              void window.nais.invoke('settings:set', { key: 'date_folders', value: v ? '1' : '0' })
            }}
          />
        </Row>
        <Row
          label={t('히스토리 삭제 시 파일도 삭제')}
          hint={t('끄면 기록만 지우고 저장된 파일은 보존')}
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
        <Row label={t('이미지 포맷')} hint={t('WEBP는 용량이 더 작음')}>
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
        label={t('메인 저장 폴더')}
        hint={t('일반 생성 이미지가 이 폴더에 바로 쌓임')}
      />
      <SaveDirRow
        target="scene"
        label={t('씬 저장 폴더')}
        hint={t('이 폴더 아래 프리셋/씬 이름으로 정리됨')}
      />

      <div className="mt-1 border-t border-line pt-3">
        <p className="text-[13px] text-ink">{t('데이터 백업')}</p>
        <p className="mt-0.5 text-[11.5px] text-faint">
          {t('라이브러리 전체 JSON (NAIS2 백업 호환)')}
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
          if (r.saved) toast(t('내보내기 완료'), 'success')
        }}
      >
        <Upload size={14} /> {t('내보내기')}
      </Button>
      <Button
        variant="default"
        className="gap-1.5"
        onClick={async () => {
          const ok = await askConfirm(t('데이터 불러오기'), {
            message: t('데이터 불러오기로 기존 데이터가 유실될 수 있습니다. 계속할까요?'),
            confirmLabel: t('불러오기'),
            danger: true
          })
          if (!ok) return
          const r = await window.nais.invoke('backup:import', undefined)
          if ('canceled' in r) return
          if ('error' in r) {
            toast(t('가져오기 오류: {0}', r.error), 'error')
            return
          }
          toast(t(r.summary), 'success')
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
        <Download size={14} /> {t('불러오기')}
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
        <p className="text-[11.5px] text-faint">{t('항목을 클릭하고 새 키 조합을 누르세요.')}</p>
        <Button size="sm" variant="ghost" className="gap-1" onClick={resetDefaults}>
          <RotateCcw size={12} /> {t('기본값')}
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
              {recording === action ? t('키 입력…') : formatCombo(bindings[action])}
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
      setMessage(t('계정 추가됨 — {0}', result.subscription?.tier ?? '?'))
      setDraft('')
      setLabel('')
      refresh()
    } else {
      setStatus('fail')
      setMessage(t(result.error ?? '토큰 검증 실패'))
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
    const ok = await askConfirm(t('“{0}” 계정을 삭제할까요?', account.label), {
      message: t('저장된 API 토큰만 삭제되며 NovelAI 계정 자체에는 영향이 없습니다.'),
      confirmLabel: t('삭제'),
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
    <div className="flex min-h-full w-full min-w-0 max-w-full flex-col gap-3 overflow-x-hidden">
      <div className="min-w-0">
        <p className="text-[13px] text-ink">{t('NAI 계정')}</p>
        <p className="mt-0.5 text-[11.5px] text-faint">
          {t(
            '토큰은 OS 키체인으로 암호화됩니다. V5 게이지가 0%가 되면 다음 Opus 계정으로 자동 전환합니다.'
          )}
        </p>
      </div>

      <div className="grid w-full min-w-0 max-w-full grid-cols-[7rem_minmax(0,1fr)_auto] gap-1.5">
        <Input
          className="w-28 shrink-0"
          value={label}
          placeholder={t('계정 {0}', accounts.length + 1)}
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
          {status === 'checking' ? t('확인 중…') : t('추가')}
        </Button>
      </div>
      {status === 'ok' && <span className="text-[12px] text-accent">{message}</span>}
      {status === 'fail' && <span className="text-[12px] text-danger">{message}</span>}

      <div className="w-full min-w-0 max-w-full space-y-1.5">
        {accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-4 text-center text-[11.5px] text-faint">
            {t('등록된 계정이 없습니다.')}
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
                      {t(account.label)}
                    </span>
                    {account.active && (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] text-accent">
                        {t('사용 중')}
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
                        ? t('V5 게이지 확인 불가')
                        : account.usage?.isNegative
                          ? t('V5 {0}% · 소진', percent)
                          : `V5 ${percent}%`
                      : account.tier
                        ? `Anlas ${account.anlas?.toLocaleString() ?? '—'}`
                        : t('상태 확인 불가')}
                  </p>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  title={revealed[account.id] ? t('토큰 숨기기') : t('토큰 보기')}
                  onClick={() => void toggleReveal(account.id)}
                >
                  {revealed[account.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="hover:text-danger"
                  disabled={busyId !== null}
                  title={t('계정 삭제')}
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
        <div className="w-full min-w-0 max-w-full rounded-lg border border-line bg-surface-2/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
              <BatteryCharging
                size={13}
                className={opusUsage?.isNegative ? 'text-danger' : 'text-accent'}
              />
              {t('V5 사용량')}
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
                  ? t('소진됨 · 다음 V5 생성 전에 사용 가능한 계정으로 전환합니다.')
                  : t('소진됨 · 충전될 때까지 V5 생성에 Anlas를 사용합니다.')
                : t(
                    '다음 1%까지 약 {0}시간',
                    Math.max(0, opusUsage.timeUntilNextPercent / 3600).toFixed(1)
                  )
              : t('사용량을 확인하고 있습니다.')}
          </p>
        </div>
      )}

      {/* Anlas 사용량 — 잔액 스냅샷 간 감소분 합산 */}
      <div className="w-full min-w-0 max-w-full rounded-lg border border-line bg-surface-2/50 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
          <Coins size={13} className="text-[#c9a34f]" /> Anlas
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="font-mono text-[15px] text-ink">
              {anlasBalance !== null ? anlasBalance.toLocaleString() : '—'}
            </p>
            <p className="text-[10.5px] text-faint">{t('현재 잔액')}</p>
          </div>
          <div>
            <p className="font-mono text-[15px] text-ink">
              {usage ? usage.today.toLocaleString() : '—'}
            </p>
            <p className="text-[10.5px] text-faint">{t('오늘 사용')}</p>
          </div>
          <div>
            <p className="font-mono text-[15px] text-ink">
              {usage ? usage.week.toLocaleString() : '—'}
            </p>
            <p className="text-[10.5px] text-faint">{t('최근 7일')}</p>
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
      <p className="font-mono text-[11.5px] text-faint">{t('버전 {0}', version || '…')}</p>

      {/* 업데이트 상태 */}
      <div className="mt-1">
        {updateStatus === 'available' ? (
          <Button variant="accent" className="gap-1.5" onClick={startUpdate}>
            <Download size={14} /> {t('새 버전 {0} 업데이트', updateVersion ?? '')}
          </Button>
        ) : updateStatus === 'downloading' ? (
          <span className="text-[12px] text-accent">
            {t('업데이트 다운로드 중 {0}%…', updatePercent)}
          </span>
        ) : updateStatus === 'downloaded' ? (
          <span className="text-[12px] text-accent">{t('업데이트 설치 — 곧 재시작됩니다')}</span>
        ) : (
          <span className="text-[12px] text-faint">{t('최신 버전입니다')}</span>
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
        <DialogTitle className="sr-only">{t('설정')}</DialogTitle>
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
                {t(NAV.find((n) => n.id === section)?.label ?? '')}
              </h2>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-5 no-scrollbar">
              <TabsContent value="appearance" className="m-0">
                <AppearanceSection />
              </TabsContent>
              <TabsContent value="generation" className="m-0">
                <GenerationSection />
              </TabsContent>
              <TabsContent value="storage" className="m-0">
                <StorageSection />
              </TabsContent>
              <TabsContent value="shortcuts" className="m-0">
                <ShortcutsSection />
              </TabsContent>
              <TabsContent value="account" className="m-0 min-h-full w-full min-w-0 max-w-full">
                <AccountSection />
              </TabsContent>
              <TabsContent value="about" className="m-0">
                <AboutSection />
              </TabsContent>
            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

import { ExternalLink, KeyRound } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import type { IpcInvokeMap, NaiTokenStoreLockReason } from '@shared/types'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { useGenerationStore } from '../../stores/generation-store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { NaiTokenStoreLockNotice } from '../nai-token-store-lock-notice'
import { ResultBox, type StepProps } from './parts'
import { FOOT_NOTE, PANEL } from './styles'

const NOVELAI_URL = 'https://novelai.net/image'
const TOKEN_STEPS = [
  'ui.onboardingTokenStep1',
  'ui.onboardingTokenStep2',
  'ui.onboardingTokenStep3'
] as const

export function AccountStep({ done, onDone }: StepProps): React.JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<'idle' | 'checking' | 'fail'>('idle')
  const [error, setError] = useState('')
  // 연결된 계정 라벨 (이전 단계에서 돌아왔거나 백업에 계정이 있던 경우 포함)
  const [connected, setConnected] = useState<string[]>([])
  // 저장된 토큰이 있지만 읽을 수 없는 이유 — 이 동안은 새 토큰을 받지 않는다
  const [lockReason, setLockReason] = useState<NaiTokenStoreLockReason | null>(null)
  // OS 키체인을 쓸 수 없어 연결하는 토큰이 평문(base64)으로 저장되는 실행
  const [plaintextStorage, setPlaintextStorage] = useState(false)
  // 방금 연결했으면 사라진 입력란 대신 결과 상자로 포커스를 옮긴다
  const [justConnected, setJustConnected] = useState(false)
  const linked = done || justConnected || connected.length > 0
  const errorId = useId()

  useEffect(() => {
    if (linked) onDone()
  }, [linked, onDone])

  // 이미 있는 계정만 목록으로 읽는다 — 계정마다 잔액을 물어 느리고 실패할 수 있어서,
  // 방금 연결한 계정은 addAccount가 돌려준 이름으로 덧붙인다
  const loadAccounts = useCallback((): void => {
    void window.nais
      .invoke('nai:listAccounts', undefined)
      .then(({ accounts, lockReason: nextLockReason, plaintextStorage: plaintext }) => {
        setConnected(accounts.map((account) => account.label))
        // 토큰은 저장돼 있지만 읽을 수 없다 — 안내와 "잠긴 토큰 삭제" 탈출구를 보여 준다
        setLockReason(nextLockReason ?? null)
        setPlaintextStorage(plaintext === true)
      })
      .catch(() => undefined)
  }, [])
  useEffect(loadAccounts, [loadAccounts])

  async function connect(): Promise<void> {
    if (!draft.trim() || status === 'checking' || lockReason) return
    setStatus('checking')
    let result: IpcInvokeMap['nai:addAccount']['res']
    try {
      result = await window.nais.invoke('nai:addAccount', { token: draft.trim() })
    } catch (err) {
      // 통신 실패, 또는 브라우저 gateway가 잘못된 토큰 응답을 예외로 바꾼 경우
      setStatus('fail')
      setError(err instanceof Error && err.message ? err.message : t('ui.tokenValidationFailed'))
      return
    }
    if (!result.valid) {
      setStatus('fail')
      setError(result.error ?? t('ui.tokenValidationFailed'))
      return
    }
    setStatus('idle')
    setDraft('')
    if (result.subscription) {
      useGenerationStore.getState().setSubscriptionTier(result.subscription.tier)
    }
    void useGenerationStore
      .getState()
      .refreshAnlas()
      .catch(() => undefined)
    setJustConnected(true)
    const { label } = result
    if (label) setConnected((labels) => (labels.includes(label) ? labels : [...labels, label]))
  }

  if (linked) {
    return (
      <div className="w-full max-w-[560px]">
        <ResultBox
          focusOnMount={justConnected}
          title={
            connected.length > 0
              ? t('ui.onboardingAccountConnected', connected.join(', '))
              : t('ui.onboardingAccountConnectedNoLabel')
          }
          detail={t('ui.onboardingAccountMore')}
        />
      </div>
    )
  }

  return (
    <div className="w-full max-w-[560px]">
      <ol className={cn(PANEL, 'mb-6 divide-y divide-line text-[14.5px] text-muted')}>
        {TOKEN_STEPS.map((id, i) => (
          <li key={id} className="flex items-center gap-3.5 px-5 py-3.5 shorter:py-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-[12px] font-medium text-ink">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 break-keep">{t(id)}</span>
            {i === 0 && (
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 text-accent-ink underline-offset-2 hover:underline"
                onClick={() => window.open(NOVELAI_URL, '_blank')}
              >
                novelai.net <ExternalLink size={13} />
              </button>
            )}
          </li>
        ))}
      </ol>
      {lockReason && (
        <NaiTokenStoreLockNotice
          className="mb-3 text-[13px]"
          reason={lockReason}
          plaintextStorage={plaintextStorage}
          onCleared={loadAccounts}
        />
      )}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound
            size={17}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <Input
            className="h-12 pl-10 font-mono text-[15px]"
            value={draft}
            placeholder="pst-..."
            autoComplete="off"
            spellCheck={false}
            aria-label={t('ui.onboardingTokenLabel')}
            disabled={lockReason !== null}
            aria-invalid={status === 'fail'}
            aria-describedby={status === 'fail' ? errorId : undefined}
            onChange={(e) => {
              setDraft(e.target.value)
              setStatus('idle')
            }}
            onKeyDown={(e) => e.key === 'Enter' && void connect()}
          />
        </div>
        <Button
          size="lg"
          className="h-12 px-6 text-[15px]"
          disabled={!draft.trim() || status === 'checking' || lockReason !== null}
          onClick={() => void connect()}
        >
          {status === 'checking' ? t('ui.checking') : t('ui.onboardingConnect')}
        </Button>
      </div>
      {status === 'fail' && (
        <p id={errorId} role="alert" className="mt-2 text-[13px] text-danger-ink">
          {error}
        </p>
      )}
      {plaintextStorage && !lockReason && (
        <p className="mt-2 text-[13px] text-danger-ink">
          {t('ui.naiTokenPlaintextStorageWarning')}
        </p>
      )}
      <p className={FOOT_NOTE}>{t('ui.onboardingTokenPrivacy')}</p>
    </div>
  )
}

import { isOpusUsageDepleted } from '../../shared/anlas'
import { inpaintingModelFor, isV5Model } from '../../shared/nai-models'
import type { GenerationRequest, OpusUsageStatus, SubscriptionInfo } from '../../shared/types'
import {
  getActiveNaiAccount,
  getNaiAccounts,
  getSetting,
  setActiveNaiAccount,
  type StoredNaiAccount
} from '../db/settings'
import { t } from '../i18n'
import { fetchAnlasBalance } from './client'

export interface NaiAccountBalance {
  anlas: number | null
  tier: SubscriptionInfo['tier'] | null
  usage?: OpusUsageStatus
  /** 유료 구독 만료 — 게이지가 없어 V5 생성에 Anlas를 쓴다 */
  expired?: boolean
}

export interface NaiAccountSelection {
  account: StoredNaiAccount
  balance?: NaiAccountBalance
  rotated: boolean
}

/** 구독이 만료된 계정도 게이지를 쓸 수 없으니 소진된 것과 같이 다른 계정을 찾는다. */
export function isOpusUsageExhausted(balance: NaiAccountBalance): boolean {
  if (balance.expired) return true
  return balance.tier === 'opus' && !!balance.usage && isOpusUsageDepleted(balance.usage)
}

/** 실제 서버에 전달될 모델이 V5 충전 게이지를 쓰는지 판정한다. */
export function requestUsesV5Usage(request: GenerationRequest): boolean {
  const model = request.source?.maskBase64 ? inpaintingModelFor(request.model) : request.model
  return isV5Model(model)
}

function hasAvailableOpusUsage(balance: NaiAccountBalance): boolean {
  return balance.tier === 'opus' && !!balance.usage && !isOpusUsageDepleted(balance.usage)
}

/**
 * 활성 Opus 계정의 V5 게이지가 0%면 다음 사용 가능한 계정을 원형 순서로 찾는다.
 * 조회 실패·usage 누락 계정은 유료 전환 위험을 피하기 위해 자동 선택하지 않는다.
 */
export async function chooseNaiAccount(
  accounts: StoredNaiAccount[],
  activeId: string,
  usesV5Usage: boolean,
  balanceFor: (token: string) => Promise<NaiAccountBalance>
): Promise<NaiAccountSelection> {
  const activeIndex = accounts.findIndex((account) => account.id === activeId)
  const normalizedIndex = activeIndex >= 0 ? activeIndex : 0
  const active = accounts[normalizedIndex]
  if (!active) throw new Error(t('ui.naiTokenIsNotConfigured'))
  if (!usesV5Usage || accounts.length < 2) return { account: active, rotated: false }

  const activeBalance = await balanceFor(active.token)
  if (!isOpusUsageExhausted(activeBalance)) {
    return { account: active, balance: activeBalance, rotated: false }
  }

  for (let offset = 1; offset < accounts.length; offset++) {
    const candidate = accounts[(normalizedIndex + offset) % accounts.length]
    const balance = await balanceFor(candidate.token)
    if (hasAvailableOpusUsage(balance)) {
      return { account: candidate, balance, rotated: true }
    }
  }

  // 모든 계정이 소진됐거나 상태를 확인할 수 없으면 기존 단일 계정 동작(Anlas 사용)을 유지한다.
  return { account: active, balance: activeBalance, rotated: false }
}

/** 활성 계정은 바꾸지 않고 다음 생성에 쓸 계정만 고른다 (보내기 전 Anlas 가드 확인용) */
export async function previewNaiAccountForGeneration(
  usesV5Usage: boolean
): Promise<NaiAccountSelection | null> {
  const active = getActiveNaiAccount()
  if (!active) return null
  // 자동 전환을 끄면 게이지가 바닥나도 지금 계정으로 (Anlas를 써서) 생성한다
  const autoSwitch = getSetting('nai_auto_switch') !== '0'
  return chooseNaiAccount(getNaiAccounts(), active.id, usesV5Usage && autoSwitch, fetchAnlasBalance)
}

export function commitNaiAccountSelection(selection: NaiAccountSelection): void {
  if (selection.rotated) setActiveNaiAccount(selection.account.id)
}

export async function resolveNaiAccountForGeneration(
  usesV5Usage: boolean
): Promise<NaiAccountSelection | null> {
  const selection = await previewNaiAccountForGeneration(usesV5Usage)
  if (selection) commitNaiAccountSelection(selection)
  return selection
}

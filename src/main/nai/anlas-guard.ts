import { effectiveGenerationStrength } from '../../shared/anlas'
import {
  anlasGuardEnabled,
  checkAnlasGuard,
  formatAnlasGuardBlock,
  generationCharge,
  readAnlasGuardSettings,
  type AnlasCharge,
  type AnlasGuardSettings
} from '../../shared/anlas-guard'
import { inpaintingModelFor, modelCapabilities } from '../../shared/nai-models'
import { snapNaiResolution } from '../../shared/nai-resolution'
import type { GenerationRequest } from '../../shared/types'
import { getSetting } from '../db/settings'
import { t } from '../i18n'
import { charRefRowsByIds, enabledCharRefRows, enabledVibeRows, vibeRowsByIds } from '../refs/repo'
import { getVibeEncoding } from '../refs/vibe-encoding-cache'
import {
  isOpusUsageExhausted,
  previewNaiAccountForGeneration,
  requestUsesV5Usage,
  type NaiAccountBalance
} from './account-router'
import { anlasUsage, logBalance } from './anlas-log'
import { fetchAnlasBalance } from './client'

/** 가드가 막은 요청 — 큐는 이 오류를 받으면 남은 예약까지 멈춘다 */
export class AnlasGuardError extends Error {
  readonly haltQueue = true

  constructor(message: string) {
    super(message)
    this.name = 'AnlasGuardError'
  }
}

function guardSettings(): AnlasGuardSettings | null {
  const settings = readAnlasGuardSettings(getSetting)
  return anlasGuardEnabled(settings) ? settings : null
}

/**
 * 생성 파이프라인(index.ts)과 같은 순서로 실제 보낼 요청의 비용을 추정한다:
 * 바이브(미인코딩분 인코딩) → 캐릭레퍼 → i2i 해상도 스냅 → 인페인트 모델 전환.
 * encoded: 한 묶음 안에서 같은 바이브 인코딩을 한 번만 세기 위한 집합.
 */
export function requestCharge(
  request: GenerationRequest,
  balance: NaiAccountBalance,
  encoded: Set<string> = new Set()
): AnlasCharge {
  const capabilities = modelCapabilities(request.model)
  const vibeRows = capabilities.vibes
    ? request.vibeIds
      ? vibeRowsByIds(request.vibeIds)
      : enabledVibeRows()
    : []
  let unencodedVibes = 0
  for (const row of vibeRows) {
    if (getVibeEncoding(row.encoded, row.encodedIe, request.model, row.infoExtracted)) continue
    const key = `${request.model}:${row.id}:${row.infoExtracted}`
    if (encoded.has(key)) continue
    encoded.add(key)
    unencodedVibes++
  }
  const charRefCount = capabilities.characterReferences
    ? (request.charRefIds ? charRefRowsByIds(request.charRefIds) : enabledCharRefRows()).length
    : 0
  const source = request.source
  const size = source
    ? snapNaiResolution(request.width, request.height)
    : { width: request.width, height: request.height }
  const model =
    source?.maskBase64 && !request.model.includes('inpainting')
      ? inpaintingModelFor(request.model)
      : request.model
  return generationCharge(
    {
      model,
      width: size.width,
      height: size.height,
      steps: request.steps,
      strength: effectiveGenerationStrength(
        Boolean(source),
        Boolean(source?.maskBase64),
        source?.strength
      ),
      charRefCount,
      isOpus: balance.tier === 'opus',
      // 게이지를 모르면 undefined → V5는 유료로 본다
      opusUsageExhausted: balance.usage ? isOpusUsageExhausted(balance) : undefined,
      batchCount: 1,
      vibeCount: vibeRows.length,
      unencodedVibes
    },
    balance.tier !== null
  )
}

/** 방금 받은 잔액을 먼저 기록해 오늘 사용량에 직전 생성분까지 들어가게 한다 */
function spentToday(balance: NaiAccountBalance, accountId: string | undefined): number {
  if (balance.anlas !== null) logBalance(balance.anlas, accountId)
  return anlasUsage().today
}

function blockMessage(
  settings: AnlasGuardSettings,
  charges: AnlasCharge[],
  balance: NaiAccountBalance,
  accountId: string | undefined
): string | null {
  if (charges.every((charge) => charge.cost === 0)) return null
  const block = checkAnlasGuard(settings, charges, spentToday(balance, accountId))
  return block ? formatAnlasGuardBlock(block, t) : null
}

/**
 * 큐 항목 1건을 보내기 직전 확인. 계정 선택이 이미 잔액을 받았으면 그것을 쓴다.
 * 막히면 AnlasGuardError를 던진다.
 */
export async function enforceGenerationGuard(
  request: GenerationRequest,
  account: { id: string; token: string },
  knownBalance?: NaiAccountBalance
): Promise<void> {
  const settings = guardSettings()
  if (!settings) return
  const balance = knownBalance ?? (await fetchAnlasBalance(account.token))
  const message = blockMessage(settings, [requestCharge(request, balance)], balance, account.id)
  if (message) throw new AnlasGuardError(message)
}

/**
 * 예약 전에 묶음 전체를 확인해 N건 실패 대신 한 번에 알린다.
 * 활성 계정은 바꾸지 않고, 자동 전환이 고를 계정의 잔액으로 판정한다.
 */
export async function anlasGuardBlockForQueue(
  requests: GenerationRequest[]
): Promise<string | null> {
  const settings = guardSettings()
  if (!settings || requests.length === 0) return null
  const selection = await previewNaiAccountForGeneration(requests.some(requestUsesV5Usage))
  if (!selection) return null // 토큰 없음은 생성 단계의 기존 오류로 알린다
  const balance = selection.balance ?? (await fetchAnlasBalance(selection.account.token))
  const encoded = new Set<string>()
  const charges = requests.map((request) => requestCharge(request, balance, encoded))
  return blockMessage(settings, charges, balance, selection.account.id)
}

/** 업스케일·디렉터 툴처럼 큐를 거치지 않는 요청 확인 */
export async function anlasGuardBlockForDirect(
  account: { id: string; token: string },
  chargeFor: (balance: NaiAccountBalance) => AnlasCharge
): Promise<string | null> {
  const settings = guardSettings()
  if (!settings) return null
  const balance = await fetchAnlasBalance(account.token)
  return blockMessage(settings, [chargeFor(balance)], balance, account.id)
}

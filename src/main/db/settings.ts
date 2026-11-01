import { safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from './index'

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

/** 새 설치 첫 실행에 온보딩을 띄운다. 부가 기능이라 저장 실패로 시작을 막지 않는다 */
export function markOnboardingPending(): void {
  try {
    setSetting('onboarding_pending', '1')
  } catch {
    // 온보딩 없이 시작
  }
}

const TOKEN_KEY = 'nai_token_encrypted'
const ACCOUNTS_KEY = 'nai_accounts_encrypted'

export interface StoredNaiAccount {
  id: string
  label: string
  token: string
}

interface StoredNaiAccountState {
  version: 1
  activeId: string | null
  accounts: StoredNaiAccount[]
}

/**
 * 저장 형식은 구버전과 같다 (암호문 또는 평문 폴백의 base64, 표지 없음).
 * 표지를 붙이면 구버전으로 되돌렸을 때 두 키를 모두 못 읽고, 구버전은 단일 토큰 키로
 * 다계정 키를 덮어써 나머지 계정을 잃는다.
 */
function encrypt(value: string): string {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString('base64')
    : Buffer.from(value, 'utf-8').toString('base64')
}

/**
 * 해독 성공 = 문자열, 값이 있지만 지금은 읽을 수 없음 = null (잠김).
 * 값은 암호문일 수도, 키체인이 없던 실행이 쓴 평문 폴백일 수도 있다. 평문으로 읽은 값은
 * 검증을 통과해야 쓴다 — 키체인을 못 여는 실행이 암호문을 평문으로 오인하고
 * 그 쓰레기 값으로 원본을 덮어쓰지 않도록.
 */
function decrypt(value: string, isValidPlaintext: (plaintext: string) => boolean): string | null {
  const buf = Buffer.from(value, 'base64')
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const plaintext = safeStorage.decryptString(buf)
      if (isValidPlaintext(plaintext)) return plaintext
    } catch {
      // 평문 폴백이었는지 아래에서 검증한다
    }
  }
  const plaintext = buf.toString('utf-8')
  return isValidPlaintext(plaintext) ? plaintext : null
}

function parseAccountState(plaintext: string): StoredNaiAccountState | null {
  try {
    return normalizeState(JSON.parse(plaintext))
  } catch {
    return null
  }
}

function isValidAccountStateText(plaintext: string): boolean {
  return parseAccountState(plaintext) !== null
}

/** 인쇄 가능한 ASCII 한 줄 — 암호문을 평문으로 잘못 해석한 값은 여기서 걸러진다 */
function isSaneToken(plaintext: string): boolean {
  const token = plaintext.trim()
  return token.length > 0 && token.length <= 4096 && /^[\x21-\x7e]+$/.test(token)
}

function normalizeState(value: unknown): StoredNaiAccountState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<StoredNaiAccountState>
  if (!Array.isArray(raw.accounts)) return null
  const accounts = raw.accounts.filter(
    (account): account is StoredNaiAccount =>
      !!account &&
      typeof account.id === 'string' &&
      typeof account.label === 'string' &&
      typeof account.token === 'string' &&
      account.token.trim().length > 0
  )
  const activeId = accounts.some((account) => account.id === raw.activeId)
    ? (raw.activeId ?? null)
    : (accounts[0]?.id ?? null)
  return { version: 1, activeId, accounts }
}

function deleteSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}

function saveNaiAccountState(state: StoredNaiAccountState): void {
  const accountsValue = encrypt(JSON.stringify(state))
  // 구버전으로 되돌렸을 때도 현재 활성 계정을 읽을 수 있도록 기존 키를 동기화한다.
  const active = state.accounts.find((account) => account.id === state.activeId)
  const tokenValue = active ? encrypt(active.token) : null
  getDb().transaction(() => {
    setSetting(ACCOUNTS_KEY, accountsValue)
    if (tokenValue) setSetting(TOKEN_KEY, tokenValue)
    else deleteSetting(TOKEN_KEY)
  })()
}

interface LoadedNaiAccountState {
  locked: boolean
  state: StoredNaiAccountState
}

const EMPTY_STATE = (): StoredNaiAccountState => ({ version: 1, activeId: null, accounts: [] })

/**
 * 읽기 경로. 저장된 값이 있는데 해독·파싱할 수 없으면 "잠김"으로 보고 아무것도 쓰지 않는다
 * (키체인이 잠긴 실행 한 번이 저장된 토큰을 영구히 덮어쓰지 않도록).
 * 쓰기는 다계정 키가 아예 없을 때의 구버전 단일 토큰 이전뿐이다.
 */
function loadNaiAccountState(): LoadedNaiAccountState {
  const stored = getSetting(ACCOUNTS_KEY)
  if (stored !== null) {
    const plaintext = decrypt(stored, isValidAccountStateText)
    const parsed = plaintext === null ? null : parseAccountState(plaintext)
    return parsed ? { locked: false, state: parsed } : { locked: true, state: EMPTY_STATE() }
  }

  const legacy = getSetting(TOKEN_KEY)
  if (legacy === null) return { locked: false, state: EMPTY_STATE() }
  const token = decrypt(legacy, isSaneToken)?.trim()
  if (!token) return { locked: true, state: EMPTY_STATE() }
  const id = randomUUID()
  const migrated: StoredNaiAccountState = {
    version: 1,
    activeId: id,
    accounts: [{ id, label: '계정 1', token }]
  }
  saveNaiAccountState(migrated)
  return { locked: false, state: migrated }
}

/** 저장된 토큰을 지금은 읽을 수 없어 변경을 거부할 때 던진다 */
export class NaiTokenStoreLockedError extends Error {
  constructor() {
    super('NAI token store is locked: the OS keychain cannot decrypt the saved tokens')
    this.name = 'NaiTokenStoreLockedError'
  }
}

/**
 * 저장된 토큰이 있지만 OS 키체인(safeStorage)으로 해독할 수 없는 상태인지.
 * 잠긴 동안 읽기는 빈 계정 목록을 돌려주고, 변경은 NaiTokenStoreLockedError로 거부한다.
 */
export function isNaiTokenStoreLocked(): boolean {
  return loadNaiAccountState().locked
}

function loadUnlockedState(): StoredNaiAccountState {
  const loaded = loadNaiAccountState()
  if (loaded.locked) throw new NaiTokenStoreLockedError()
  return loaded.state
}

function cleanLabel(label: string | undefined, fallback: string): string {
  const cleaned = label?.trim().slice(0, 60)
  return cleaned || fallback
}

/**
 * NAI 토큰은 OS 키체인 기반 safeStorage로 암호화해 저장한다.
 * (NAIS2에서 "설정 파일 못 뜯어본다"는 불만이 있었지만 토큰만큼은 평문 금지)
 */
export function setNaiToken(token: string): void {
  const state = loadUnlockedState()
  const normalized = token.trim()
  const active = state.accounts.find((account) => account.id === state.activeId)
  if (active) active.token = normalized
  else {
    const id = randomUUID()
    state.accounts.push({ id, label: '계정 1', token: normalized })
    state.activeId = id
  }
  saveNaiAccountState(state)
}

export function getNaiToken(): string | null {
  return getActiveNaiAccount()?.token ?? null
}

/** 명시적 삭제는 잠긴 값도 지운다 (키체인을 되살릴 수 없을 때의 탈출구) */
export function deleteNaiToken(): void {
  getDb().transaction(() => {
    deleteSetting(ACCOUNTS_KEY)
    deleteSetting(TOKEN_KEY)
  })()
}

/** 마스킹 표시용 메타 (WHIMS 프로바이더 키 UI 패턴) */
export function getNaiTokenInfo(): {
  hasToken: boolean
  prefix: string
  length: number
  locked: boolean
} {
  const { locked, state } = loadNaiAccountState()
  const token = state.accounts.find((account) => account.id === state.activeId)?.token
  if (!token) return { hasToken: false, prefix: '', length: 0, locked }
  return { hasToken: true, prefix: token.slice(0, 4), length: token.length, locked }
}

export function getNaiAccounts(): StoredNaiAccount[] {
  return loadNaiAccountState().state.accounts.map((account) => ({ ...account }))
}

export function getActiveNaiAccount(): StoredNaiAccount | null {
  const { state } = loadNaiAccountState()
  return state.accounts.find((account) => account.id === state.activeId) ?? null
}

export function addNaiAccount(token: string, label?: string): StoredNaiAccount {
  const state = loadUnlockedState()
  const normalized = token.trim()
  const duplicate = state.accounts.find((account) => account.token === normalized)
  if (duplicate) {
    duplicate.label = cleanLabel(label, duplicate.label)
    state.activeId = duplicate.id
    saveNaiAccountState(state)
    return { ...duplicate }
  }

  const account: StoredNaiAccount = {
    id: randomUUID(),
    label: cleanLabel(label, `계정 ${state.accounts.length + 1}`),
    token: normalized
  }
  state.accounts.push(account)
  state.activeId = account.id
  saveNaiAccountState(state)
  return { ...account }
}

export function setActiveNaiAccount(id: string): boolean {
  const state = loadUnlockedState()
  if (!state.accounts.some((account) => account.id === id)) return false
  state.activeId = id
  saveNaiAccountState(state)
  return true
}

export function getNaiAccountToken(id: string): string | null {
  return loadNaiAccountState().state.accounts.find((account) => account.id === id)?.token ?? null
}

export function deleteNaiAccount(id: string): string | null {
  const state = loadUnlockedState()
  const index = state.accounts.findIndex((account) => account.id === id)
  if (index < 0) return state.activeId
  state.accounts.splice(index, 1)
  if (state.activeId === id) {
    state.activeId = state.accounts[index]?.id ?? state.accounts[index - 1]?.id ?? null
  }
  saveNaiAccountState(state)
  return state.activeId
}

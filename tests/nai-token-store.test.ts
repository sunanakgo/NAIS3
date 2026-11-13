import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * safeStorage를 흉내 낸다. 실제 OS 암호문처럼 "v10" 머리 + 인쇄 불가 바이트로 만들어,
 * 키체인이 없는 실행이 이를 평문으로 오인하면 쓰레기 문자열이 되도록 한다.
 */
const env = vi.hoisted(() => {
  const settings = new Map<string, string>()
  const state = { available: true, writes: 0 }
  const encryptString = (value: string): Buffer => {
    const body = Buffer.from(value, 'utf-8').map((byte) => byte ^ 0xa5)
    return Buffer.concat([Buffer.from('v10'), body])
  }
  const decryptString = (buf: Buffer): string => {
    if (!state.available) throw new Error('safeStorage unavailable')
    if (buf.subarray(0, 3).toString() !== 'v10') throw new Error('bad ciphertext')
    return Buffer.from(buf.subarray(3).map((byte) => byte ^ 0xa5)).toString('utf-8')
  }
  const db = {
    prepare(sql: string) {
      return {
        get: (key: string) => {
          const value = settings.get(key)
          return value === undefined ? undefined : { value }
        },
        run: (key: string, value?: string) => {
          state.writes++
          if (sql.startsWith('DELETE')) settings.delete(key)
          else settings.set(key, value as string)
        }
      }
    },
    transaction<T>(fn: () => T) {
      // better-sqlite3처럼 실패하면 트랜잭션 안의 변경을 모두 되돌린다
      return () => {
        const snapshot = new Map(settings)
        try {
          return fn()
        } catch (err) {
          settings.clear()
          for (const [k, v] of snapshot) settings.set(k, v)
          throw err
        }
      }
    }
  }
  return { settings, state, encryptString, decryptString, db }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => env.state.available,
    encryptString: (value: string) => {
      if (!env.state.available) throw new Error('safeStorage unavailable')
      return env.encryptString(value)
    },
    decryptString: (buf: Buffer) => env.decryptString(buf)
  }
}))
vi.mock('../src/main/db/index', () => ({ getDb: () => env.db }))

const store = await import('../src/main/db/settings')

const ACCOUNTS_KEY = 'nai_accounts_encrypted'
const TOKEN_KEY = 'nai_token_encrypted'

function accountState(tokens: string[]): string {
  return JSON.stringify({
    version: 1,
    activeId: 'a0',
    accounts: tokens.map((token, i) => ({ id: `a${i}`, label: `L${i}`, token }))
  })
}

/** 키체인으로 암호화해 저장한 값 (이전 버전과 같은 형식) */
function legacyEncrypted(value: string): string {
  return env.encryptString(value).toString('base64')
}

/** 키체인 없이 평문 폴백으로 저장한 값 (이전 버전과 같은 형식) */
function legacyPlain(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64')
}

/** 이전 버전(롤백 대상)의 decrypt 그대로 */
function oldDecrypt(value: string): string | null {
  const buf = Buffer.from(value, 'base64')
  try {
    return env.state.available ? env.decryptString(buf) : buf.toString('utf-8')
  } catch {
    return null
  }
}

beforeEach(() => {
  env.settings.clear()
  env.state.available = true
  env.state.writes = 0
})

describe('NAI 토큰 저장소: 키체인을 쓸 수 없는 실행', () => {
  it('암호화된 값을 키체인 없이 읽으면 원본을 한 바이트도 바꾸지 않고 잠김으로 보고한다', () => {
    env.settings.set(ACCOUNTS_KEY, legacyEncrypted(accountState(['pst-aaaa', 'pst-bbbb'])))
    env.settings.set(TOKEN_KEY, legacyEncrypted('pst-aaaa'))
    const before = new Map(env.settings)
    env.state.available = false

    expect(store.getNaiAccounts()).toEqual([])
    expect(store.getNaiToken()).toBeNull()
    expect(store.getActiveNaiAccount()).toBeNull()
    expect(store.getNaiAccountToken('a0')).toBeNull()
    expect(store.getNaiTokenInfo()).toEqual({
      hasToken: false,
      prefix: '',
      length: 0,
      locked: true,
      lockReason: 'keychain'
    })
    expect(store.isNaiTokenStoreLocked()).toBe(true)

    expect(env.state.writes).toBe(0)
    expect(env.settings).toEqual(before)

    // 키체인이 돌아오면 원래 계정이 그대로 있다
    env.state.available = true
    expect(store.isNaiTokenStoreLocked()).toBe(false)
    expect(store.getNaiAccounts().map((a) => a.token)).toEqual(['pst-aaaa', 'pst-bbbb'])
  })

  it('새로 쓴 암호문도 키체인 없이 읽으면 잠김이고 아무것도 쓰지 않는다', () => {
    store.addNaiAccount('pst-new-token', 'Main')
    const before = new Map(env.settings)
    env.state.available = false
    env.state.writes = 0

    expect(store.getNaiTokenInfo().locked).toBe(true)
    expect(store.getNaiAccounts()).toEqual([])
    expect(env.state.writes).toBe(0)
    expect(env.settings).toEqual(before)
  })

  it('다계정 값은 잠겼고 구버전 단일 토큰만 읽히는 경우에도 구버전 키로 덮어쓰지 않는다', () => {
    env.settings.set(ACCOUNTS_KEY, legacyEncrypted(accountState(['pst-aaaa'])))
    env.settings.set(TOKEN_KEY, legacyPlain('pst-legacy'))
    const before = new Map(env.settings)
    env.state.available = false

    expect(store.getNaiToken()).toBeNull()
    expect(store.isNaiTokenStoreLocked()).toBe(true)
    expect(env.settings).toEqual(before)
  })

  it('키체인을 쓸 수 없으면 새 토큰이 평문 폴백으로 저장된다고 알린다', () => {
    expect(store.isNaiTokenEncryptionAvailable()).toBe(true)
    env.state.available = false
    expect(store.isNaiTokenEncryptionAvailable()).toBe(false)
  })

  it('평문 폴백은 이전 버전과 같은 형식으로 저장하고 그대로 다시 읽힌다', () => {
    env.state.available = false
    const account = store.addNaiAccount('pst-plain-token', 'Plain')
    expect(env.settings.get(TOKEN_KEY)).toBe(legacyPlain('pst-plain-token'))
    expect(store.getNaiToken()).toBe('pst-plain-token')
    expect(store.getNaiTokenInfo()).toEqual({
      hasToken: true,
      prefix: 'pst-',
      length: 'pst-plain-token'.length,
      locked: false,
      lockReason: null
    })
    expect(store.getActiveNaiAccount()).toEqual(account)

    // 나중에 키체인이 생겨도 평문 폴백 값은 읽히고, 다음 저장부터 암호화된다
    env.state.available = true
    expect(store.getNaiToken()).toBe('pst-plain-token')
    store.addNaiAccount('pst-second', 'Second')
    expect(env.settings.get(TOKEN_KEY)).toBe(legacyEncrypted('pst-second'))
    expect(store.getNaiAccounts().map((a) => a.token)).toEqual(['pst-plain-token', 'pst-second'])
  })
})

describe('NAI 토큰 저장소: 표지 없는 구버전 값', () => {
  it('키체인이 있으면 구버전 암호문 다계정 값을 읽는다', () => {
    env.settings.set(ACCOUNTS_KEY, legacyEncrypted(accountState(['pst-aaaa', 'pst-bbbb'])))
    expect(store.getNaiToken()).toBe('pst-aaaa')
    expect(store.isNaiTokenStoreLocked()).toBe(false)
  })

  it('키체인이 있으면 구버전 평문 폴백 다계정 값도 검증 후 읽는다', () => {
    env.settings.set(ACCOUNTS_KEY, legacyPlain(accountState(['pst-aaaa'])))
    expect(store.getNaiToken()).toBe('pst-aaaa')
  })

  it('키체인이 없으면 구버전 평문 다계정 값을 검증 후 읽는다', () => {
    env.state.available = false
    env.settings.set(ACCOUNTS_KEY, legacyPlain(accountState(['pst-aaaa', 'pst-bbbb'])))
    expect(store.getNaiAccounts().map((a) => a.token)).toEqual(['pst-aaaa', 'pst-bbbb'])
    expect(store.isNaiTokenStoreLocked()).toBe(false)
  })

  it('키체인이 있으면 구버전 암호문 단일 토큰을 다계정으로 옮긴다', () => {
    env.settings.set(TOKEN_KEY, legacyEncrypted('pst-legacy'))
    expect(store.getNaiToken()).toBe('pst-legacy')
    expect(oldDecrypt(env.settings.get(ACCOUNTS_KEY) as string)).toContain('pst-legacy')
    expect(store.getNaiAccounts()).toHaveLength(1)
  })

  it('키체인이 없으면 구버전 평문 단일 토큰을 다계정으로 옮긴다', () => {
    env.state.available = false
    env.settings.set(TOKEN_KEY, legacyPlain('pst-legacy'))
    expect(store.getNaiToken()).toBe('pst-legacy')
    expect(oldDecrypt(env.settings.get(ACCOUNTS_KEY) as string)).toContain('pst-legacy')
  })

  it('키체인이 없을 때 구버전 암호문 단일 토큰은 잠김이고 옮기거나 덮어쓰지 않는다', () => {
    env.settings.set(TOKEN_KEY, legacyEncrypted('pst-legacy'))
    const before = new Map(env.settings)
    env.state.available = false

    expect(store.getNaiToken()).toBeNull()
    expect(store.isNaiTokenStoreLocked()).toBe(true)
    expect(env.state.writes).toBe(0)
    expect(env.settings).toEqual(before)
  })
})

describe('NAI 토큰 저장소: 구버전으로 롤백', () => {
  it.each([
    ['키체인 있음', true],
    ['키체인 없음(평문 폴백)', false]
  ])('%s: 새로 쓴 두 키를 구버전 decrypt가 그대로 읽는다', (_label, available) => {
    env.state.available = available
    store.addNaiAccount('pst-aaaa', 'A')
    store.addNaiAccount('pst-bbbb', 'B')

    const accounts = oldDecrypt(env.settings.get(ACCOUNTS_KEY) as string)
    expect(JSON.parse(accounts as string).accounts.map((a: { token: string }) => a.token)).toEqual([
      'pst-aaaa',
      'pst-bbbb'
    ])
    expect(oldDecrypt(env.settings.get(TOKEN_KEY) as string)).toBe('pst-bbbb')
  })
})

describe('NAI 토큰 저장소: 구버전 단일 토큰 이전', () => {
  it('다계정 키가 해독은 되지만 손상돼 있으면 읽히는 구버전 토큰으로 복구한다', () => {
    env.settings.set(ACCOUNTS_KEY, legacyEncrypted('{not json'))
    env.settings.set(TOKEN_KEY, legacyEncrypted('pst-legacy'))

    expect(store.getNaiToken()).toBe('pst-legacy')
    expect(store.getNaiTokenStoreLock()).toBeNull()
    expect(oldDecrypt(env.settings.get(ACCOUNTS_KEY) as string)).toContain('pst-legacy')
    // 복구한 계정 id가 읽을 때마다 바뀌지 않는다
    expect(store.getActiveNaiAccount()?.id).toBe(store.getActiveNaiAccount()?.id)
  })

  it('키체인 없이 쓴 평문 다계정 값이 손상됐으면 평문 구버전 토큰으로 복구한다', () => {
    env.state.available = false
    env.settings.set(ACCOUNTS_KEY, legacyPlain('{"version":1,"accounts":'))
    env.settings.set(TOKEN_KEY, legacyPlain('pst-legacy'))

    expect(store.getNaiToken()).toBe('pst-legacy')
    expect(store.getNaiTokenStoreLock()).toBeNull()
  })

  it.each([
    ['구버전 키 없음', null],
    ['구버전 키도 손상', legacyEncrypted('\u0000\u0001 not a token')]
  ])(
    '다계정 키가 손상됐고 복구할 구버전 토큰이 없으면(%s) 잠김이 아니라 손상으로 보고한다',
    (_label, legacy) => {
      env.settings.set(ACCOUNTS_KEY, legacyEncrypted('{not json'))
      if (legacy) env.settings.set(TOKEN_KEY, legacy)
      const before = new Map(env.settings)

      expect(store.getNaiToken()).toBeNull()
      expect(store.getNaiTokenStoreLock()).toBe('corrupt')
      expect(store.isNaiTokenStoreLocked()).toBe(true)
      expect(store.getNaiTokenInfo()).toMatchObject({ locked: true, lockReason: 'corrupt' })
      expect(() => store.addNaiAccount('pst-new')).toThrow(
        expect.objectContaining({ name: 'NaiTokenStoreLockedError', reason: 'corrupt' })
      )
      expect(env.state.writes).toBe(0)
      expect(env.settings).toEqual(before)
    }
  )

  it('다계정 키가 손상됐어도 구버전 토큰이 키체인 때문에 안 열리면 잠김으로 두고 덮어쓰지 않는다', () => {
    env.settings.set(ACCOUNTS_KEY, legacyPlain('{not json'))
    env.settings.set(TOKEN_KEY, legacyEncrypted('pst-legacy'))
    env.state.available = false
    const before = new Map(env.settings)

    expect(store.getNaiTokenStoreLock()).toBe('keychain')
    expect(env.state.writes).toBe(0)
    expect(env.settings).toEqual(before)

    // 잠금이 풀리면 구버전 토큰으로 복구된다
    env.state.available = true
    expect(store.getNaiToken()).toBe('pst-legacy')
  })

  it('해독하지 못한 다계정 값은 구버전 토큰이 읽혀도 손상으로 오인해 덮어쓰지 않는다', () => {
    env.settings.set(ACCOUNTS_KEY, legacyEncrypted('{not json'))
    env.settings.set(TOKEN_KEY, legacyPlain('pst-legacy'))
    env.state.available = false
    const before = new Map(env.settings)

    expect(store.getNaiTokenStoreLock()).toBe('keychain')
    expect(env.settings).toEqual(before)
  })

  it('다계정 키가 비어 있는 정상 상태면 구버전 토큰을 되살리지 않는다', () => {
    store.addNaiAccount('pst-only', 'Only')
    store.deleteNaiAccount(store.getNaiAccounts()[0].id)
    env.settings.set(TOKEN_KEY, legacyEncrypted('pst-legacy'))

    expect(store.getNaiAccounts()).toEqual([])
    expect(store.isNaiTokenStoreLocked()).toBe(false)
  })
})

describe('NAI 토큰 저장소: 잠긴 동안의 변경', () => {
  function lockStore(): Map<string, string> {
    env.settings.set(ACCOUNTS_KEY, legacyEncrypted(accountState(['pst-aaaa', 'pst-bbbb'])))
    env.settings.set(TOKEN_KEY, legacyEncrypted('pst-aaaa'))
    env.state.available = false
    return new Map(env.settings)
  }

  it('setNaiToken, addNaiAccount, setActiveNaiAccount, deleteNaiAccount는 거부하고 원본을 지킨다', () => {
    const before = lockStore()
    expect(() => store.setNaiToken('pst-new')).toThrow(store.NaiTokenStoreLockedError)
    expect(() => store.addNaiAccount('pst-new')).toThrow(store.NaiTokenStoreLockedError)
    expect(() => store.setActiveNaiAccount('a1')).toThrow(store.NaiTokenStoreLockedError)
    expect(() => store.deleteNaiAccount('a0')).toThrow(store.NaiTokenStoreLockedError)
    expect(env.state.writes).toBe(0)
    expect(env.settings).toEqual(before)
  })

  it('명시적인 deleteNaiToken은 잠긴 값도 지우고 잠김을 푼다', () => {
    lockStore()
    store.deleteNaiToken()
    expect(env.settings.has(ACCOUNTS_KEY)).toBe(false)
    expect(env.settings.has(TOKEN_KEY)).toBe(false)
    expect(store.isNaiTokenStoreLocked()).toBe(false)
    store.addNaiAccount('pst-fresh')
    expect(store.getNaiToken()).toBe('pst-fresh')
  })
})

describe('NAI 토큰 저장소: 저장의 원자성', () => {
  it('두 키 중 하나를 쓰다 실패하면 다른 키도 이전 값으로 남는다', () => {
    store.addNaiAccount('pst-aaaa', 'A')
    const before = new Map(env.settings)
    const original = env.db.prepare
    let calls = 0
    env.db.prepare = (sql: string) => {
      const stmt = original(sql)
      return {
        ...stmt,
        run: (key: string, value?: string) => {
          if (++calls === 2) throw new Error('disk full')
          stmt.run(key, value)
        }
      }
    }
    try {
      expect(() => store.addNaiAccount('pst-bbbb', 'B')).toThrow('disk full')
    } finally {
      env.db.prepare = original
    }
    expect(env.settings).toEqual(before)
  })
})

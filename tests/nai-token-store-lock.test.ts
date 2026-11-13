import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KO } from '../src/shared/i18n/catalog-ko'

/** 저장된 값과 키체인 상태만 흉내 낸다 (ui_language가 없으면 메인 번역은 한국어) */
const env = vi.hoisted(() => {
  const settings = new Map<string, string>()
  const state = { available: true }
  const db = {
    prepare(sql: string) {
      return {
        get: (key: string) => {
          const value = settings.get(key)
          return value === undefined ? undefined : { value }
        },
        run: (key: string, value?: string) => {
          if (sql.startsWith('DELETE')) settings.delete(key)
          else settings.set(key, value as string)
        }
      }
    },
    transaction<T>(fn: () => T) {
      return () => fn()
    }
  }
  return { settings, state, db }
})

vi.mock('electron', () => ({
  app: {},
  safeStorage: {
    isEncryptionAvailable: () => env.state.available,
    encryptString: (value: string) =>
      Buffer.concat([Buffer.from('v10'), Buffer.from(value, 'utf-8').map((b) => b ^ 0xa5)]),
    decryptString: (buf: Buffer) => {
      if (!env.state.available) throw new Error('safeStorage unavailable')
      return Buffer.from(buf.subarray(3).map((b) => b ^ 0xa5)).toString('utf-8')
    }
  }
}))
vi.mock('../src/main/db/index', () => ({ getDb: () => env.db }))

const store = await import('../src/main/db/settings')
const lock = await import('../src/main/nai/token-store-lock')

beforeEach(() => {
  env.settings.clear()
  env.state.available = true
})

describe('토큰 저장소 잠김을 IPC 결과로 바꾸기', () => {
  it('검사 뒤 verifyToken을 기다리는 사이 잠겨도 번역된 거절 결과를 돌려준다', () => {
    store.addNaiAccount('pst-aaaa', 'A')
    // 미리 검사할 때는 열려 있었다
    expect(lock.lockedTokenStoreResult()).toBeNull()
    // ...그 뒤 키체인이 잠겼다
    env.state.available = false

    const result = lock.catchTokenStoreLock(
      () => store.addNaiAccount('pst-bbbb'),
      lock.tokenStoreLockedResult
    )
    expect(result).toEqual({ valid: false, error: KO['ui.naiTokenStoreLocked'] })
  })

  it('손상된 저장소는 키체인 잠김이 아니라 손상 안내로 거절한다', () => {
    env.settings.set('nai_accounts_encrypted', Buffer.from('{not json', 'utf-8').toString('base64'))
    expect(lock.lockedTokenStoreResult()).toEqual({
      valid: false,
      error: KO['ui.naiTokenStoreCorrupt']
    })
    expect(
      lock.catchTokenStoreLock(
        () => store.deleteNaiAccount('a0'),
        (reason) => ({ activeId: null, locked: true, lockReason: reason })
      )
    ).toEqual({ activeId: null, locked: true, lockReason: 'corrupt' })
  })

  it('잠김이 아닌 오류는 그대로 던진다', () => {
    expect(() =>
      lock.catchTokenStoreLock(() => {
        throw new Error('disk full')
      }, lock.tokenStoreLockedResult)
    ).toThrow('disk full')
  })
})

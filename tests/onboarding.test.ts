// @vitest-environment happy-dom
import { MotionGlobalConfig } from 'motion/react'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import { emptyState } from '../src/renderer/src/browser/browser-db'
import { Onboarding } from '../src/renderer/src/components/onboarding'
import { Titlebar } from '../src/renderer/src/components/titlebar'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import { useGenerationStore } from '../src/renderer/src/stores/generation-store'
import { useDialogStore } from '../src/renderer/src/stores/dialog-store'
import { useLayoutStore } from '../src/renderer/src/stores/layout-store'
import { useThemeStore } from '../src/renderer/src/stores/theme-store'
import { bindShortcuts } from '../src/renderer/src/stores/shortcuts-store'
import { importBackup } from '../src/renderer/src/lib/backup-import'

vi.mock('../src/renderer/src/lib/backup-import', () => ({ importBackup: vi.fn() }))

let root: Root
let container: HTMLDivElement
let settings: Record<string, string>
let accounts: { id: string; label: string; active: boolean }[]
let saveDir: string
const invoke = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  MotionGlobalConfig.skipAnimations = true
  settings = {}
  accounts = []
  saveDir = '/Users/me/Pictures/NAIS3'
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, request?: Record<string, string>) => {
    if (channel === 'settings:get') return { value: settings[request!.key] ?? null }
    if (channel === 'settings:set') {
      settings[request!.key] = request!.value
      return undefined
    }
    if (channel === 'nai:listAccounts') return { accounts }
    if (channel === 'nai:addAccount') {
      if (request!.token === 'pst-offline') throw new Error('network down')
      if (request!.token !== 'pst-valid') return { valid: false, error: 'bad token' }
      accounts = [{ id: 'a', label: '계정 1', active: true }]
      return { valid: true, accountId: 'a', label: '계정 1', subscription: { tier: 'Opus' } }
    }
    if (channel === 'nai:anlas') return { anlas: null }
    if (channel === 'settings:getSaveDir') return { dir: saveDir, isDefault: true }
    if (channel === 'settings:pickSaveDir') {
      saveDir = '/Volumes/Art/NAIS3'
      return { dir: saveDir }
    }
    return undefined
  })
  window.nais = { invoke, on: () => () => {} } as NaisApi
  useLanguageStore.setState({ lang: 'ko' })
  useLayoutStore.setState({ onboardingOpen: false, leftOpen: true })
  useThemeStore.setState({ theme: 'dark', presetId: 'nais3' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  MotionGlobalConfig.skipAnimations = false
  vi.unstubAllGlobals()
})

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text
  )
  if (!found) throw new Error(`button "${text}" not found`)
  return found
}

async function click(text: string): Promise<void> {
  await act(async () => button(text).click())
}

/** 미리보기가 들어간 선택 카드는 이름으로 시작하는 radio로 찾는다 */
async function choose(label: string): Promise<void> {
  const radio = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((r) =>
    r.textContent?.includes(label)
  )
  if (!radio) throw new Error(`radio "${label}" not found`)
  await act(async () => radio.click())
}

async function next(times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    // 계정 단계처럼 '다음'이 잠긴 단계는 '건너뛰기'로 넘긴다
    await click(i === 0 ? '시작하기' : button('다음').disabled ? '건너뛰기' : '다음')
  }
}

describe('first-run onboarding flag', () => {
  it('opens only when a new installation marked it pending', async () => {
    await useLayoutStore.getState().hydrate()
    expect(useLayoutStore.getState().onboardingOpen).toBe(false)

    settings.onboarding_pending = '1'
    await useLayoutStore.getState().hydrate()
    expect(useLayoutStore.getState().onboardingOpen).toBe(true)
  })

  it('persists completion so it never shows again', async () => {
    settings.onboarding_pending = '1'
    await useLayoutStore.getState().hydrate()
    useLayoutStore.getState().finishOnboarding()

    expect(useLayoutStore.getState().onboardingOpen).toBe(false)
    expect(settings.onboarding_pending).toBe('0')
  })

  it('marks only a brand-new browser workspace as pending', () => {
    expect(emptyState().settings.onboarding_pending).toBe('1')
  })

  it('ignores app shortcuts while onboarding is shown', () => {
    const unbind = bindShortcuts()
    useLayoutStore.setState({ onboardingOpen: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', ctrlKey: true }))
    expect(useLayoutStore.getState().leftOpen).toBe(true)

    useLayoutStore.setState({ onboardingOpen: false })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', ctrlKey: true }))
    expect(useLayoutStore.getState().leftOpen).toBe(false)
    unbind()
  })
})

describe('onboarding titlebar', () => {
  it('shows only the window controls and the dev badge', async () => {
    useLayoutStore.setState({ onboardingOpen: true })
    await act(async () => root.render(h(Titlebar)))

    const labels = [...container.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label')
    )
    expect(labels).toEqual(['최소화', '최대화', '닫기'])
    expect(container.querySelector('nav')).toBeNull()
    expect(container.textContent).toBe('DEV')
  })

  it('reopens onboarding from the dev-only button', async () => {
    await act(async () => root.render(h(Titlebar)))
    await click('Force onboarding')

    expect(useLayoutStore.getState().onboardingOpen).toBe(true)
    expect(container.textContent).not.toContain('Force onboarding')
  })
})

describe('onboarding flow', () => {
  it('walks through every step and finishes', async () => {
    useLayoutStore.setState({ onboardingOpen: true })
    await act(async () => root.render(h(Onboarding)))

    expect(container.textContent).toContain('NAIS3에 오신 것을 환영합니다')
    await click('시작하기')
    expect(container.textContent).toContain('언어 선택')
    await click('다음')
    expect(container.textContent).toContain('모양 선택')
    await click('다음')
    expect(container.textContent).toContain('프롬프트 입력 방식')
    await click('다음')
    expect(container.textContent).toContain('이미지 저장')
    await click('다음')
    expect(container.textContent).toContain('NovelAI 계정 연결')
    // 계정 단계는 연결 전엔 '다음'이 잠기고 '건너뛰기'로만 넘어간다
    expect(button('다음').disabled).toBe(true)
    await click('건너뛰기')
    expect(container.textContent).toContain('기존 데이터 가져오기')
    // 데이터 가져오기도 불러오기 전엔 '건너뛰기'로만 넘어간다
    expect(button('다음').disabled).toBe(true)
    await click('건너뛰기')
    expect(container.textContent).toContain('알아두면 좋은 것')
    expect(container.textContent).not.toContain('온보딩 생략')
    await click('NAIS3 시작하기')

    expect(useLayoutStore.getState().onboardingOpen).toBe(false)
    expect(settings.onboarding_pending).toBe('0')
  })

  it('validates and connects a NovelAI token', async () => {
    await act(async () => root.render(h(Onboarding)))
    await next(5)
    const input = container.querySelector<HTMLInputElement>('input[aria-label="NovelAI API 토큰"]')!
    const type = async (value: string): Promise<void> =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          value
        )
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      })

    await type('pst-wrong')
    await click('연결')
    expect(container.textContent).toContain('bad token')
    // 오류는 입력란에 묶여 스크린리더가 바로 읽는다
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const error = document.getElementById(input.getAttribute('aria-describedby')!)!
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toBe('bad token')

    // 예외가 나도 확인 중 상태에 멈추지 않고 다시 시도할 수 있다
    await type('pst-offline')
    await click('연결')
    expect(container.textContent).toContain('network down')
    expect(button('연결').disabled).toBe(false)

    expect(button('다음').disabled).toBe(true)
    await type('pst-valid')
    await click('연결')
    expect(invoke).toHaveBeenCalledWith('nai:addAccount', { token: 'pst-valid' })
    expect(container.textContent).toContain('연결됨 — 계정 1')
    // 입력란이 사라져도 포커스가 결과로 옮겨 간다
    expect(document.activeElement?.textContent).toContain('연결됨 — 계정 1')
    // 연결하면 '다음'이 열리고 단계 건너뛰기는 사라진다
    expect(button('다음').disabled).toBe(false)
    expect(container.textContent).not.toContain('건너뛰기')
  })

  it('shows the new account from addAccount without listing every balance again', async () => {
    await act(async () => root.render(h(Onboarding)))
    await next(5)
    // 계정 목록은 계정마다 잔액을 물어 느리고, 네트워크가 끊기면 실패한다
    const base = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, request?: Record<string, string>) => {
      if (channel === 'nai:listAccounts') throw new Error('balance unreachable')
      return base(channel, request)
    })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="NovelAI API 토큰"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'pst-valid'
      )
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    })
    await click('연결')

    expect(invoke.mock.calls.filter(([channel]) => channel === 'nai:listAccounts')).toHaveLength(1)
    expect(document.activeElement?.textContent).toContain('연결됨 — 계정 1')
    expect(button('다음').disabled).toBe(false)
  })

  it.each([
    ['keychain', '키체인 잠금을 푼 뒤', false],
    ['corrupt', '데이터가 손상되어', false],
    ['keychain', '키체인 잠금을 푼 뒤', true]
  ])(
    'blocks new tokens and offers to clear them when the saved tokens are unreadable (%s, plaintext %s)',
    async (lockReason, message, plaintextStorage) => {
      let storeLock: string | null = lockReason
      const base = invoke.getMockImplementation()!
      invoke.mockImplementation(async (channel: string, request?: Record<string, string>) => {
        if (channel === 'nai:listAccounts') {
          return {
            accounts,
            activeId: null,
            locked: storeLock !== null,
            lockReason: storeLock,
            plaintextStorage
          }
        }
        if (channel === 'nai:deleteToken') {
          storeLock = null
          return undefined
        }
        return base(channel, request)
      })
      await act(async () => root.render(h(Onboarding)))
      await next(5)

      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label="NovelAI API 토큰"]'
      )!
      expect(input.disabled).toBe(true)
      expect(button('연결').disabled).toBe(true)
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(message)

      await click('잠긴 토큰 삭제')
      const confirm = useDialogStore.getState().confirm
      expect(confirm?.title).toBe('잠긴 토큰 삭제')
      // 키체인 없는 실행이면 지운 뒤 다시 넣는 토큰이 평문으로 저장된다고 먼저 경고한다
      expect(confirm?.message?.includes('암호화되지 않은 채')).toBe(plaintextStorage)
      expect(invoke).not.toHaveBeenCalledWith('nai:deleteToken', undefined)
      await act(async () => useDialogStore.getState()._resolveConfirm(true))

      expect(invoke).toHaveBeenCalledWith('nai:deleteToken', undefined)
      expect(container.textContent).not.toContain('잠긴 토큰 삭제')
      expect(input.disabled).toBe(false)
      expect(container.textContent?.includes('암호화되지 않은 채')).toBe(plaintextStorage)
    }
  )

  it('warns before connecting when tokens would be saved without the OS keychain', async () => {
    const base = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, request?: Record<string, string>) => {
      if (channel === 'nai:listAccounts') {
        return { accounts, activeId: null, locked: false, lockReason: null, plaintextStorage: true }
      }
      return base(channel, request)
    })
    await act(async () => root.render(h(Onboarding)))
    await next(5)

    expect(container.textContent).toContain('암호화되지 않은 채(base64 인코딩만)')
    const input = container.querySelector<HTMLInputElement>('input[aria-label="NovelAI API 토큰"]')!
    expect(input.disabled).toBe(false)
  })

  it('moves focus to the heading of each new step', async () => {
    await act(async () => root.render(h(Onboarding)))
    // 처음 열 때는 포커스를 빼앗지 않는다
    expect(document.activeElement).toBe(document.body)

    await click('시작하기')
    expect(document.activeElement?.tagName).toBe('H2')
    expect(document.activeElement?.textContent).toBe('언어 선택')
    await click('다음')
    expect(document.activeElement?.textContent).toBe('모양 선택')
  })

  it('introduces NAIS3 alone on the first step and picks the language on the next', async () => {
    await act(async () => root.render(h(Onboarding)))
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()

    await click('시작하기')
    const radios = (): HTMLElement[] => [
      ...container.querySelectorAll<HTMLElement>('[role="radio"]')
    ]
    expect(radios().map((r) => r.textContent)).toEqual(['한국어', 'English', '简体中文'])
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1])

    await choose('English')
    expect(useLanguageStore.getState().lang).toBe('en')
    // 고르는 즉시 온보딩 문구도 바뀐다
    expect(container.textContent).toContain('Choose your language')

    radios()[1].focus()
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      )
    })
    expect(useLanguageStore.getState().lang).toBe('zh-CN')
    expect(document.activeElement).toBe(radios()[2])
  })

  it('moves between color modes with the arrow keys', async () => {
    await act(async () => root.render(h(Onboarding)))
    await next(2)
    const radios = (): HTMLElement[] => [
      ...container.querySelectorAll<HTMLElement>('[role="radio"]')
    ]
    const press = async (key: string): Promise<void> =>
      act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      })
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1])

    radios()[1].focus()
    await press('ArrowRight')
    expect(useThemeStore.getState().theme).toBe('system')
    expect(document.activeElement).toBe(radios()[2])
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, 0])

    await press('ArrowDown')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.activeElement).toBe(radios()[0])
    await press('ArrowLeft')
    expect(useThemeStore.getState().theme).toBe('system')
  })

  it('picks a color mode and shows the palette with its key colors', async () => {
    useThemeStore.setState({ presetId: 'catppuccin' })
    await act(async () => root.render(h(Onboarding)))
    await next(2)
    await click('시스템 설정 따름')

    expect(useThemeStore.getState().theme).toBe('system')
    expect(settings.ui_theme).toBe('system')
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      '시스템 설정 따름'
    )
    const preset = container.querySelector('[aria-label="테마 프리셋"]')!
    expect(preset.textContent).toBe('Catppuccin')
    // Catppuccin은 강조색과 오류색이 같아 원은 4개
    expect(preset.querySelectorAll('.rounded-full')).toHaveLength(4)
  })

  it('switches the prompt box to the three-part split', async () => {
    useGenerationStore.setState({ promptSplitEnabled: false })
    await act(async () => root.render(h(Onboarding)))
    await next(3)
    await choose('세 칸')

    expect(useGenerationStore.getState().promptSplitEnabled).toBe(true)
    expect(settings.prompt_split_enabled).toBe('1')
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain(
      '세 칸'
    )
  })

  it('sets the save folder and file options', async () => {
    settings.image_format = 'png'
    await act(async () => root.render(h(Onboarding)))
    await next(4)
    expect(container.textContent).toContain('/Users/me/Pictures/NAIS3')

    await click('변경')
    expect(container.textContent).toContain('/Volumes/Art/NAIS3')

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="자동 저장"]')!.click()
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="날짜별 폴더"]')!.click()
    )
    expect(settings.auto_save).toBe('0')
    expect(settings.date_folders).toBe('0')
    expect(container.querySelector('[aria-label="이미지 포맷"]')?.textContent).toBe('PNG')
  })

  it('leaves out the storage step in the browser', async () => {
    window.nais = { invoke, on: () => () => {}, runtime: 'browser' } as NaisApi
    await act(async () => root.render(h(Onboarding)))
    expect(container.querySelectorAll('ol[aria-label] > li')).toHaveLength(7)

    await next(4)
    expect(container.textContent).toContain('NovelAI 계정 연결')
    expect(container.textContent).not.toContain('이미지 저장')
  })

  it('blocks leaving the onboarding while a backup is being restored', async () => {
    let restore!: (imported: boolean) => void
    vi.mocked(importBackup).mockReturnValue(new Promise((resolve) => (restore = resolve)))
    await act(async () => root.render(h(Onboarding)))
    await next(6)
    await click('데이터 불러오기')

    for (const label of ['뒤로', '온보딩 생략', '건너뛰기', '다음']) {
      expect(button(label).disabled).toBe(true)
    }

    await act(async () => restore(true))
    expect(container.textContent).toContain('데이터를 불러왔습니다.')
    expect(document.activeElement?.textContent).toBe('데이터를 불러왔습니다.')
    for (const label of ['뒤로', '온보딩 생략', '다음']) expect(button(label).disabled).toBe(false)
    // 불러왔으면 '다음'이 열리고, 뒤로 갔다 와도 결과가 남는다
    expect(container.textContent).not.toContain('건너뛰기')
    await click('뒤로')
    await click('건너뛰기')
    expect(container.textContent).toContain('데이터를 불러왔습니다.')
    expect(button('다음').disabled).toBe(false)
  })

  it('opens the next step right away when an account is already connected', async () => {
    accounts = [{ id: 'a', label: '계정 1', active: true }]
    await act(async () => root.render(h(Onboarding)))
    await next(5)
    expect(container.textContent).toContain('연결됨 — 계정 1')
    expect(button('다음').disabled).toBe(false)
    expect(container.textContent).not.toContain('건너뛰기')
  })

  it('can be skipped from the first step', async () => {
    useLayoutStore.setState({ onboardingOpen: true })
    await act(async () => root.render(h(Onboarding)))
    expect(container.textContent).not.toContain('건너뛰기')
    await click('온보딩 생략')

    expect(useLayoutStore.getState().onboardingOpen).toBe(false)
    expect(settings.onboarding_pending).toBe('0')
  })
})

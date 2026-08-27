import { create } from 'zustand'
import { buildWhimsTokens, getThemePreset } from '../lib/theme-presets'

export type Theme = 'dark' | 'light' | 'system'

/** system 모드는 OS 설정(prefers-color-scheme)을 따른다 */
function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// OS 다크모드 전환 실시간 반영 (system 모드일 때만)
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const s = useThemeStore.getState()
    if (s.theme === 'system') applyTheme('system', s.presetId)
  })
}

const SYSTEM_UI = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI'"
const KOREAN_UI = "'Apple SD Gothic Neo', 'Malgun Gothic'"
const SC_UI =
  "'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei UI', 'Microsoft YaHei'"

/** Pretendard는 한글·라틴만 있다. 한자 폴백은 UI 언어에 맞춰 고른다. */
function stacksForLang(lang: string): { ui: string; mono: string } {
  const cjk = lang === 'zh-CN' ? SC_UI : KOREAN_UI
  return {
    ui: `'Pretendard Variable', ${cjk}, ${SYSTEM_UI}, ${KOREAN_UI}, sans-serif`,
    mono: `'JetBrains Mono', Consolas, ui-monospace, 'Pretendard Variable', ${cjk}, ${KOREAN_UI}, monospace`
  }
}

interface ThemeState {
  theme: Theme
  presetId: string
  /** 시스템 폰트 이름 (빈 값 = 기본 Pretendard 스택) */
  uiFont: string
  uiSize: number
  /** 프롬프트 입력 박스 폰트 크기(px) */
  promptSize: number
  setTheme: (theme: Theme) => void
  setPreset: (presetId: string) => void
  setUiFont: (uiFont: string) => void
  setUiSize: (uiSize: number) => void
  setPromptSize: (promptSize: number) => void
  /** SQLite settings에서 초기값 로드 (렌더러 스토리지에 persist하지 않는다) */
  hydrate: () => Promise<void>
}

function applyTheme(theme: Theme, presetId: string): void {
  const effective = resolveTheme(theme)
  const preset = getThemePreset(presetId)
  const palette = preset[effective] ?? preset.dark ?? preset.light
  if (!palette) return
  const tokens = buildWhimsTokens(palette, effective)
  const style = document.documentElement.style
  for (const [key, value] of Object.entries(tokens)) style.setProperty(key, value)
  document.documentElement.dataset.theme = effective
  // 리사이즈 시 노출되는 네이티브 창 배경도 테마 종이색으로
  void window.nais.invoke('window:setBackground', { color: palette.neutral })
}

function applyFont(uiFont: string, uiSize: number): void {
  const { ui, mono } = stacksForLang(document.documentElement.lang || 'ko')
  const style = document.documentElement.style
  style.setProperty('--font-ui', uiFont.trim() ? `'${uiFont.trim()}', ${ui}` : ui)
  style.setProperty('--font-mono', mono)
  style.setProperty('--ui-size', `${uiSize}px`)
  style.setProperty('--ui-scale', `${uiSize / 14}`)
}

/** 언어 변경 후 한자 폴백 스택을 다시 입힌다. */
export function reapplyUiFont(): void {
  const { uiFont, uiSize } = useThemeStore.getState()
  applyFont(uiFont, uiSize)
}

function applyPromptSize(size: number): void {
  document.documentElement.style.setProperty('--prompt-size', `${size}px`)
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'dark',
  presetId: 'nais3',
  uiFont: '',
  uiSize: 15,
  promptSize: 15,
  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme, get().presetId)
    void window.nais.invoke('settings:set', { key: 'ui_theme', value: theme })
  },
  setPreset: (presetId) => {
    set({ presetId })
    applyTheme(get().theme, presetId)
    void window.nais.invoke('settings:set', { key: 'ui_theme_preset', value: presetId })
  },
  setUiFont: (uiFont) => {
    set({ uiFont })
    applyFont(uiFont, get().uiSize)
    void window.nais.invoke('settings:set', { key: 'ui_font', value: uiFont })
  },
  setUiSize: (uiSize) => {
    const clamped = Math.max(11, Math.min(18, uiSize))
    set({ uiSize: clamped })
    applyFont(get().uiFont, clamped)
    void window.nais.invoke('settings:set', { key: 'ui_size', value: String(clamped) })
  },
  setPromptSize: (promptSize) => {
    const clamped = Math.max(12, Math.min(22, promptSize))
    set({ promptSize: clamped })
    applyPromptSize(clamped)
    void window.nais.invoke('settings:set', { key: 'prompt_size', value: String(clamped) })
  },
  hydrate: async () => {
    const [
      { value: theme },
      { value: preset },
      { value: font },
      { value: size },
      { value: psize }
    ] = await Promise.all([
      window.nais.invoke('settings:get', { key: 'ui_theme' }),
      window.nais.invoke('settings:get', { key: 'ui_theme_preset' }),
      window.nais.invoke('settings:get', { key: 'ui_font' }),
      window.nais.invoke('settings:get', { key: 'ui_size' }),
      window.nais.invoke('settings:get', { key: 'prompt_size' })
    ])
    const resolved: Theme = theme === 'light' || theme === 'system' ? theme : 'dark'
    const presetId = preset ?? 'nais3'
    const uiFont = font ?? ''
    const uiSize = size ? Number(size) : 15
    const promptSize = psize ? Number(psize) : 15
    set({ theme: resolved, presetId, uiFont, uiSize, promptSize })
    applyTheme(resolved, presetId)
    applyFont(uiFont, uiSize)
    applyPromptSize(promptSize)
  }
}))

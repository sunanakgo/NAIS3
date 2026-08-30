import { create } from 'zustand'
import { t } from '../lib/i18n'

/**
 * 텍스트 입력 다이얼로그 (Electron은 window.prompt를 지원하지 않음).
 * askText(...)가 Promise를 반환하고, <TextPromptHost/>가 실제 UI를 렌더한다.
 */
interface TextPromptReq {
  title: string
  value: string
  placeholder?: string
  resolve: (value: string | null) => void
}

interface ConfirmReq {
  title: string
  message?: string
  confirmLabel: string
  danger: boolean
  resolve: (ok: boolean) => void
}

interface DialogState {
  textPrompt: TextPromptReq | null
  confirm: ConfirmReq | null
  askText: (title: string, defaultValue?: string, placeholder?: string) => Promise<string | null>
  askConfirm: (
    title: string,
    opts?: { message?: string; confirmLabel?: string; danger?: boolean }
  ) => Promise<boolean>
  _resolve: (value: string | null) => void
  _resolveConfirm: (ok: boolean) => void
}

export const useDialogStore = create<DialogState>((set, get) => ({
  textPrompt: null,
  confirm: null,
  askText: (title, defaultValue = '', placeholder) =>
    new Promise((resolve) => {
      set({ textPrompt: { title, value: defaultValue, placeholder, resolve } })
    }),
  askConfirm: (title, opts) =>
    new Promise((resolve) => {
      set({
        confirm: {
          title,
          message: opts?.message,
          confirmLabel: opts?.confirmLabel ?? t('ui.ok'),
          danger: opts?.danger ?? false,
          resolve
        }
      })
    }),
  _resolve: (value) => {
    get().textPrompt?.resolve(value)
    set({ textPrompt: null })
  },
  _resolveConfirm: (ok) => {
    get().confirm?.resolve(ok)
    set({ confirm: null })
  }
}))

/** 어디서든 호출 가능한 텍스트 프롬프트 헬퍼 */
export function askText(
  title: string,
  defaultValue?: string,
  placeholder?: string
): Promise<string | null> {
  return useDialogStore.getState().askText(title, defaultValue, placeholder)
}

/** 어디서든 호출 가능한 확인(예/아니오) 헬퍼 — 네이티브 confirm 대체 */
export function askConfirm(
  title: string,
  opts?: { message?: string; confirmLabel?: string; danger?: boolean }
): Promise<boolean> {
  return useDialogStore.getState().askConfirm(title, opts)
}

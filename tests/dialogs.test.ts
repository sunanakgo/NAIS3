import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { showOpenDialogMock, showSaveDialogMock } = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: showOpenDialogMock, showSaveDialog: showSaveDialogMock }
}))

const win = {} as BrowserWindow
const root = join('/', 'work', 'images')

async function loadDialogs(): Promise<typeof import('../src/main/dialogs')> {
  vi.resetModules()
  return import('../src/main/dialogs')
}

describe('파일 대화상자 기본 경로', () => {
  beforeEach(() => {
    showOpenDialogMock.mockReset()
    showSaveDialogMock.mockReset()
  })

  it('처음에는 호출자가 준 기본 경로를 그대로 쓴다', async () => {
    const { showSaveDialog } = await loadDialogs()
    showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: '' })
    await showSaveDialog(win, { defaultPath: 'a.png' })
    expect(showSaveDialogMock).toHaveBeenCalledWith(win, { defaultPath: 'a.png' })
  })

  it('고른 파일의 폴더를 다음 대화상자의 시작 폴더로 쓴다', async () => {
    const { showOpenDialog, showSaveDialog } = await loadDialogs()
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [join(root, 'x.png')] })
    await showOpenDialog(win, { properties: ['openFile'] })

    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] })
    await showOpenDialog(win, { properties: ['openFile'] })
    expect(showOpenDialogMock).toHaveBeenLastCalledWith(win, {
      properties: ['openFile'],
      defaultPath: root
    })

    showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: '' })
    await showSaveDialog(win, { defaultPath: 'backup.nais' })
    expect(showSaveDialogMock).toHaveBeenLastCalledWith(win, {
      defaultPath: join(root, 'backup.nais')
    })
  })

  it('폴더 선택은 고른 폴더 자체를 기억하고, 절대 경로와 취소는 건드리지 않는다', async () => {
    const { showOpenDialog, dialogDefaultPath } = await loadDialogs()
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [root] })
    await showOpenDialog(win, { properties: ['openDirectory'] })
    expect(dialogDefaultPath()).toBe(root)

    const absolute = join('/', 'elsewhere', 'file.png')
    expect(dialogDefaultPath(absolute)).toBe(absolute)

    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [join('/', 'ignored')] })
    await showOpenDialog(win, { properties: ['openDirectory'] })
    expect(dialogDefaultPath()).toBe(root)
  })
})

import { dialog } from 'electron'
import type {
  BrowserWindow,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue
} from 'electron'
import { dirname, isAbsolute, join } from 'node:path'

// Since Electron 41, file dialogs open in Downloads unless defaultPath is set, and the OS no
// longer restores the last folder between dialogs. Remember it for the session instead.
let lastDirectory: string | undefined

export function dialogDefaultPath(defaultPath?: string): string | undefined {
  if (!lastDirectory) return defaultPath
  if (!defaultPath) return lastDirectory
  return isAbsolute(defaultPath) ? defaultPath : join(lastDirectory, defaultPath)
}

export function rememberDialogPath(path: string, isDirectory: boolean): void {
  lastDirectory = isDirectory ? path : dirname(path)
}

export async function showOpenDialog(
  win: BrowserWindow,
  options: OpenDialogOptions
): Promise<OpenDialogReturnValue> {
  const result = await dialog.showOpenDialog(win, {
    ...options,
    defaultPath: dialogDefaultPath(options.defaultPath)
  })
  const [first] = result.filePaths
  if (!result.canceled && first) {
    rememberDialogPath(first, options.properties?.includes('openDirectory') ?? false)
  }
  return result
}

export async function showSaveDialog(
  win: BrowserWindow,
  options: SaveDialogOptions
): Promise<SaveDialogReturnValue> {
  const result = await dialog.showSaveDialog(win, {
    ...options,
    defaultPath: dialogDefaultPath(options.defaultPath)
  })
  if (!result.canceled && result.filePath) rememberDialogPath(result.filePath, false)
  return result
}

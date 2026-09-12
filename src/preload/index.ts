import { contextBridge, ipcRenderer } from 'electron'
import type { IpcEventMap, IpcInvokeMap } from '../shared/types'

/**
 * 렌더러에 노출되는 유일한 표면. IpcInvokeMap/IpcEventMap 계약만 통과시킨다.
 * 규칙: 렌더러는 Node API도, 원시 ipcRenderer도 만질 수 없다.
 */
const api = {
  invoke<C extends keyof IpcInvokeMap>(
    channel: C,
    req: IpcInvokeMap[C]['req']
  ): Promise<IpcInvokeMap[C]['res']> {
    return ipcRenderer.invoke(channel, req)
  },
  on<C extends keyof IpcEventMap>(
    channel: C,
    listener: (payload: IpcEventMap[C]) => void
  ): () => void {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: IpcEventMap[C]): void =>
      listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

export type NaisApi = typeof api & { runtime?: 'browser' }

contextBridge.exposeInMainWorld('nais', api)

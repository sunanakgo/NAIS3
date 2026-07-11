import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  shell
} from 'electron'
import type { IpcEventMap, IpcInvokeMap } from '../shared/types'
import {
  createCharacter,
  createFolder,
  deleteCharacter,
  duplicateCharacter,
  deleteFolder,
  listCharacters,
  pickCharacterThumbnail,
  clearCharacterThumbnail,
  renameFolder,
  reorderCharacters,
  setFolderCollapsed,
  setFolderColor,
  updateCharacter
} from './characters/repo'
import { getDbPath, getDb } from './db'
import { metadataFromPng, metadataFromPayloadJson } from './images/metadata'
import {
  createFragment,
  createFragmentFolder,
  deleteFragment,
  duplicateFragment,
  deleteFragmentFolder,
  exportTxtFragment,
  exportAllFragmentsZip,
  fragmentSource,
  importTxtFragments,
  listFragments,
  renameFragmentFolder,
  reorderFragments,
  setFragmentFolderCollapsed,
  setFragmentFolderColor,
  updateFragment
} from './fragments/repo'
import { processWildcards, resetSequentialCounters } from './fragments/processor'
import { removeComments } from '../shared/nai-presets'
import {
  deleteNaiToken,
  getNaiToken,
  getNaiTokenInfo,
  getSetting,
  setNaiToken,
  setSetting
} from './db/settings'
import { anlasUsage, logBalance } from './nai/anlas-log'
import { fetchAnlasBalance } from './nai/client'
import { listImages, getImagePayload, saveGeneratedImage } from './images/storage'
import { augmentImage, upscaleImage } from './nai/client'
import {
  listPresets,
  createPreset,
  renamePreset,
  deletePreset,
  reorderPresets,
  setPresetCharacters,
  setPresetDefaultResolution,
  listScenes,
  createScene,
  getScene,
  getPresetName,
  updateScene,
  duplicateScene,
  deleteScene,
  reorderScenes,
  setReserveAll,
  adjustReserveAll,
  bulkMove,
  bulkDelete,
  bulkSetResolution,
  bulkClearFavorites,
  bulkClearImages,
  bulkExportZip,
  sceneImages,
  deleteNonFavorites,
  setImageFavorite,
  deleteImage,
  clearAllImages,
  exportScenesJson,
  importScenesJson,
  exportZip
} from './scenes/repo'
import {
  listPromptPresets,
  createPromptPreset,
  updatePromptPreset,
  deletePromptPreset,
  reorderPromptPresets
} from './prompts/repo'
import {
  createStack,
  deleteImages as deleteLibraryImages,
  deleteStack,
  importBase64 as importLibraryBase64,
  importPaths as importLibraryPaths,
  importViaDialog,
  listLibrary,
  renameStack,
  reorderImages as reorderLibraryImages,
  setStack
} from './library/repo'
import { exportAll, importAll } from './backup/repo'
import { importNais2 } from './backup/nais2'
import { startUpdateDownload } from './updater'
import { countTokens } from './nai/tokenizer'
import {
  addRefImages,
  collapseRefFolder,
  colorRefFolder,
  createRefFolder,
  deleteRefFolder,
  deleteRefImage,
  duplicateRefImage,
  listCharRefs,
  listVibes,
  renameRefFolder,
  reorderRefs,
  updateRefImage
} from './refs/repo'
import { searchTags } from './tags'
import {
  getMemoryImage,
  imagesRoot,
  isMemoryPath,
  isUnderImagesRoot,
  sceneDir,
  scenesRoot
} from './images/storage'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'
import sharp from 'sharp'
import { verifyToken } from './nai/client'
import type { GenerationQueue } from './queue/generation-queue'

/** IpcInvokeMap 계약을 강제하는 handle 등록 헬퍼 */
function handle<C extends keyof IpcInvokeMap>(
  channel: C,
  handler: (req: IpcInvokeMap[C]['req']) => Promise<IpcInvokeMap[C]['res']> | IpcInvokeMap[C]['res']
): void {
  ipcMain.handle(channel, (_event, req) => handler(req))
}

export function broadcast<C extends keyof IpcEventMap>(channel: C, payload: IpcEventMap[C]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerIpcHandlers(ctx: { dbVersion: number; queue: GenerationQueue }): void {
  handle('db:status', () => ({ version: ctx.dbVersion, path: getDbPath() }))
  handle('app:version', () => ({ version: app.getVersion() }))

  handle('nai:verifyToken', ({ token }) => verifyToken(token))

  // 검증 성공 시에만 저장 — 잘못된 토큰이 조용히 저장되는 것 방지
  handle('nai:setToken', async ({ token }) => {
    const result = await verifyToken(token)
    if (result.valid) setNaiToken(token)
    return result
  })

  handle('nai:tokenStatus', () => getNaiTokenInfo())
  handle('nai:revealToken', () => ({ token: getNaiToken() }))
  handle('nai:deleteToken', () => {
    deleteNaiToken()
  })
  handle('nai:balance', async () => {
    const token = getNaiToken()
    if (!token) return { anlas: null, tier: null }
    const { anlas, tier } = await fetchAnlasBalance(token)
    if (anlas !== null) logBalance(anlas)
    return { anlas, tier }
  })
  handle('nai:anlasUsage', () => anlasUsage())

  handle('queue:enqueue', ({ request, count }) => ({ ids: ctx.queue.enqueue(request, count) }))
  handle('queue:cancel', ({ ids }) => {
    ctx.queue.cancel(ids)
  })
  handle('queue:status', () => ctx.queue.status())

  handle('images:list', ({ limit, offset }) => listImages(limit, offset))
  handle('images:payload', ({ id }) => ({ payloadJson: getImagePayload(id) }))

  handle('scenePresets:list', () => ({ items: listPresets() }))
  handle('scenePresets:create', ({ name }) => ({ id: createPreset(name) }))
  handle('scenePresets:rename', ({ id, name }) => {
    renamePreset(id, name)
  })
  handle('scenePresets:delete', ({ id }) => {
    deletePreset(id)
  })
  handle('scenePresets:reorder', ({ ids }) => {
    reorderPresets(ids)
  })
  handle('scenePresets:setCharacters', ({ id, characterIds }) => {
    setPresetCharacters(id, characterIds)
  })
  handle('scenePresets:setDefaultResolution', ({ id, width, height }) => {
    setPresetDefaultResolution(id, width, height)
  })
  handle('scenes:openFolder', ({ sceneId }) => {
    const scene = getScene(sceneId)
    if (!scene) return { ok: false }
    const dir = sceneDir(getPresetName(scene.presetId), scene.name, scene.id)
    if (!existsSync(dir)) return { ok: false }
    void shell.openPath(dir)
    return { ok: true }
  })
  handle('chars:duplicate', ({ id }) => ({ id: duplicateCharacter(id) }))
  handle('frags:duplicate', ({ id }) => ({ id: duplicateFragment(id) }))

  handle('promptPresets:list', () => ({ items: listPromptPresets() }))
  handle('promptPresets:create', ({ name, prompt, negativePrompt, params }) => ({
    id: createPromptPreset(name, prompt, negativePrompt, params)
  }))
  handle('promptPresets:update', ({ id, patch }) => {
    updatePromptPreset(id, patch)
  })
  handle('promptPresets:delete', ({ id }) => {
    deletePromptPreset(id)
  })
  handle('promptPresets:reorder', ({ ids }) => {
    reorderPromptPresets(ids)
  })

  handle('update:start', () => {
    startUpdateDownload()
  })

  handle('backup:export', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const stamp = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(win, {
      title: '데이터 내보내기',
      defaultPath: `NAIS3-backup-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    writeFileSync(result.filePath, JSON.stringify(exportAll()))
    return { saved: true }
  })

  handle('backup:import', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: '데이터 가져오기 (NAIS3 / NAIS2 백업)',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true as const }
    try {
      const data = JSON.parse(readFileSync(result.filePaths[0], 'utf-8')) as Record<string, unknown>
      // 포맷 감지: NAIS3는 _app='NAIS3', NAIS2는 nais2-* 키
      if (data._app === 'NAIS3') {
        const { imported } = importAll(data)
        return { summary: `NAIS3 백업 복원 완료 (${imported}개 항목)`, needsPromptReload: true }
      }
      if (Object.keys(data).some((k) => k.startsWith('nais2-'))) {
        const r = importNais2(data)
        const parts = [
          r.characters ? `캐릭터 ${r.characters}` : '',
          r.presets ? `프리셋 ${r.presets}` : '',
          r.fragments ? `조각 ${r.fragments}` : '',
          r.scenes ? `씬 ${r.scenes}` : '',
          r.prompt ? '프롬프트' : ''
        ].filter(Boolean)
        return {
          summary: parts.length
            ? `NAIS2에서 ${parts.join(' · ')} 가져옴`
            : '가져올 항목이 없습니다',
          needsPromptReload: r.prompt
        }
      }
      return { error: '알 수 없는 백업 형식입니다' }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })
  handle('scenes:list', ({ presetId }) => ({ items: listScenes(presetId) }))
  handle('scenes:create', ({ presetId, name }) => ({ id: createScene(presetId, name) }))
  handle('scenes:get', ({ id }) => ({ scene: getScene(id) }))
  handle('scenes:update', ({ id, patch }) => {
    updateScene(id, patch)
  })
  handle('scenes:duplicate', ({ id }) => ({ id: duplicateScene(id) }))
  handle('scenes:delete', ({ id }) => {
    deleteScene(id)
  })
  handle('scenes:reorder', ({ ids }) => {
    reorderScenes(ids)
  })
  handle('scenes:setReserveAll', ({ presetId, count }) => {
    setReserveAll(presetId, count)
  })
  handle('scenes:adjustReserveAll', ({ presetId, delta }) => {
    adjustReserveAll(presetId, delta)
  })
  handle('scenes:bulkMove', ({ ids, presetId }) => {
    bulkMove(ids, presetId)
  })
  handle('scenes:bulkDelete', ({ ids }) => {
    bulkDelete(ids)
  })
  handle('scenes:bulkSetResolution', ({ ids, width, height }) => {
    bulkSetResolution(ids, width, height)
  })
  handle('scenes:bulkClearFavorites', ({ ids }) => {
    bulkClearFavorites(ids)
  })
  handle('scenes:bulkClearImages', ({ ids }) => ({ deleted: bulkClearImages(ids) }))
  handle('scenes:bulkExportZip', async ({ ids }) => ({ count: await bulkExportZip(ids) }))
  handle('scenes:images', ({ sceneId, limit, offset, favoritesOnly }) =>
    sceneImages(sceneId, limit, offset, favoritesOnly)
  )
  handle('scenes:deleteNonFavorites', ({ sceneId }) => ({
    deleted: deleteNonFavorites(sceneId)
  }))
  handle('images:setFavorite', ({ id, favorite }) => {
    setImageFavorite(id, favorite)
  })
  handle('images:delete', ({ id, deleteFile }) => {
    // deleteFile 미지정(히스토리 삭제) — "히스토리 삭제 시 파일도 삭제" 설정을 따른다
    deleteImage(id, deleteFile ?? getSetting('history_delete_file') === '1')
  })
  handle('images:clearAll', () => ({ count: clearAllImages() }))

  // 라이브러리 — 큐레이션 컬렉션
  handle('library:list', ({ stackId, limit, offset }) => listLibrary(stackId, limit, offset))
  handle('library:import', async ({ stackId }) => ({
    count: await importViaDialog(stackId ?? null)
  }))
  handle('library:importPaths', async ({ filePaths, stackId }) => ({
    count: await importLibraryPaths(filePaths, stackId ?? null)
  }))
  handle('library:importImages', async ({ images, stackId }) => ({
    count: await importLibraryBase64(images, stackId ?? null)
  }))
  handle('library:delete', ({ ids }) => {
    deleteLibraryImages(ids)
  })
  handle('library:reorder', ({ ids }) => {
    reorderLibraryImages(ids)
  })
  handle('library:stackCreate', ({ name, imageIds }) => ({ id: createStack(name, imageIds) }))
  handle('library:stackRename', ({ id, name }) => {
    renameStack(id, name)
  })
  handle('library:stackDelete', ({ id }) => {
    deleteStack(id)
  })
  handle('library:stackSet', ({ imageIds, stackId }) => {
    setStack(imageIds, stackId)
  })

  handle('scenes:exportJson', async ({ presetId }) => ({ saved: await exportScenesJson(presetId) }))
  handle('scenes:importJson', async ({ presetId }) => ({ count: await importScenesJson(presetId) }))
  handle('scenes:exportZip', async ({ presetId }) => ({ count: await exportZip(presetId) }))

  handle('settings:get', ({ key }) => ({ value: getSetting(key) }))
  handle('settings:set', ({ key, value }) => {
    setSetting(key, value)
  })

  handle('chars:list', () => listCharacters())
  handle('chars:create', ({ name, folderId }) => ({ id: createCharacter(name, folderId) }))
  handle('chars:update', ({ id, patch }) => {
    updateCharacter(id, patch)
  })
  handle('chars:delete', ({ id }) => {
    deleteCharacter(id)
  })
  handle('chars:pickThumbnail', async ({ id }) => ({
    thumbnail: await pickCharacterThumbnail(id)
  }))
  handle('chars:clearThumbnail', ({ id }) => {
    clearCharacterThumbnail(id)
  })
  handle('chars:reorder', ({ order }) => {
    reorderCharacters(order)
  })
  handle('chars:folderCreate', ({ name }) => ({ id: createFolder(name) }))
  handle('chars:folderRename', ({ id, name }) => {
    renameFolder(id, name)
  })
  handle('chars:folderCollapse', ({ id, collapsed }) => {
    setFolderCollapsed(id, collapsed)
  })
  handle('chars:folderColor', ({ id, color }) => {
    setFolderColor(id, color)
  })
  handle('chars:folderDelete', ({ id }) => {
    deleteFolder(id)
  })

  handle('frags:list', () => listFragments())
  handle('frags:create', ({ name, folderId }) => ({ id: createFragment(name, folderId) }))
  handle('frags:update', ({ id, patch }) => {
    updateFragment(id, patch)
  })
  handle('frags:delete', ({ id }) => {
    deleteFragment(id)
  })
  handle('frags:importTxt', async () => ({ count: await importTxtFragments() }))
  handle('frags:exportTxt', async ({ id }) => ({ saved: await exportTxtFragment(id) }))
  handle('frags:exportAll', async () => ({ count: await exportAllFragmentsZip() }))
  handle('frags:resetSequential', () => {
    resetSequentialCounters()
  })
  handle('frags:reorder', ({ order }) => {
    reorderFragments(order)
  })
  handle('frags:folderCreate', ({ name }) => ({ id: createFragmentFolder(name) }))
  handle('frags:folderRename', ({ id, name }) => {
    renameFragmentFolder(id, name)
  })
  handle('frags:folderCollapse', ({ id, collapsed }) => {
    setFragmentFolderCollapsed(id, collapsed)
  })
  handle('frags:folderColor', ({ id, color }) => {
    setFragmentFolderColor(id, color)
  })
  handle('frags:folderDelete', ({ id }) => {
    deleteFragmentFolder(id)
  })

  handle('tags:search', ({ query, limit }) => ({ items: searchTags(query, limit) }))
  handle('tokens:count', ({ texts }) => {
    // 토큰 수는 실제 전송본 기준 — 조각(<이름>)·주석을 치환/제거한 결과로 센다.
    // rng 고정(항상 첫 줄)이라 결정적이고, peek이라 <*이름> 순차 카운터를 소모하지 않는다.
    const src = fragmentSource()
    return {
      counts: texts.map((t) => countTokens(processWildcards(removeComments(t), src, () => 0, true)))
    }
  })

  handle('images:showInFolder', ({ filePath }) => {
    if (isUnderImagesRoot(filePath)) shell.showItemInFolder(filePath)
  })

  handle('images:saveAs', async ({ filePath }) => {
    const memory = isMemoryPath(filePath)
    if (!memory && !isUnderImagesRoot(filePath)) return { saved: false }
    const memBuf = memory ? getMemoryImage(filePath) : null
    if (memory && !memBuf) return { saved: false } // 원본 만료 (자동저장 꺼짐 생성분)
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win, {
      title: '다른 이름으로 저장',
      defaultPath: memory ? `NAIS3_${Date.now()}.png` : basename(filePath),
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    if (memBuf) writeFileSync(result.filePath, memBuf)
    else copyFileSync(filePath, result.filePath)
    return { saved: true }
  })

  handle('images:copy', ({ filePath }) => {
    if (isMemoryPath(filePath)) {
      const buf = getMemoryImage(filePath)
      if (!buf) return { copied: false }
      clipboard.writeImage(nativeImage.createFromBuffer(buf))
      return { copied: true }
    }
    if (!isUnderImagesRoot(filePath)) return { copied: false }
    const img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) return { copied: false }
    clipboard.writeImage(img)
    return { copied: true }
  })

  const saveDirKey = (target?: 'main' | 'scene'): string =>
    target === 'scene' ? 'scene_save_dir' : 'save_dir'
  const saveDirOf = (target?: 'main' | 'scene'): string =>
    target === 'scene' ? scenesRoot() : imagesRoot()

  handle('settings:getSaveDir', (req) => {
    const target = req?.target
    return {
      dir: saveDirOf(target),
      isDefault: !getSetting(saveDirKey(target))?.trim()
    }
  })
  handle('settings:pickSaveDir', async (req) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: req?.target === 'scene' ? '씬 저장 폴더 선택' : '저장 폴더 선택',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { dir: null }
    setSetting(saveDirKey(req?.target), result.filePaths[0])
    return { dir: result.filePaths[0] }
  })
  handle('settings:resetSaveDir', (req) => {
    setSetting(saveDirKey(req?.target), '')
    return { dir: saveDirOf(req?.target) }
  })
  handle('gen:setDelay', ({ ms }) => {
    ctx.queue.setDelayMs(ms)
    setSetting('gen_delay_ms', String(ms))
  })

  handle('notify:done', ({ done, failed }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isFocused()) return // 보고 있는 중엔 토스트 불필요
    if (!Notification.isSupported()) return
    const body = failed > 0 ? `${done}장 완료 · ${failed}장 실패` : `${done}장 완료`
    // silent — 소리는 앱의 알림음 설정이 따로 담당 (이중 재생 방지)
    const n = new Notification({ title: 'NAIS3 생성 완료', body, silent: true })
    n.on('click', () => {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    n.show()
  })

  handle('images:readMetadata', async ({ filePath, base64 }) => {
    try {
      if (base64) {
        const buf = Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64')
        const meta = await metadataFromPng(buf)
        return meta ? { meta } : { error: '이 이미지에서 NAI 메타데이터를 찾지 못했습니다' }
      }
      if (filePath) {
        if (!isMemoryPath(filePath) && !isUnderImagesRoot(filePath))
          return { error: '허용되지 않은 경로' }
        const row = getDb()
          .prepare('SELECT payload_json FROM images WHERE file_path = ?')
          .get(filePath) as { payload_json: string } | undefined
        const fromDb = row?.payload_json ? metadataFromPayloadJson(row.payload_json) : null
        // 1) PNG tEXt 우선. 단, 예전 저장본/포맷 변환본처럼 nais3-params 청크가 빠진 경우
        // DB payload_json의 NAIS3 로컬 메타데이터(promptParts)를 합쳐서 3분할을 복원한다.
        // 자동저장 꺼짐 생성분(memory://)은 메모리 원본에서 읽고, 만료됐으면 DB payload로 폴백.
        const buf = isMemoryPath(filePath) ? getMemoryImage(filePath) : readFileSync(filePath)
        if (!buf) {
          if (fromDb) return { meta: fromDb }
          return { error: '원본이 만료되었습니다 (자동저장 꺼짐 상태로 생성된 이미지)' }
        }
        const fromPng = await metadataFromPng(buf)
        if (fromPng) {
          return {
            meta:
              !fromPng.promptParts && fromDb?.promptParts
                ? { ...fromPng, promptParts: fromDb.promptParts }
                : fromPng
          }
        }
        // 2) 폴백: DB payload_json (우리 스트리밍 이미지는 tEXt가 없을 수 있음)
        if (fromDb) return { meta: fromDb }
        return { error: '메타데이터를 찾지 못했습니다' }
      }
      return { error: '입력이 없습니다' }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  handle('images:upscale', async ({ imageBase64, scale }) => {
    const token = getNaiToken()
    if (!token) return { error: 'NAI 토큰이 설정되지 않았습니다' }
    try {
      const input = Buffer.from(imageBase64.replace(/^data:[^,]+,/, ''), 'base64')
      const meta = await sharp(input).metadata()
      const png = await upscaleImage(token, {
        imageBase64: input.toString('base64'),
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        scale
      })
      const saved = await saveGeneratedImage({
        png,
        sentPayload: JSON.stringify({ upscale: scale }),
        seed: 0,
        kind: 'upscale'
      })
      void fetchAnlasBalance(token).then(({ anlas }) => {
        if (anlas !== null) {
          logBalance(anlas)
          broadcast('anlas:balance', { anlas })
        }
      })
      return { filePath: saved.filePath, base64: png.toString('base64') }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  handle('images:saveLocal', async ({ base64, kind }) => {
    try {
      const png = Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64')
      const saved = await saveGeneratedImage({
        png,
        sentPayload: JSON.stringify({ local: kind }),
        seed: 0,
        kind
      })
      return { filePath: saved.filePath }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  handle('director:run', async ({ method, imageBase64, prompt, defry }) => {
    const token = getNaiToken()
    if (!token) return { error: 'NAI 토큰이 설정되지 않았습니다' }
    try {
      const input = Buffer.from(imageBase64.replace(/^data:[^,]+,/, ''), 'base64')
      const meta = await sharp(input).metadata()
      const png = await augmentImage(token, {
        method,
        imageBase64: input.toString('base64'),
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        prompt,
        defry
      })
      const saved = await saveGeneratedImage({
        png,
        sentPayload: JSON.stringify({ director: method, prompt, defry }),
        seed: 0,
        kind: method // 툴별 kind (bg-removal 등) → 히스토리 뱃지 구분
      })
      // 잔액 갱신 (디렉터 툴도 Anlas 소모, Opus는 소형 무료)
      void fetchAnlasBalance(token).then(({ anlas }) => {
        if (anlas !== null) {
          logBalance(anlas)
          broadcast('anlas:balance', { anlas })
        }
      })
      return { filePath: saved.filePath, base64: png.toString('base64') }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  handle('images:readForSource', async ({ filePath }) => {
    if (!isMemoryPath(filePath) && !isUnderImagesRoot(filePath))
      return { error: '허용되지 않은 경로' }
    try {
      const buf = isMemoryPath(filePath) ? getMemoryImage(filePath) : readFileSync(filePath)
      if (!buf) return { error: '원본이 만료되었습니다 (자동저장 꺼짐 상태로 생성된 이미지)' }
      const meta = await sharp(buf).metadata()
      return { base64: buf.toString('base64'), width: meta.width ?? 0, height: meta.height ?? 0 }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 바이브 / 캐릭터 레퍼런스 라이브러리 (공용 저장소, kind로 분기)
  handle('vibes:list', () => listVibes())
  handle('vibes:add', async ({ folderId }) => ({ count: await addRefImages('vibe', folderId) }))
  handle('vibes:update', ({ id, patch }) => {
    updateRefImage('vibe', id, patch)
  })
  handle('vibes:delete', ({ id }) => {
    deleteRefImage('vibe', id)
  })
  handle('vibes:duplicate', ({ id }) => ({ id: duplicateRefImage('vibe', id) }))
  handle('vibes:reorder', ({ order }) => {
    reorderRefs('vibe', order)
  })
  handle('vibes:folderCreate', ({ name }) => ({ id: createRefFolder('vibe', name) }))
  handle('vibes:folderRename', ({ id, name }) => {
    renameRefFolder('vibe', id, name)
  })
  handle('vibes:folderCollapse', ({ id, collapsed }) => {
    collapseRefFolder('vibe', id, collapsed)
  })
  handle('vibes:folderColor', ({ id, color }) => {
    colorRefFolder('vibe', id, color)
  })
  handle('vibes:folderDelete', ({ id }) => {
    deleteRefFolder('vibe', id)
  })

  handle('crefs:list', () => listCharRefs())
  handle('crefs:add', async ({ folderId }) => ({ count: await addRefImages('charref', folderId) }))
  handle('crefs:update', ({ id, patch }) => {
    updateRefImage('charref', id, patch)
  })
  handle('crefs:delete', ({ id }) => {
    deleteRefImage('charref', id)
  })
  handle('crefs:duplicate', ({ id }) => ({ id: duplicateRefImage('charref', id) }))
  handle('crefs:reorder', ({ order }) => {
    reorderRefs('charref', order)
  })
  handle('crefs:folderCreate', ({ name }) => ({ id: createRefFolder('charref', name) }))
  handle('crefs:folderRename', ({ id, name }) => {
    renameRefFolder('charref', id, name)
  })
  handle('crefs:folderCollapse', ({ id, collapsed }) => {
    collapseRefFolder('charref', id, collapsed)
  })
  handle('crefs:folderColor', ({ id, color }) => {
    colorRefFolder('charref', id, color)
  })
  handle('crefs:folderDelete', ({ id }) => {
    deleteRefFolder('charref', id)
  })

  handle('window:control', ({ action }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
    else win.close()
  })

  handle('window:setBackground', ({ color }) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(color)
  })

  ctx.queue.on('changed', (status) => broadcast('queue:changed', status))
}

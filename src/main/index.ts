import { app, shell, BrowserWindow, dialog, net, protocol } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import sharp from 'sharp'
import icon from '../../resources/icon.png?asset'
import { closeDb, initDb } from './db'
import { getNaiToken } from './db/settings'
import { getSetting } from './db/settings'
import { processWildcards } from './fragments/processor'
import { removeComments } from '../shared/nai-presets'
import { fragmentSource } from './fragments/repo'
import { isUnderImagesRoot, saveGeneratedImage } from './images/storage'
import { broadcast, registerIpcHandlers } from './ipc'
import { setupUpdater } from './updater'
import { logBalance } from './nai/anlas-log'
import { fetchAnlasBalance, generateImageStream, generateImageZip } from './nai/client'
import { prepareCharRefs, prepareVibes } from './refs/prepare'
import { GenerationQueue } from './queue/generation-queue'
import { getPresetName, getScene } from './scenes/repo'

// 앱 이름 (dev 메뉴바·dock에서 'Electron' 대신 표시). 패키징 앱은 productName 사용
app.setName('NAIS3')

// 중복 실행 방지 (특히 Windows) — 두 번째 실행은 기존 창을 앞으로
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// 생성 이미지 폴더만 렌더러에 노출하는 전용 프로토콜 (CSP/webSecurity 우회 없이 로컬 파일 표시)
protocol.registerSchemesAsPrivileged([
  { scheme: 'nais-image', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1080,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    // 리사이즈 시 노출되는 네이티브 배경 — 기본 다크. 테마 전환 시 렌더러가 갱신
    backgroundColor: '#0f0f10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    // 신호등을 큰 타이틀바(h-14=56px) 중앙에 세로 정렬
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 21 } } : {}),
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 웹 검색(인앱 브라우저) — <webview> 태그 사용
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // <webview> 보안: 외부 사이트에 preload/node 접근 차단 + 팝업은 기본 브라우저로
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
  })
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => {
      // 같은 뷰에서 열 수 있는 링크는 그대로, window.open류는 현재 뷰에서 로드
      if (url.startsWith('http')) void webContents.loadURL(url)
      return { action: 'deny' }
    })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sunanakgo.nais3')

  protocol.handle('nais-image', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.searchParams.get('path') ?? '')
    if (!isUnderImagesRoot(filePath)) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })

  let dbVersion: number
  try {
    dbVersion = initDb().version
  } catch (e) {
    // DB를 못 열면 조용히 빈 상태로 시작하지 않는다 — 세이브 유실로 오인되는 최악의 UX
    dialog.showErrorBox('NAIS3 데이터베이스 오류', e instanceof Error ? e.message : String(e))
    app.quit()
    return
  }

  // 생성 파이프라인: 큐 → 조각/와일드카드 치환 → 바이브/캐릭레퍼 준비 → 스트리밍 생성 → 저장
  const queue = new GenerationQueue(async (rawRequest, id, signal) => {
    const token = getNaiToken()
    if (!token) throw new Error('NAI 토큰이 설정되지 않았습니다')

    // 배치 항목마다 여기서 치환 — 매 장 다른 와일드카드 결과가 나온다.
    // 주석 제거가 반드시 먼저 — 주석 줄이 조각을 소모하거나(순차 카운터),
    // 와일드카드 처리의 재조립이 개행을 지워 주석 범위가 전체로 번지는 것 방지 (NAIS2와 동일 순서)
    const fragSource = fragmentSource()
    const sub = (text: string): string => processWildcards(removeComments(text), fragSource)
    // 3분할이면 각 조각을 개별 치환 후 병합 — 전송 프롬프트와 메타데이터(promptParts)가
    // 같은 치환 결과를 공유한다 (병합본만 치환하면 메타데이터에 <조각> 원문이 남는 버그)
    const subbedParts = rawRequest.promptParts
      ? {
          base: sub(rawRequest.promptParts.base),
          additional: sub(rawRequest.promptParts.additional),
          detail: sub(rawRequest.promptParts.detail)
        }
      : undefined
    let request = {
      ...rawRequest,
      prompt: subbedParts
        ? [subbedParts.base, subbedParts.additional, subbedParts.detail]
            .filter((p) => p.trim())
            .join(', ')
        : sub(rawRequest.prompt),
      negativePrompt: sub(rawRequest.negativePrompt),
      promptParts: subbedParts,
      characterPrompts: rawRequest.characterPrompts.map((c) => ({
        ...c,
        prompt: sub(c.prompt),
        negativePrompt: sub(c.negativePrompt)
      }))
    }

    // 바이브/캐릭레퍼는 DB의 enabled 항목에서 준비 (바이브는 필요 시 인코딩 — 2 Anlas, 캐시됨)
    const { vibes, newlyEncoded } = await prepareVibes(token)
    if (newlyEncoded.length) broadcast('vibes:encoded', {}) // 카드 인코딩 표시 갱신
    const characterReferences = await prepareCharRefs()

    let source = request.source
    // i2i/인페인트: 소스 해상도를 유효 NAI 해상도(64 배수·픽셀 상한)로 스냅하고 이미지를 맞춰 리사이즈.
    // NAI는 width/height가 64 배수가 아니면 400을 낸다 (임의 크기 업로드 이미지 → i2i 실패 원인).
    if (source) {
      const snapped = snapNaiResolution(request.width, request.height)
      if (snapped.width !== request.width || snapped.height !== request.height) {
        const resized = await sharp(Buffer.from(source.imageBase64, 'base64'))
          .resize(snapped.width, snapped.height, { fit: 'fill' })
          .png()
          .toBuffer()
        source = { ...source, imageBase64: resized.toString('base64') }
        request = { ...request, width: snapped.width, height: snapped.height }
      }
    }
    const normalizedMaskBase64 = source?.maskBase64
      ? await normalizeInpaintMask(source.maskBase64, request.width, request.height)
      : undefined
    if (source?.maskBase64 && !request.model.includes('inpainting')) {
      // TODO(fixture): 인페인트 실캡처로 모델 스위칭 여부 확정 필요 (웹 enum에 -inpainting 존재)
      request = { ...request, model: `${request.model}-inpainting` }
    }

    const imageFormat: 'png' | 'webp' = getSetting('image_format') === 'webp' ? 'webp' : 'png'
    const buildOpts = {
      vibes: vibes.length > 0 ? vibes : undefined,
      characterReferences: characterReferences.length > 0 ? characterReferences : undefined,
      imageFormat,
      i2i: source
        ? {
            strength: source.strength,
            noise: source.noise,
            // TODO(fixture): 캡처 1건에서 seed-1이었음 — 규칙 미확정이라 캡처값 방식 채택
            extraNoiseSeed: Math.max(0, request.seed - 1),
            colorCorrect: false,
            imageBase64: source.imageBase64,
            maskBase64: normalizedMaskBase64
          }
        : undefined
    }

    // t2i·i2i·인페인트 모두 스트리밍으로 진행 미리보기 (인페인트는 서버가 스트림에서도 합성 확인됨,
    // i2i는 합성 단계가 없어 최종 프레임이 곧 결과). 스트리밍 설정 off면 전부 zip.
    const streamingOn = getSetting('gen_streaming') !== '0'
    const useZip = !streamingOn
    const { png, sentPayload } = useZip
      ? await generateImageZip(token, request, buildOpts, signal)
      : await generateImageStream(
          token,
          request,
          buildOpts,
          (stepIx, preview) => {
            broadcast('generation:progress', {
              id,
              stepIx,
              totalSteps: request.steps,
              previewPng: preview?.toString('base64')
            })
          },
          signal
        )

    // 자동 저장 off여도 히스토리엔 남긴다 — 저장 폴더 대신 앱 내부 라이브러리로 가는 판정은
    // saveGeneratedImage가 auto_save 설정을 읽어 처리한다 (씬 포함).
    // 씬 생성은 씬루트/<프리셋>/<씬 이름>/에 모아 저장 (NAIS2와 동일 계층)
    const scene = request.sceneId ? getScene(request.sceneId) : null
    const saved = await saveGeneratedImage({
      png,
      sentPayload,
      seed: request.seed,
      kind: request.sceneId ? 'scene' : source ? (source.maskBase64 ? 'inpaint' : 'i2i') : 't2i',
      sceneId: request.sceneId,
      format: imageFormat,
      sceneName: scene?.name,
      scenePresetName: scene ? (getPresetName(scene.presetId) ?? undefined) : undefined,
      localMetadata: request.promptParts
        ? {
            promptParts: {
              ...request.promptParts,
              negative: request.negativePrompt
            }
          }
        : undefined
    })

    // 씬 생성이면 해당 씬 갱신 알림 (목록 썸네일/개수, 상세 이미지 갱신용)
    if (request.sceneId)
      broadcast('scenes:changed', { sceneId: request.sceneId, filePath: saved.filePath })

    // 생성 후 잔액 갱신 (실사용량 추적의 진실 공급원) — 실패해도 생성 흐름엔 영향 없음
    void fetchAnlasBalance(token).then(({ anlas }) => {
      if (anlas !== null) {
        logBalance(anlas)
        broadcast('anlas:balance', { anlas })
      }
    })

    return saved.filePath
  })

  // 저장해둔 생성 지연 시간 적용 (기본 600ms)
  const savedDelay = Number(getSetting('gen_delay_ms'))
  if (Number.isFinite(savedDelay) && savedDelay >= 0) queue.setDelayMs(savedDelay)

  registerIpcHandlers({ dbVersion, queue })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // mac dock 아이콘 (dev 미리보기용 — 패키징 앱은 icns 사용)
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(icon)

  createWindow()
  setupUpdater() // GitHub release 자동 업데이트 확인 (패키징된 앱에서만 실제 동작)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('quit', () => {
  closeDb()
})

/**
 * NAI 인페인트 마스크 정규화 (NAIS2 검증):
 * 원본(소스 이미지) 해상도로 순수 이진화(흰=재생성). 서버가 이 마스크로 깨끗이 합성한다.
 * 클라이언트 합성/erode/blur 불필요 — 오히려 경계 심을 만든다.
 */
/** 소스 해상도를 유효 NAI 해상도로 스냅 — 64 배수, 픽셀 상한 내에서 비율 최대한 보존 */
function snapNaiResolution(w: number, h: number): { width: number; height: number } {
  const MAX_PIXELS = 1216 * 1216 // 안전 상한 — 넘으면 비율 유지 축소
  let ww = w
  let hh = h
  if (ww * hh > MAX_PIXELS) {
    const s = Math.sqrt(MAX_PIXELS / (ww * hh))
    ww *= s
    hh *= s
  }
  const snap = (n: number): number => Math.max(64, Math.round(n / 64) * 64)
  return { width: snap(ww), height: snap(hh) }
}

async function normalizeInpaintMask(
  maskBase64: string,
  width: number,
  height: number
): Promise<string> {
  // 마스크를 1/8로 축소 후 8배 확대(nearest) → 8×8 잠재 블록에 정렬.
  // 1px 경계는 latent 다운스케일 시 애매한 픽셀을 만들어 seam/노이즈를 유발하므로 8px로 스냅한다.
  const mw = Math.max(1, Math.round(width / 8))
  const mh = Math.max(1, Math.round(height / 8))

  // 원본 마스크를 이진화 → 1/8 축소 (블록에 흰색이 조금이라도 있으면 흰색으로: 평균 후 낮은 threshold)
  const small = await sharp(Buffer.from(stripDataUrl(maskBase64), 'base64'))
    .flatten({ background: '#000000' })
    .greyscale()
    .resize(mw, mh, { fit: 'fill' }) // 평균 다운스케일
    .raw()
    .toBuffer()

  // 8배 확대 + RGB 흑백 (NAI는 RGB 마스크 기대). 블록 평균 > 25면 흰색
  const rgb = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mh - 1, Math.floor(y / 8))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mw - 1, Math.floor(x / 8))
      const v = small[sy * mw + sx] > 25 ? 255 : 0
      const dst = (y * width + x) * 3
      rgb[dst] = v
      rgb[dst + 1] = v
      rgb[dst + 2] = v
    }
  }

  const png = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer()
  return png.toString('base64')
}

function stripDataUrl(base64: string): string {
  return base64.replace(/^data:[^,]+,/, '')
}

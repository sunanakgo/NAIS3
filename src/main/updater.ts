import electronUpdater from 'electron-updater'
import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { createWriteStream } from 'fs'
import { access, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import { promisify } from 'util'
import { broadcast } from './ipc'
import { t } from './i18n'

// electron-updater는 CJS — ESM에서 named import가 깨질 수 있어 default에서 구조분해
const { autoUpdater } = electronUpdater
const execFileP = promisify(execFile)

const REPO = 'sunanakgo/NAIS3'
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`

/**
 * 자동 업데이트.
 * - Windows: electron-updater (서명 불필요, 표준 경로)
 * - macOS: 커스텀 — Squirrel.Mac이 Apple 서명을 요구하므로, 앱이 직접 zip을 받아
 *   .app을 교체하고 재시작한다 (Tauri 방식). 최초 설치 때만 Gatekeeper를 넘기면
 *   이후 업데이트 파일은 앱이 받은 것이라 quarantine이 없어 재실행에 문제 없음.
 */
export function setupUpdater(): void {
  if (!app.isPackaged) return // dev에선 확인 안 함

  if (process.platform === 'darwin') {
    void checkMacUpdate()
    setInterval(() => void checkMacUpdate(), 6 * 60 * 60 * 1000)
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    broadcast('update:status', { state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    broadcast('update:status', { state: 'none' })
  })
  autoUpdater.on('download-progress', (p) => {
    broadcast('update:status', { state: 'downloading', percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', () => {
    broadcast('update:status', { state: 'downloaded' })
    // 자동 진행 — 잠깐 상태를 보여준 뒤 재시작 설치
    setTimeout(() => autoUpdater.quitAndInstall(), 1200)
  })
  autoUpdater.on('error', (err) => {
    broadcast('update:status', { state: 'error', message: err?.message ?? String(err) })
  })

  void autoUpdater.checkForUpdates().catch(() => {
    /* 네트워크 오류 등은 조용히 무시 (버튼은 안 뜸) */
  })
  setInterval(
    () => {
      void autoUpdater.checkForUpdates().catch(() => {})
    },
    6 * 60 * 60 * 1000
  )
}

/** 다운로드 시작 (타이틀바/설정 버튼 클릭) */
export function startUpdateDownload(): void {
  if (process.platform === 'darwin') {
    void downloadAndInstallMac()
    return
  }
  void autoUpdater.downloadUpdate().catch((err) => {
    broadcast('update:status', { state: 'error', message: err?.message ?? String(err) })
  })
}

// ─── macOS 커스텀 업데이터 ───────────────────────────────────────────

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
}

let macAsset: GhAsset | null = null

function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false
  }
  return false
}

async function checkMacUpdate(): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) return
    const rel = (await res.json()) as { tag_name?: string; assets?: GhAsset[] }
    const version = String(rel.tag_name ?? '').replace(/^v/, '')
    if (!version || !isNewer(version, app.getVersion())) {
      broadcast('update:status', { state: 'none' })
      return
    }
    // 아키텍처에 맞는 mac zip (예: nais3-1.0.1-arm64-mac.zip)
    const asset = (rel.assets ?? []).find((a) => a.name.endsWith(`${process.arch}-mac.zip`))
    if (!asset) return
    macAsset = asset
    broadcast('update:status', { state: 'available', version })
  } catch {
    /* 조용히 무시 */
  }
}

async function downloadAndInstallMac(): Promise<void> {
  const asset = macAsset
  if (!asset) return
  try {
    broadcast('update:status', { state: 'downloading', percent: 0 })

    // 1. zip 다운로드 (진행률 브로드캐스트)
    const res = await fetch(asset.browser_download_url)
    if (!res.ok || !res.body) throw new Error(t('ui.downloadFailedValue', res.status))
    const tmp = await mkdtemp(join(tmpdir(), 'nais3-update-'))
    const zipPath = join(tmp, asset.name)
    const out = createWriteStream(zipPath)
    const reader = res.body.getReader()
    let received = 0
    let lastPct = -1
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.write(value)
      received += value.length
      const pct = Math.min(99, Math.round((received / asset.size) * 100))
      if (pct !== lastPct) {
        lastPct = pct
        broadcast('update:status', { state: 'downloading', percent: pct })
      }
    }
    await new Promise<void>((res2, rej) => out.end((e?: Error) => (e ? rej(e) : res2())))

    // 2. 압축 해제 (ditto — 심볼릭 링크·번들 구조 보존)
    const extractDir = join(tmp, 'extracted')
    await execFileP('ditto', ['-xk', zipPath, extractDir])

    // 3. .app 교체: 현재 번들을 옆으로 치우고 새 번들을 제자리에 (mv는 볼륨 경계도 처리)
    const appBundle = resolve(app.getPath('exe'), '../../..') // .../NAIS3.app
    const newApp = join(extractDir, basename(appBundle))
    await access(join(newApp, 'Contents', 'Info.plist')) // 번들 검증
    const oldApp = `${appBundle}.old-${process.pid}`
    await execFileP('mv', [appBundle, oldApp])
    try {
      await execFileP('mv', [newApp, appBundle])
    } catch (e) {
      await execFileP('mv', [oldApp, appBundle]) // 실패 시 원복
      throw e
    }
    void rm(oldApp, { recursive: true, force: true }).catch(() => {})
    void rm(tmp, { recursive: true, force: true }).catch(() => {})

    // 4. 재시작
    broadcast('update:status', { state: 'downloaded' })
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 1200)
  } catch (e) {
    // 권한 부족 등으로 실패하면 릴리즈 페이지로 폴백
    broadcast('update:status', {
      state: 'error',
      message: t(
        'ui.automaticInstallFailedOpeningTheReleasePageValue',
        e instanceof Error ? e.message : String(e)
      )
    })
    void shell.openExternal(RELEASE_PAGE)
  }
}

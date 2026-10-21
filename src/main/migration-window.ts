import { app, BrowserWindow } from 'electron'
import icon from '../../resources/icon.png?asset'
import { translate, type Lang } from '../shared/i18n'

// 작은 DB는 순식간에 끝난다 — 그때는 창을 띄웠다가 곧바로 닫지 않는다
const SHOW_DELAY_MS = 500

/**
 * 백업·마이그레이션 동안 띄우는 "데이터베이스 업데이트 중" 창 (메인 창을 열기 전이라 아무것도 없으면
 * 멈춘 줄 알고 다시 실행하게 된다). 창이 뜬 뒤에는 second-instance가 이 창을 앞으로 가져온다.
 * close()는 메인 창을 만든 뒤에 — 먼저 닫으면 window-all-closed로 앱이 종료된다.
 */
export function showMigrationProgress(lang: Lang): { close(): void } {
  let window: BrowserWindow | null = null
  // 사용자가 창만 닫는 것은 막고, 앱 종료(Cmd+Q·로그아웃 등)는 막지 않는다.
  // closable: false인 창은 app.quit()의 창 닫기를 취소시키므로 before-quit에서 풀어 준다
  let quitting = false
  const allowQuit = (): void => {
    quitting = true
    clearTimeout(timer)
    window?.setClosable(true)
  }
  app.once('before-quit', allowQuit)
  const timer = setTimeout(() => {
    const title = translate(lang, 'ui.updatingTheDatabase', [])
    const detail = translate(
      lang,
      'ui.thisCanTakeAFewMinutesWithManyImagesNais3OpensWhenItIsDone',
      []
    )
    window = new BrowserWindow({
      width: 440,
      height: 140,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // 닫아도 데이터는 안전하지만 업데이트가 다음 실행 때 처음부터 다시 시작된다
      closable: false,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0f0f10',
      title,
      ...(process.platform !== 'darwin' ? { icon } : {})
    })
    // closable은 Linux에서 지원되지 않는다 — 아래 close()는 destroy라 막히지 않는다
    window.on('close', (event) => {
      if (!quitting) event.preventDefault()
    })
    window.once('ready-to-show', () => window?.show())
    void window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(page(lang, title, detail))}`
    )
  }, SHOW_DELAY_MS)
  return {
    close: () => {
      clearTimeout(timer)
      app.removeListener('before-quit', allowQuit)
      window?.destroy()
      window = null
    }
  }
}

function page(lang: Lang, title: string, detail: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  html, body { margin: 0; height: 100%; background: #0f0f10; color: #e7e7ea; cursor: default;
    font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; user-select: none; }
  body { display: flex; flex-direction: column; justify-content: center; gap: 12px;
    padding: 0 24px; box-sizing: border-box; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; }
  p { margin: 0; color: #a1a1aa; }
  .bar { height: 3px; border-radius: 2px; background: #27272a; overflow: hidden; }
  .bar::before { content: ''; display: block; width: 30%; height: 100%; background: #d4d4d8;
    animation: slide 1.4s ease-in-out infinite; }
  @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
</style>
</head>
<body><h1>${title}</h1><div class="bar"></div><p>${detail}</p></body>
</html>`
}

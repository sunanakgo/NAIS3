import type { WebContents } from 'electron'
import { stepZoomFactor, zoomCommandForInput, type ZoomCommand } from '../shared/zoom'

export function applyZoom(contents: WebContents, command: ZoomCommand): number {
  const factor = stepZoomFactor(contents.getZoomFactor(), command)
  contents.setZoomFactor(factor)
  return factor
}

/**
 * 앱 화면의 확대·축소 단축키를 기본 메뉴 대신 직접 처리한다. preventDefault는 페이지 keydown과
 * 메뉴 단축키를 함께 막아, 기본 메뉴의 zoomIn/zoomOut과 두 번 적용되지 않는다.
 * <webview>(웹 탭)는 자체 배율 버튼이 있어 여기서 다루지 않는다.
 */
export function watchZoomShortcuts(
  contents: WebContents,
  onChange: (factor: number) => void
): void {
  contents.on('before-input-event', (event, input) => {
    const command = zoomCommandForInput(input, process.platform)
    if (!command) return
    event.preventDefault()
    onChange(applyZoom(contents, command))
  })
}

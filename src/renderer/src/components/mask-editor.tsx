import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { useT } from '../lib/i18n'
import { MaskWorkspace } from './mask-workspace'

/**
 * Legacy/global entry point. Director embeds the same workspace directly in its canvas.
 */
export function MaskEditor({
  imageBase64,
  width,
  height,
  initialMaskBase64,
  onConfirm,
  onCancel
}: {
  imageBase64: string
  width: number
  height: number
  /** 이어서 편집할 기존 마스크 (흑백 PNG) — 재편집 진입 시 칠한 영역을 그대로 복원 */
  initialMaskBase64?: string
  onConfirm: (maskBase64: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[min(94vw,1100px)] p-4">
        <DialogTitle className="mb-3">
          {t('인페인트 마스크 — 재생성할 영역을 칠하세요')}
        </DialogTitle>
        <MaskWorkspace
          className="h-[min(72vh,760px)] rounded-lg border border-line"
          imageBase64={imageBase64}
          width={width}
          height={height}
          initialMaskBase64={initialMaskBase64}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </DialogContent>
    </Dialog>
  )
}

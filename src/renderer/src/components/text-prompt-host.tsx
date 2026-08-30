import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'
import { useDialogStore } from '../stores/dialog-store'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

/** askText/askConfirm 요청을 실제로 렌더하는 호스트 — App에 1회 배치 */
export function TextPromptHost(): React.JSX.Element {
  return (
    <>
      <TextPrompt />
      <ConfirmPrompt />
    </>
  )
}

function TextPrompt(): React.JSX.Element {
  const t = useT()
  const req = useDialogStore((s) => s.textPrompt)
  const resolve = useDialogStore((s) => s._resolve)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (req) setValue(req.value)
  }, [req])

  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && resolve(null)}>
      <DialogContent className="max-w-[380px] p-5">
        <DialogTitle className="mb-3">{req?.title}</DialogTitle>
        <input
          autoFocus
          className="w-full rounded-md border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-accent"
          value={value}
          placeholder={req?.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) resolve(value.trim())
            else if (e.key === 'Escape') resolve(null)
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => resolve(null)}>
            {t('ui.cancel')}
          </Button>
          <Button variant="accent" disabled={!value.trim()} onClick={() => resolve(value.trim())}>
            {t('ui.ok')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmPrompt(): React.JSX.Element {
  const t = useT()
  const req = useDialogStore((s) => s.confirm)
  const resolve = useDialogStore((s) => s._resolveConfirm)

  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && resolve(false)}>
      <DialogContent className="max-w-[400px] p-5">
        <DialogTitle className="mb-2">{req?.title}</DialogTitle>
        {req?.message && (
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted">
            {req.message}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => resolve(false)}>
            {t('ui.no')}
          </Button>
          <Button
            variant={req?.danger ? 'danger' : 'accent'}
            autoFocus
            onClick={() => resolve(true)}
          >
            {req?.confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

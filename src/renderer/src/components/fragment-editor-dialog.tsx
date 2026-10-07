import { useEffect, useRef } from 'react'
import { Puzzle } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useFragmentsStore } from '../stores/fragments-store'
import { PromptEditor } from './prompt-editor'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

/** A single editor host shared by the fragment list and every prompt field. */
export function FragmentEditorDialog(): React.JSX.Element {
  const t = useT()
  const fragment = useFragmentsStore((s) => s.items.find((f) => f.id === s.editingId))
  const folder = useFragmentsStore((s) => s.folders.find((f) => f.id === fragment?.folderId))
  const closeEditor = useFragmentsStore((s) => s.closeEditor)
  const editorTrigger = useFragmentsStore((s) => s.editorTrigger)
  const update = useFragmentsStore((s) => s.update)
  const returnFocus = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const path = fragment ? (folder ? `${folder.name}/${fragment.name}` : fragment.name) : ''

  // Following a nested reference replaces the editor without reopening the dialog.
  useEffect(() => {
    contentRef.current?.querySelector('textarea')?.focus()
  }, [fragment?.id])

  return (
    <Dialog open={!!fragment} onOpenChange={(open) => !open && closeEditor()}>
      <DialogContent
        ref={contentRef}
        className="flex h-[min(760px,85dvh)] max-w-[960px] flex-col gap-4 p-5"
        onOpenAutoFocus={(e) => {
          returnFocus.current = editorTrigger ?? (document.activeElement as HTMLElement | null)
          e.preventDefault()
          contentRef.current?.querySelector('textarea')?.focus()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          if (returnFocus.current?.isConnected) returnFocus.current.focus()
        }}
        onInteractOutside={(e) => {
          // Prompt completions are portaled to the viewport to avoid clipping.
          if ((e.target as HTMLElement | null)?.closest('[data-prompt-suggestions]')) {
            e.preventDefault()
          }
        }}
        onEscapeKeyDown={(e) => {
          if (
            document.querySelector('[data-prompt-suggestions]') ||
            contentRef.current?.querySelector('[data-prompt-find]')
          )
            e.preventDefault()
        }}
      >
        <div className="shrink-0 space-y-1 pr-7">
          <div className="flex items-center gap-2">
            <Puzzle size={16} className="shrink-0 text-accent-ink" />
            <DialogTitle className="min-w-0 truncate">{fragment?.name}</DialogTitle>
          </div>
          <DialogDescription className="break-all font-mono">{`<${path}>`}</DialogDescription>
        </div>
        {fragment && (
          <PromptEditor
            key={fragment.id}
            className="min-h-0 flex-1 bg-paper"
            ariaLabel={t('ui.fragmentContent')}
            value={fragment.content}
            tokensOverride={null}
            placeholder={t(
              'ui.oneLineOneOptionMultipleLinesPickRandomlyPerGenerationLinesStart779fe71'
            )}
            onValueChange={(content) => update(fragment.id, { content })}
          />
        )}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <p className="text-[11px] text-muted">{t('ui.fragmentEditorAutoSave')}</p>
          <Button variant="ghost" onClick={closeEditor}>
            {t('ui.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import {
  Copy,
  Download,
  FileDown,
  FileUp,
  FolderPlus,
  Maximize2,
  Pencil,
  Plus,
  Puzzle,
  RotateCcw,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Fragment } from '@shared/types'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { buildDisplayRows } from '../lib/folder-list'
import { useFragmentsStore } from '../stores/fragments-store'
import { toast } from '../stores/toast-store'
import { FragmentNameInput } from './fragment-name-input'
import { FolderListView } from './folder-list-view'
import { Button } from './ui/button'
import { ContextMenuItem, ContextMenuSeparator } from './ui/context-menu'
import { Input } from './ui/input'
import { PromptEditor } from './prompt-editor'

function lineCount(content: string): number {
  // #로 시작하는 줄만 주석 (main의 contentToLines와 동일 규칙)
  return content.split('\n').filter((l) => l.trim().length > 0 && !l.trimStart().startsWith('#'))
    .length
}

export function FragmentOverlay(): React.JSX.Element {
  const t = useT()
  const setOverlayOpen = useFragmentsStore((s) => s.setOverlayOpen)
  const folders = useFragmentsStore((s) => s.folders)
  const items = useFragmentsStore((s) => s.items)
  const create = useFragmentsStore((s) => s.create)
  const update = useFragmentsStore((s) => s.update)
  const remove = useFragmentsStore((s) => s.remove)
  const createFolder = useFragmentsStore((s) => s.createFolder)
  const renameFolder = useFragmentsStore((s) => s.renameFolder)
  const toggleCollapse = useFragmentsStore((s) => s.toggleCollapse)
  const setFolderColor = useFragmentsStore((s) => s.setFolderColor)
  const removeFolder = useFragmentsStore((s) => s.removeFolder)
  const move = useFragmentsStore((s) => s.move)
  const importTxt = useFragmentsStore((s) => s.importTxt)
  const exportTxt = useFragmentsStore((s) => s.exportTxt)
  const exportAll = useFragmentsStore((s) => s.exportAll)
  const duplicate = useFragmentsStore((s) => s.duplicate)
  const resetSequential = useFragmentsStore((s) => s.resetSequential)
  const openEditor = useFragmentsStore((s) => s.openEditor)

  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const itemButtons = useRef(new Map<number, HTMLButtonElement>())
  const renderKey = useMemo(() => [folders, renamingId], [folders, renamingId])

  const searching = search.trim().length > 0
  const rows = useMemo(() => {
    const all = buildDisplayRows(folders, items)
    if (!searching) return all
    const q = search.trim().toLowerCase()
    return all.filter((r) => r.type === 'item' && r.item.name.toLowerCase().includes(q))
  }, [folders, items, searching, search])

  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders])
  const pathOf = (f: Fragment): string =>
    f.folderId != null && folderName.get(f.folderId)
      ? `${folderName.get(f.folderId)}/${f.name}`
      : f.name

  const renderHeader = (fragment: Fragment): React.ReactNode => {
    const lines = lineCount(fragment.content)
    return (
      <div className="flex h-10 items-center gap-2 px-2.5">
        <Puzzle size={14} className="shrink-0 text-faint" />
        {renamingId === fragment.id ? (
          <FragmentNameInput fragment={fragment} onDone={() => setRenamingId(null)} />
        ) : (
          <button
            ref={(node) => {
              if (node) itemButtons.current.set(fragment.id, node)
              else itemButtons.current.delete(fragment.id)
            }}
            className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
            title={t('ui.clickToEdit')}
            onClick={() => setExpandedId((prev) => (prev === fragment.id ? null : fragment.id))}
          >
            {fragment.name}
          </button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 shrink-0 p-0"
          title={t('ui.rename')}
          aria-label={t('ui.rename')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setRenamingId(fragment.id)}
        >
          <Pencil size={13} />
        </Button>
        <span
          className={cn(
            'shrink-0 font-mono text-[11px]',
            lines > 1 ? 'text-accent-ink' : 'text-faint'
          )}
          title={
            lines > 1
              ? t('ui.multipleLinesRandomPickPerGenerationWildcard')
              : t('ui.singleLineFixedSubstitution')
          }
        >
          {t('ui.valueLines', lines)}
        </span>
      </div>
    )
  }

  const renderExpanded = (fragment: Fragment): React.ReactNode => (
    <div className="flex flex-col gap-1.5 px-2.5 pb-2">
      <div className="flex items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="mr-auto gap-1.5 text-[11.5px]"
          title={t('ui.expandFragmentEditor')}
          onClick={() => openEditor(fragment.id)}
        >
          <Maximize2 size={14} /> {t('ui.expandFragmentEditor')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title={t('ui.exportTxt')}
          onClick={() => void exportTxt(fragment.id)}
        >
          <Download size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 hover:text-danger"
          title={t('ui.delete')}
          onClick={() => remove(fragment.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      {/* 조각 내용도 프롬프트 — 하이라이트/자동완성 공용 컴포넌트 사용, 세로 크기 조절 (F10) */}
      <PromptEditor
        className="h-36 max-h-[520px] min-h-20 resize-y bg-surface-2"
        value={fragment.content}
        tokensOverride={null}
        placeholder={t(
          'ui.oneLineOneOptionMultipleLinesPickRandomlyPerGenerationLinesStart779fe71'
        )}
        onValueChange={(v) => update(fragment.id, { content: v })}
      />
      <p className="text-[10.5px] text-faint">
        {t('ui.useAsValueValuePicksSequentially', pathOf(fragment))}
      </p>
    </div>
  )

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title={t('ui.close')}
          onClick={() => setOverlayOpen(false)}
        >
          <X size={15} />
        </Button>
        <span className="text-[13px] font-medium">{t('ui.fragmentPrompts')}</span>
        <span className="font-mono text-[10.5px] text-faint">{items.length}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title={t('ui.resetSequentialCountersNameStartsFromTheFirstLineAgain')}
          onClick={async () => {
            await resetSequential()
            toast(t('ui.sequentialCountersReset'), 'success')
          }}
        >
          <RotateCcw size={14} />
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-[11.5px]"
          title={t('ui.importFragmentsTxtZipWildcardCompatible')}
          onClick={() => void importTxt()}
        >
          <FileUp size={13} /> {t('ui.import')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-[11.5px]"
          title={t('ui.exportAllFragmentsZipShareBackup')}
          onClick={async () => {
            const n = await exportAll()
            if (n > 0) toast(t('ui.exportedValueFragments', n), 'success')
          }}
        >
          <FileDown size={13} /> {t('ui.export')}
        </Button>
      </div>

      <p className="px-1 text-[11px] text-faint">{t('ui.fragmentQuickEditHint')}</p>

      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            className="pl-7"
            value={search}
            placeholder={t('ui.search')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          title={t('ui.addFolder')}
          onClick={() => void createFolder(t('ui.newFolder'))}
        >
          <FolderPlus size={14} />
        </Button>
        <Button
          size="sm"
          variant="accent"
          className="gap-1"
          onClick={() => {
            void create(null).then((id) => setExpandedId(id))
          }}
        >
          <Plus size={13} /> {t('ui.fragments')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
        <FolderListView
          rows={rows}
          searching={searching}
          expandedId={expandedId}
          renderKey={renderKey}
          folderActions={{
            rename: renameFolder,
            toggleCollapse,
            setColor: setFolderColor,
            remove: removeFolder,
            addItem: (folderId) => void create(folderId).then((id) => setExpandedId(id))
          }}
          onMove={move}
          itemClassName={() => 'transition-colors hover:border-muted/60'}
          renderHeader={renderHeader}
          renderExpanded={renderExpanded}
          itemContextMenu={(fragment) => (
            <>
              <ContextMenuItem onSelect={() => setTimeout(() => setRenamingId(fragment.id), 0)}>
                <Pencil size={13} /> {t('ui.rename')}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => openEditor(fragment.id, itemButtons.current.get(fragment.id))}
              >
                <Maximize2 size={13} /> {t('ui.expandFragmentEditor')}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void duplicate(fragment.id)}>
                <Copy size={13} /> {t('ui.duplicate')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem danger onSelect={() => remove(fragment.id)}>
                <Trash2 size={13} /> {t('ui.delete')}
              </ContextMenuItem>
            </>
          )}
          emptyText={
            items.length === 0 ? t('ui.addAFragmentOrImportATxtFile') : t('ui.noSearchResults')
          }
        />
      </div>
    </div>
  )
}

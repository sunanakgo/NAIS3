import { Download, FileDown, FileUp, FolderPlus, Plus, Puzzle, Search, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Fragment } from '@shared/types'
import { cn } from '../lib/utils'
import { buildDisplayRows } from '../lib/folder-list'
import { useFragmentsStore } from '../stores/fragments-store'
import { toast } from '../stores/toast-store'
import { FolderListView } from './folder-list-view'
import { Button } from './ui/button'
import { Input, Textarea } from './ui/input'

function lineCount(content: string): number {
  return content.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length
}

export function FragmentOverlay(): React.JSX.Element {
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

  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

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
        <button
          className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
          title="눌러서 수정"
          onClick={() => setExpandedId(expandedId === fragment.id ? null : fragment.id)}
        >
          {fragment.name}
        </button>
        <span
          className={cn('shrink-0 font-mono text-[11px]', lines > 1 ? 'text-accent' : 'text-faint')}
          title={lines > 1 ? '여러 줄 — 생성마다 랜덤 선택 (와일드카드)' : '한 줄 — 고정 치환'}
        >
          {lines}줄
        </span>
      </div>
    )
  }

  const renderExpanded = (fragment: Fragment): React.ReactNode => (
    <div className="flex flex-col gap-1.5 px-2.5 pb-2">
      <div className="flex gap-1.5">
        <Input
          className="h-8 flex-1 bg-surface-2 text-[12.5px]"
          value={fragment.name}
          placeholder="이름"
          onChange={(e) => update(fragment.id, { name: e.target.value })}
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="TXT 내보내기"
          onClick={() => void exportTxt(fragment.id)}
        >
          <Download size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 hover:text-danger"
          title="삭제"
          onClick={() => remove(fragment.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <Textarea
        rows={6}
        className="bg-surface-2 font-mono text-[12px]"
        value={fragment.content}
        placeholder={'한 줄 = 한 옵션 (여러 줄이면 생성마다 랜덤 선택)\n# 으로 시작하면 주석'}
        onChange={(e) => update(fragment.id, { content: e.target.value })}
      />
      <p className="text-[10.5px] text-faint">
        {'<'}
        {pathOf(fragment)}
        {'>'} 로 사용 · {'<*'}
        {pathOf(fragment)}
        {'>'} 는 순차 선택
      </p>
    </div>
  )

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" title="닫기" onClick={() => setOverlayOpen(false)}>
          <X size={15} />
        </Button>
        <span className="text-[13px] font-medium">조각 프롬프트</span>
        <span className="font-mono text-[10.5px] text-faint">{items.length}</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-[11.5px]"
          title="조각 불러오기 (TXT / ZIP · 와일드카드 호환)"
          onClick={() => void importTxt()}
        >
          <FileUp size={13} /> 불러오기
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-[11.5px]"
          title="조각 전체 내보내기 (ZIP · 공유/백업)"
          onClick={async () => {
            const n = await exportAll()
            if (n > 0) toast(`조각 ${n}개 내보냄`, 'success')
          }}
        >
          <FileDown size={13} /> 내보내기
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input className="pl-7" value={search} placeholder="검색" onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" variant="ghost" title="폴더 추가" onClick={() => void createFolder('새 폴더')}>
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
          <Plus size={13} /> 조각
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
        <FolderListView
          rows={rows}
          searching={searching}
          expandedId={expandedId}
          folderActions={{
            rename: renameFolder,
            toggleCollapse,
            setColor: setFolderColor,
            remove: removeFolder,
            addItem: (folderId) => void create(folderId).then((id) => setExpandedId(id))
          }}
          onMove={move}
          renderHeader={renderHeader}
          renderExpanded={renderExpanded}
          emptyText={items.length === 0 ? '조각을 추가하거나 TXT를 가져오세요' : '검색 결과 없음'}
        />
      </div>
    </div>
  )
}

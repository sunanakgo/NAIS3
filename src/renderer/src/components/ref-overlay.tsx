import {
  CheckSquare,
  Copy,
  FolderPlus,
  ImagePlus,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharRefItem, CharRefType, VibeItem } from '@shared/types'
import { cn } from '../lib/utils'
import { applyClickSelection, useSelectAllShortcut } from '../lib/edit-selection'
import { buildDisplayRows } from '../lib/folder-list'
import { CHARREF_TYPES, refsStoreFor } from '../stores/refs-store'
import { askConfirm, askText } from '../stores/dialog-store'
import { FolderListView } from './folder-list-view'
import { Button } from './ui/button'
import { ContextMenuItem, ContextMenuSeparator } from './ui/context-menu'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'

/**
 * 바이브/캐릭레퍼 라이브러리 — 캐릭터 프롬프트와 동일한 얇은 카드 + 펼치기 방식.
 * 헤더: 토글 / 썸네일(호버 미리보기) / 이름. 펼치면 전체 이미지 + 파라미터.
 */
export function RefOverlay({ kind }: { kind: 'vibe' | 'charref' }): React.JSX.Element {
  const store = refsStoreFor(kind)
  const setOverlayOpen = store((s) => s.setOverlayOpen)
  const folders = store((s) => s.folders)
  const items = store((s) => s.items)
  const add = store((s) => s.add)
  const update = store((s) => s.update)
  const remove = store((s) => s.remove)
  const duplicate = store((s) => s.duplicate)
  const createFolder = store((s) => s.createFolder)
  const renameFolder = store((s) => s.renameFolder)
  const toggleCollapse = store((s) => s.toggleCollapse)
  const setFolderColor = store((s) => s.setFolderColor)
  const removeFolder = store((s) => s.removeFolder)
  const move = store((s) => s.move)

  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ src: string; top: number; left: number } | null>(null)

  // 편집 모드 — 다중 선택 (일반 클릭=교체, Ctrl=토글, Shift=구간, Ctrl+A=전체)
  const [editMode, setEditMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkParamsOpen, setBulkParamsOpen] = useState(false)
  const anchorRef = useRef<number | null>(null)
  const toggleEditMode = (): void => {
    setEditMode((v) => !v)
    setSelected(new Set())
    setExpandedId(null)
    anchorRef.current = null
  }

  const searching = search.trim().length > 0
  const rows = useMemo(() => {
    const all = buildDisplayRows(folders, items as { id: number; folderId: number | null }[])
    if (!searching) return all
    const q = search.trim().toLowerCase()
    return all.filter(
      (r) =>
        r.type === 'item' &&
        (items.find((i) => i.id === r.item.id)?.name ?? '').toLowerCase().includes(q)
    )
  }, [folders, items, searching, search])

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const enabledCount = items.filter((i) => i.enabled).length

  // 화면에 보이는 순서의 아이템 id들 (Shift 구간/Ctrl+A 기준)
  const visibleIds = useMemo(
    () => rows.flatMap((r) => (r.type === 'item' && !r.hidden ? [r.item.id] : [])),
    [rows]
  )
  useSelectAllShortcut(editMode, () => setSelected(new Set(visibleIds)))
  const selectItem = (id: number, e: React.MouseEvent): void =>
    setSelected((prev) => applyClickSelection(prev, visibleIds, id, e, anchorRef))
  // memo된 카드가 편집 모드/선택 변화에 리렌더되도록
  const renderKey = useMemo(() => (editMode ? selected : null), [editMode, selected])

  const bulkDelete = async (): Promise<void> => {
    if (
      !(await askConfirm('선택 삭제', {
        message: `선택한 ${selected.size}개를 삭제합니다.`,
        confirmLabel: '삭제',
        danger: true
      }))
    )
      return
    for (const id of selected) remove(id)
    setSelected(new Set())
  }
  const bulkDuplicate = async (): Promise<void> => {
    // 보이는 순서대로 복제
    for (const id of visibleIds.filter((id) => selected.has(id))) await duplicate(id)
    setSelected(new Set())
  }

  const showPreview = (e: React.MouseEvent, thumb: string): void => {
    const card = (e.currentTarget as HTMLElement).closest('[data-ref-card]')
    if (!card) return
    const rect = card.getBoundingClientRect()
    const size = 176
    const top = Math.max(
      8,
      Math.min(rect.top + rect.height / 2 - size / 2, window.innerHeight - size - 8)
    )
    setPreview({ src: thumb, top, left: rect.right + 10 })
  }

  const renderHeader = (row: { id: number }): React.ReactNode => {
    const item = byId.get(row.id)
    if (!item) return null
    if (editMode) {
      const checked = selected.has(item.id)
      return (
        <div
          className="flex h-10 cursor-pointer select-none items-center gap-2 px-2"
          onClick={(e) => selectItem(item.id, e)}
        >
          <span
            className={cn(
              'grid size-4 shrink-0 place-items-center rounded border-2',
              checked ? 'border-accent bg-accent text-white' : 'border-line'
            )}
          >
            {checked && <span className="text-[9px] leading-none">✓</span>}
          </span>
          {item.thumbnail ? (
            <img
              src={`data:image/webp;base64,${item.thumbnail}`}
              className="size-7 shrink-0 rounded object-cover"
              alt=""
              draggable={false}
            />
          ) : (
            <span className="grid size-7 shrink-0 place-items-center rounded bg-surface-2 text-faint">
              <ImagePlus size={14} strokeWidth={1.5} />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
            {item.name || <span className="text-faint">이름 없음</span>}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-faint">
            {kind === 'vibe'
              ? `s${(item as VibeItem).strength.toFixed(2)}`
              : (item as CharRefItem).refType === 'character&style'
                ? 'C&S'
                : (item as CharRefItem).refType[0].toUpperCase()}
          </span>
        </div>
      )
    }
    return (
      <div
        data-ref-card
        className={cn('flex h-10 items-center gap-2 px-2', !item.enabled && 'opacity-55')}
      >
        <Switch checked={item.enabled} onCheckedChange={(v) => update(item.id, { enabled: v })} />
        {item.thumbnail ? (
          <img
            src={`data:image/webp;base64,${item.thumbnail}`}
            className="size-7 shrink-0 rounded object-cover"
            alt=""
            onMouseEnter={(e) => showPreview(e, item.thumbnail)}
            onMouseLeave={() => setPreview(null)}
          />
        ) : (
          <div className="grid size-7 shrink-0 place-items-center rounded bg-surface-2 text-faint">
            <ImagePlus size={14} strokeWidth={1.5} />
          </div>
        )}
        <button
          className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
          onClick={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
        >
          {item.name || <span className="text-faint">이름 없음</span>}
        </button>
        {/* 바이브 인코딩 완료 표시 — 채워진 점=인코딩됨, 빈 점=생성 시 인코딩 예정 */}
        {kind === 'vibe' && (
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              (item as VibeItem).encodedReady ? 'bg-emerald-500' : 'border border-faint'
            )}
            title={
              (item as VibeItem).encodedReady ? '인코딩됨' : '미인코딩 (생성 시 인코딩, 2 Anlas)'
            }
          />
        )}
        <span className="shrink-0 font-mono text-[10px] text-faint">
          {kind === 'vibe'
            ? `s${(item as VibeItem).strength.toFixed(2)}`
            : (item as CharRefItem).refType === 'character&style'
              ? 'C&S'
              : (item as CharRefItem).refType[0].toUpperCase()}
        </span>
      </div>
    )
  }

  const renderExpanded = (row: { id: number }): React.ReactNode => {
    const item = byId.get(row.id)
    if (!item) return null
    return (
      <div className="flex flex-col gap-2 px-2 pb-2">
        {item.thumbnail && (
          <img
            src={`data:image/webp;base64,${item.thumbnail}`}
            className="max-h-48 w-full rounded-md border border-line object-contain"
            alt=""
          />
        )}
        <div className="flex gap-1.5">
          <Input
            className="h-7 flex-1 text-[12px]"
            value={item.name}
            placeholder="이름 (선택)"
            onChange={(e) => update(item.id, { name: e.target.value })}
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:text-danger"
            title="삭제"
            onClick={() => remove(item.id)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
        {kind === 'vibe' ? (
          <VibeParams item={item as VibeItem} update={update} />
        ) : (
          <CharRefParams item={item as CharRefItem} update={update} />
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="닫기"
          onClick={() => setOverlayOpen(false)}
        >
          <X size={15} />
        </Button>
        <span className="text-[13px] font-medium">
          {kind === 'vibe' ? '바이브 트랜스퍼' : '캐릭터 레퍼런스'}
        </span>
        {enabledCount > 0 && (
          <span className="rounded-full bg-accent-soft px-1.5 font-mono text-[10.5px] text-accent">
            {enabledCount}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            className="pl-7"
            value={search}
            placeholder="검색"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          title="폴더 추가"
          onClick={() => void createFolder('새 폴더')}
        >
          <FolderPlus size={14} />
        </Button>
        <Button
          size="sm"
          variant={editMode ? 'accent' : 'ghost'}
          title="편집 모드 (다중 선택 — 클릭 토글, Shift+클릭 구간, Ctrl+A 전체)"
          onClick={toggleEditMode}
        >
          <CheckSquare size={14} />
        </Button>
        <Button size="sm" variant="accent" className="gap-1" onClick={() => void add(null)}>
          <ImagePlus size={13} /> 추가
        </Button>
      </div>

      {/* 편집 모드 일괄 작업 바 — 검색 아래 */}
      {editMode && (
        <div className="flex flex-wrap items-center gap-1 border-b border-line pb-2 text-[12px]">
          <span className="text-muted">{selected.size}개</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(visibleIds))}>
            전체
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            해제
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            disabled={selected.size === 0}
            onClick={() => void bulkDuplicate()}
          >
            <Copy size={12} /> 복제
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            disabled={selected.size === 0}
            onClick={() => setBulkParamsOpen(true)}
          >
            <SlidersHorizontal size={12} /> 파라미터
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-danger hover:text-danger"
            disabled={selected.size === 0}
            onClick={() => void bulkDelete()}
          >
            <Trash2 size={12} /> 삭제
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
        <FolderListView
          rows={rows}
          searching={searching}
          expandedId={editMode ? null : expandedId}
          renderKey={renderKey}
          folderActions={{
            rename: renameFolder,
            toggleCollapse,
            setColor: setFolderColor,
            remove: removeFolder,
            addItem: (folderId) => void add(folderId)
          }}
          onMove={move}
          itemClassName={(row) =>
            cn(
              'transition-colors hover:border-muted/60', // F2
              editMode
                ? selected.has(row.id) && 'border-accent ring-1 ring-accent/40'
                : byId.get(row.id)?.enabled && 'border-accent/60 bg-accent-soft' // F3
            )
          }
          renderHeader={renderHeader}
          renderExpanded={renderExpanded}
          itemContextMenu={(row) => (
            <>
              <ContextMenuItem
                onSelect={async () => {
                  const name = await askText('이름 변경', byId.get(row.id)?.name ?? '')
                  if (name != null) update(row.id, { name })
                }}
              >
                <Pencil size={13} /> 이름 변경
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem danger onSelect={() => remove(row.id)}>
                <Trash2 size={13} /> 삭제
              </ContextMenuItem>
            </>
          )}
          emptyText={items.length === 0 ? '이미지를 추가해보세요' : '검색 결과 없음'}
        />
      </div>

      {bulkParamsOpen && (
        <BulkParamsDialog
          kind={kind}
          count={selected.size}
          onApply={(patch) => {
            for (const id of selected) update(id, patch)
            setBulkParamsOpen(false)
          }}
          onClose={() => setBulkParamsOpen(false)}
        />
      )}

      {preview &&
        createPortal(
          <img
            src={`data:image/webp;base64,${preview.src}`}
            className="pointer-events-none fixed z-50 size-44 rounded-lg border border-line object-cover shadow-2xl"
            style={{ top: preview.top, left: preview.left }}
            alt=""
          />,
          document.body
        )}
    </div>
  )
}

/** 선택 항목 파라미터 일괄 적용 — vibe: 강도/정보, charref: 타입/강도/충실도 */
function BulkParamsDialog({
  kind,
  count,
  onApply,
  onClose
}: {
  kind: 'vibe' | 'charref'
  count: number
  onApply: (patch: Record<string, unknown>) => void
  onClose: () => void
}): React.JSX.Element {
  const [strength, setStrength] = useState(0.6)
  const [info, setInfo] = useState(0.7)
  const [fidelity, setFidelity] = useState(0.5)
  const [refType, setRefType] = useState<CharRefType>('character')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-4">
        <DialogTitle className="mb-1">파라미터 일괄 적용</DialogTitle>
        <p className="mb-3 text-[12px] text-muted">선택한 {count}개에 아래 값을 적용합니다.</p>
        <div className="flex flex-col gap-2.5">
          {kind === 'charref' && (
            <ParamRow label="타입">
              <Select value={refType} onValueChange={(v) => setRefType(v as CharRefType)}>
                <SelectTrigger className="h-7 flex-1 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHARREF_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ParamRow>
          )}
          <ParamRow label={`강도 ${strength.toFixed(2)}`}>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[strength]}
              onValueChange={([v]) => setStrength(Math.round(v * 100) / 100)}
            />
          </ParamRow>
          {kind === 'vibe' ? (
            <ParamRow label={`정보 ${info.toFixed(2)}`}>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[info]}
                onValueChange={([v]) => setInfo(Math.round(v * 100) / 100)}
              />
            </ParamRow>
          ) : (
            <ParamRow label={`충실도 ${fidelity.toFixed(2)}`}>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[fidelity]}
                onValueChange={([v]) => setFidelity(Math.round(v * 100) / 100)}
              />
            </ParamRow>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="accent"
            onClick={() =>
              onApply(
                kind === 'vibe'
                  ? { strength, infoExtracted: info }
                  : { refType, strength, fidelity }
              )
            }
          >
            적용
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ParamRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11.5px] text-muted">{label}</span>
      {children}
    </div>
  )
}

function VibeParams({
  item,
  update
}: {
  item: VibeItem
  update: (id: number, patch: Record<string, unknown>) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <ParamRow label={`강도 ${item.strength.toFixed(2)}`}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[item.strength]}
          onValueChange={([v]) => update(item.id, { strength: Math.round(v * 100) / 100 })}
        />
      </ParamRow>
      <ParamRow label={`정보 ${item.infoExtracted.toFixed(2)}`}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[item.infoExtracted]}
          onValueChange={([v]) => update(item.id, { infoExtracted: Math.round(v * 100) / 100 })}
        />
      </ParamRow>
      {!item.encodedReady && (
        <p className="text-[10.5px] text-faint">생성 시 인코딩 (2 Anlas, 이후 캐시)</p>
      )}
    </div>
  )
}

function CharRefParams({
  item,
  update
}: {
  item: CharRefItem
  update: (id: number, patch: Record<string, unknown>) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <ParamRow label="타입">
        <Select
          value={item.refType}
          onValueChange={(v) => update(item.id, { refType: v as CharRefType })}
        >
          <SelectTrigger className="h-7 flex-1 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHARREF_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ParamRow>
      <ParamRow label={`강도 ${item.strength.toFixed(2)}`}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[item.strength]}
          onValueChange={([v]) => update(item.id, { strength: Math.round(v * 100) / 100 })}
        />
      </ParamRow>
      <ParamRow label={`충실도 ${item.fidelity.toFixed(2)}`}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[item.fidelity]}
          onValueChange={([v]) => update(item.id, { fidelity: Math.round(v * 100) / 100 })}
        />
      </ParamRow>
    </div>
  )
}

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
import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { modelCapabilities } from '@shared/nai-models'
import {
  baseReferenceType,
  clampReferenceStrength,
  preferSameOutfit,
  referenceTypeBadge,
  referenceTypeForModel,
  referenceTypeOptions,
  withBaseReferenceType,
  withPreferSameOutfit,
  type BaseReferenceType
} from '@shared/precise-reference'
import type { CharRefItem, CharRefType, VibeItem } from '@shared/types'
import { useGenerationStore } from '../stores/generation-store'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { applyClickSelection, useSelectAllShortcut } from '../lib/edit-selection'
import { buildDisplayRows } from '../lib/folder-list'
import { isLeavingDropZone, useDragEndCleanup } from '../lib/drop-zone'
import { REFERENCE_TYPE_LABELS, refsStoreFor } from '../stores/refs-store'
import { askConfirm, askText } from '../stores/dialog-store'
import { DropOverlay } from './drop-overlay'
import { FolderListView } from './folder-list-view'
import { Button } from './ui/button'
import { ToolbarIconButton, ToolbarIconGroup } from './ui/toolbar-icon-button'
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
  const t = useT()
  const model = useGenerationStore((s) => s.request.model)
  const store = refsStoreFor(kind)
  const setOverlayOpen = store((s) => s.setOverlayOpen)
  const folders = store((s) => s.folders)
  const items = store((s) => s.items)
  const add = store((s) => s.add)
  const addFrom = store((s) => s.addFrom)
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

  // 이미지 드롭 — 외부 파일 또는 히스토리·씬 썸네일(내부 드래그 nais/file-path)
  const [dragOver, setDragOver] = useState(false)
  useDragEndCleanup(useCallback(() => setDragOver(false), []))
  const acceptsDrag = (e: React.DragEvent): boolean =>
    e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('nais/file-path')
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const internalPath = e.dataTransfer.getData('nais/file-path')
    if (internalPath) void addFrom({ filePaths: [internalPath] })
    else void addFrom({ files: [...(e.dataTransfer.files ?? [])] })
  }

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
      !(await askConfirm(t('ui.deleteSelected'), {
        message: t('ui.deletesValueSelectedItems', selected.size),
        confirmLabel: t('ui.delete'),
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
              checked ? 'border-accent bg-accent text-on-accent' : 'border-line'
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
            {item.name || <span className="text-faint">{t('ui.unnamed')}</span>}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-faint">
            {kind === 'vibe'
              ? `s${(item as VibeItem).strength.toFixed(2)}`
              : referenceTypeBadge((item as CharRefItem).refType)}
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
          {item.name || <span className="text-faint">{t('ui.unnamed')}</span>}
        </button>
        {/* 바이브 인코딩 완료 표시 — 채워진 점=인코딩됨, 빈 점=생성 시 인코딩 예정 */}
        {kind === 'vibe' && (
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              (item as VibeItem).encodedModels?.includes(model)
                ? 'bg-success'
                : 'border border-faint'
            )}
            title={
              (item as VibeItem).encodedModels?.includes(model)
                ? t('ui.encodedForCurrentModel')
                : t('ui.notEncodedForCurrentModel2AnlasOnGenerate')
            }
          />
        )}
        <span className="shrink-0 font-mono text-[10px] text-faint">
          {kind === 'vibe'
            ? `s${(item as VibeItem).strength.toFixed(2)}`
            : referenceTypeBadge((item as CharRefItem).refType)}
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
            placeholder={t('ui.nameOptional')}
            onChange={(e) => update(item.id, { name: e.target.value })}
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:text-danger-ink"
            title={t('ui.delete')}
            onClick={() => remove(item.id)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
        {kind === 'vibe' ? (
          <VibeParams item={item as VibeItem} model={model} update={update} />
        ) : (
          <CharRefParams item={item as CharRefItem} model={model} update={update} />
        )}
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full flex-col gap-2"
      onDragOver={(e) => {
        if (!acceptsDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (isLeavingDropZone(e)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
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
        <span className="text-[13px] font-medium">
          {kind === 'vibe' ? t('ui.vibeTransfer') : t('ui.characterReference')}
        </span>
        {enabledCount > 0 && (
          <span className="rounded-full bg-accent-soft px-1.5 font-mono text-[10.5px] text-accent-ink">
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
            placeholder={t('ui.search')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* 툴바 — 왼쪽 절반은 아이콘 버튼이 1/n씩, 오른쪽 절반은 추가 버튼 */}
      <div className="grid grid-cols-2 gap-1.5">
        <ToolbarIconGroup>
          <ToolbarIconButton
            icon={<FolderPlus size={17} />}
            label={t('ui.addFolder')}
            onClick={() => void createFolder(t('ui.newFolder'))}
          />
          <ToolbarIconButton
            icon={<CheckSquare size={17} />}
            label={t('ui.editMode')}
            pressed={editMode}
            hint={t('ui.editModeMultiSelectClickToToggleShiftClickForRangeCtrlAForAll')}
            onClick={toggleEditMode}
          />
        </ToolbarIconGroup>
        <Button variant="accent" onClick={() => void add(null)}>
          <ImagePlus size={16} /> {t('ui.add')}
        </Button>
      </div>

      {/* 편집 모드 일괄 작업 바 — 검색 아래 */}
      {editMode && (
        <div className="flex flex-wrap items-center gap-1 border-b border-line pb-2 text-[12px]">
          <span className="text-muted">{t('ui.valueItems', selected.size)}</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(visibleIds))}>
            {t('ui.all')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            {t('ui.clear')}
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            disabled={selected.size === 0}
            onClick={() => void bulkDuplicate()}
          >
            <Copy size={12} /> {t('ui.duplicate')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            disabled={selected.size === 0}
            onClick={() => setBulkParamsOpen(true)}
          >
            <SlidersHorizontal size={12} /> {t('ui.parameters')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-danger-ink hover:text-danger-ink"
            disabled={selected.size === 0}
            onClick={() => void bulkDelete()}
          >
            <Trash2 size={12} /> {t('ui.delete')}
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
                  const name = await askText(t('ui.rename'), byId.get(row.id)?.name ?? '')
                  if (name != null) update(row.id, { name })
                }}
              >
                <Pencil size={13} /> {t('ui.rename')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem danger onSelect={() => remove(row.id)}>
                <Trash2 size={13} /> {t('ui.delete')}
              </ContextMenuItem>
            </>
          )}
          emptyText={items.length === 0 ? t('ui.addAnImageToGetStarted') : t('ui.noSearchResults')}
        />
      </div>

      <DropOverlay
        show={dragOver}
        icon={ImagePlus}
        label={
          kind === 'vibe'
            ? t('ui.dropHereToAddAsVibeReference')
            : t('ui.dropHereToAddAsCharacterReference')
        }
        sub={t('ui.safelyStoredAsCopies')}
      />

      {bulkParamsOpen && (
        <BulkParamsDialog
          kind={kind}
          model={model}
          count={selected.size}
          onApply={(patch) => {
            // 인코딩만 있는 바이브는 IE를 바꿀 수 없다 — 나머지 값만 적용
            const withoutInfo = Object.fromEntries(
              Object.entries(patch).filter(([key]) => key !== 'infoExtracted')
            )
            for (const id of selected) {
              const item = byId.get(id)
              update(id, item && 'encodedOnly' in item && item.encodedOnly ? withoutInfo : patch)
            }
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

/** 선택 항목 파라미터 일괄 적용 — vibe: 강도/정보, charref: 타입/강도/충실도(모델이 지원할 때) */
function BulkParamsDialog({
  kind,
  model,
  count,
  onApply,
  onClose
}: {
  kind: 'vibe' | 'charref'
  model: string
  count: number
  onApply: (patch: Record<string, unknown>) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const capabilities = modelCapabilities(model)
  const strengthMax = kind === 'charref' ? capabilities.characterReferenceStrengthMax : 1
  const [strength, setStrength] = useState(0.6)
  const [info, setInfo] = useState(0.7)
  const [fidelity, setFidelity] = useState(0.5)
  const [refType, setRefType] = useState<CharRefType>('character')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-4">
        <DialogTitle className="mb-1">{t('ui.bulkApplyParameters')}</DialogTitle>
        <p className="mb-3 text-[12px] text-muted">
          {t('ui.appliesTheValuesBelowToValueSelectedItems', count)}
        </p>
        <div className="flex flex-col gap-2.5">
          {kind === 'charref' && (
            <ReferenceTypeControls model={model} value={refType} onChange={setRefType} />
          )}
          <ParamRow label={t('ui.strengthValue', strength.toFixed(2))}>
            <Slider
              min={0}
              max={strengthMax}
              step={0.05}
              value={[strength]}
              onValueChange={([v]) => setStrength(Math.round(v * 100) / 100)}
            />
          </ParamRow>
          {kind === 'vibe' ? (
            <ParamRow label={t('ui.infoValue', info.toFixed(2))}>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[info]}
                onValueChange={([v]) => setInfo(Math.round(v * 100) / 100)}
              />
            </ParamRow>
          ) : (
            capabilities.characterReferenceFidelity && (
              <ParamRow label={t('ui.fidelityValue', fidelity.toFixed(2))}>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[fidelity]}
                  onValueChange={([v]) => setFidelity(Math.round(v * 100) / 100)}
                />
              </ParamRow>
            )
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button
            variant="accent"
            onClick={() =>
              onApply(
                kind === 'vibe'
                  ? { strength, infoExtracted: info }
                  : capabilities.characterReferenceFidelity
                    ? { refType, strength, fidelity }
                    : { refType, strength }
              )
            }
          >
            {t('ui.apply')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 레퍼런스 타입 선택 + (V5) 같은 의상 우선 토글. 토글은 타입 값 자체를 바꾼다:
 * Character ↔ character_mainoutfit, Character & Style ↔ character&style_anyoutfit.
 */
function ReferenceTypeControls({
  model,
  value,
  onChange
}: {
  model: string
  value: CharRefType
  onChange: (value: CharRefType) => void
}): React.JSX.Element {
  const t = useT()
  const base = baseReferenceType(value)
  const options = referenceTypeOptions(model)
  // 지금 모델이 고를 수 없는 타입(V4.5의 Outfit, 예전 Delta)도 현재 값이면 보이게 둔다
  if (!options.includes(base)) options.push(base)
  const prefer = modelCapabilities(model).outfitReferences ? preferSameOutfit(value) : null
  const skipped = referenceTypeForModel(value, model) === null
  return (
    <>
      <ParamRow label={t('ui.type')}>
        <Select
          value={base}
          onValueChange={(v) => onChange(withBaseReferenceType(value, v as BaseReferenceType))}
        >
          <SelectTrigger className="h-7 flex-1 text-[12px]" aria-label={t('ui.type')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {t(REFERENCE_TYPE_LABELS[option])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ParamRow>
      {prefer !== null && (
        <label className="flex items-center justify-between gap-2 text-[11.5px] text-muted">
          {t('ui.preferSameOutfit')}
          <Switch
            checked={prefer}
            aria-label={t('ui.preferSameOutfit')}
            onCheckedChange={(on) => onChange(withPreferSameOutfit(value, on))}
          />
        </label>
      )}
      {skipped && (
        <p className="text-[10.5px] text-danger-ink">{t('ui.outfitReferenceUnsupported')}</p>
      )}
    </>
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
  model,
  update
}: {
  item: VibeItem
  model: string
  update: (id: number, patch: Record<string, unknown>) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-1.5">
      <ParamRow label={t('ui.strengthValue', item.strength.toFixed(2))}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[item.strength]}
          onValueChange={([v]) => update(item.id, { strength: Math.round(v * 100) / 100 })}
        />
      </ParamRow>
      <ParamRow label={t('ui.infoValue', item.infoExtracted.toFixed(2))}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[item.infoExtracted]}
          // 메타데이터에서 복원한 바이브는 원본이 없어 재인코딩 불가 — IE를 바꾸면 쓸 수 없게 된다
          disabled={item.encodedOnly}
          onValueChange={([v]) => update(item.id, { infoExtracted: Math.round(v * 100) / 100 })}
        />
      </ParamRow>
      {item.encodedOnly ? (
        <p className="text-[10.5px] text-faint">{t('ui.metadataVibeNoSourceImage')}</p>
      ) : (
        !item.encodedModels?.includes(model) && (
          <p className="text-[10.5px] text-faint">
            {t('ui.encodesOnGenerate2AnlasCachedAfterward')}
          </p>
        )
      )}
    </div>
  )
}

function CharRefParams({
  item,
  model,
  update
}: {
  item: CharRefItem
  model: string
  update: (id: number, patch: Record<string, unknown>) => void
}): React.JSX.Element {
  const t = useT()
  const capabilities = modelCapabilities(model)
  // 저장값은 그대로 두고, 모델 상한을 넘는 값(V5 → V4.5 전환)은 보내는 값과 같게 잘라 보여준다
  const strength = clampReferenceStrength(item.strength, model)
  return (
    <div className="flex flex-col gap-1.5">
      <ReferenceTypeControls
        model={model}
        value={item.refType}
        onChange={(refType) => update(item.id, { refType })}
      />
      <ParamRow label={t('ui.strengthValue', strength.toFixed(2))}>
        <Slider
          min={0}
          max={capabilities.characterReferenceStrengthMax}
          step={0.05}
          value={[strength]}
          onValueChange={([v]) => update(item.id, { strength: Math.round(v * 100) / 100 })}
        />
      </ParamRow>
      {capabilities.characterReferenceFidelity && (
        <ParamRow label={t('ui.fidelityValue', item.fidelity.toFixed(2))}>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[item.fidelity]}
            onValueChange={([v]) => update(item.id, { fidelity: Math.round(v * 100) / 100 })}
          />
        </ParamRow>
      )}
    </div>
  )
}

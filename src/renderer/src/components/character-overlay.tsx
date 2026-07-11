import {
  CheckSquare,
  Copy,
  Crosshair,
  FolderPlus,
  ImageOff,
  ImagePlus,
  Pencil,
  Plus,
  Search,
  TextCursorInput,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharacterCard } from '@shared/types'
import { cn } from '../lib/utils'
import { applyClickSelection, useSelectAllShortcut } from '../lib/edit-selection'
import { buildDisplayRows } from '../lib/folder-list'
import { useCharactersStore, MAX_CHARACTERS } from '../stores/characters-store'
import { useGenerationStore } from '../stores/generation-store'
import { askConfirm, askText } from '../stores/dialog-store'
import { FolderListView } from './folder-list-view'
import { PromptEditor } from './prompt-editor'
import { ContextMenuItem, ContextMenuSeparator } from './ui/context-menu'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Switch } from './ui/switch'

/** NAI 웹의 5×5 수동 배치 그리드 (실캡처: 0.1~0.9) */
const GRID = [0.1, 0.3, 0.5, 0.7, 0.9]

function PositionPicker({
  center,
  onPick
}: {
  center: { x: number; y: number }
  onPick: (center: { x: number; y: number }) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-5 gap-0.5">
      {GRID.map((y) =>
        GRID.map((x) => (
          <button
            key={`${x}-${y}`}
            className={cn(
              'size-6 rounded-[4px] border border-line transition-colors',
              center.x === x && center.y === y ? 'bg-accent' : 'bg-paper'
            )}
            title={`(${x}, ${y})`}
            onClick={() => onPick({ x, y })}
          />
        ))
      )}
    </div>
  )
}

export function CharacterOverlay(): React.JSX.Element {
  const setOverlayOpen = useCharactersStore((s) => s.setOverlayOpen)
  const folders = useCharactersStore((s) => s.folders)
  const items = useCharactersStore((s) => s.items)
  const createCard = useCharactersStore((s) => s.createCard)
  const updateCard = useCharactersStore((s) => s.updateCard)
  const disableAll = useCharactersStore((s) => s.disableAll)
  const removeCard = useCharactersStore((s) => s.removeCard)
  const duplicateCard = useCharactersStore((s) => s.duplicateCard)
  const pickThumbnail = useCharactersStore((s) => s.pickThumbnail)
  const clearThumbnail = useCharactersStore((s) => s.clearThumbnail)
  const createFolder = useCharactersStore((s) => s.createFolder)
  const renameFolder = useCharactersStore((s) => s.renameFolder)
  const toggleCollapse = useCharactersStore((s) => s.toggleCollapse)
  const setFolderColor = useCharactersStore((s) => s.setFolderColor)
  const removeFolder = useCharactersStore((s) => s.removeFolder)
  const move = useCharactersStore((s) => s.move)
  const useCoords = useGenerationStore((s) => s.request.useCoords)
  const patch = useGenerationStore((s) => s.patchRequest)

  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  // 편집 모드 — 다중 선택 (일반 클릭=교체, Ctrl=토글, Shift=구간, Ctrl+A=전체)
  const [editMode, setEditMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkPromptOpen, setBulkPromptOpen] = useState(false)
  const anchorRef = useRef<number | null>(null)
  const toggleEditMode = (): void => {
    setEditMode((v) => !v)
    setSelected(new Set())
    setExpandedId(null)
    anchorRef.current = null
  }
  /** 썸네일 호버 미리보기 — 카드 오른쪽 바깥에 고정 위치로 (카드 내용을 가리지 않게) */
  const [hoverPreview, setHoverPreview] = useState<{
    src: string
    top: number
    left: number
  } | null>(null)

  const showPreview = (e: React.MouseEvent, src: string): void => {
    const card = (e.currentTarget as HTMLElement).closest('[data-char-card]')
    if (!card) return
    const rect = card.getBoundingClientRect()
    const size = 176
    const top = Math.max(
      8,
      Math.min(rect.top + rect.height / 2 - size / 2, window.innerHeight - size - 8)
    )
    setHoverPreview({ src, top, left: rect.right + 10 })
  }

  const searching = search.trim().length > 0
  const rows = useMemo(() => {
    const all = buildDisplayRows(folders, items)
    if (!searching) return all
    const q = search.trim().toLowerCase()
    return all.filter(
      (r) =>
        r.type === 'item' &&
        (r.item.name.toLowerCase().includes(q) || r.item.prompt.toLowerCase().includes(q))
    )
  }, [folders, items, searching, search])

  const enabledCount = items.filter((c) => c.enabled && c.prompt.trim()).length

  // 화면에 보이는 순서의 카드 id들 (Shift 구간/Ctrl+A 기준)
  const visibleIds = useMemo(
    () => rows.flatMap((r) => (r.type === 'item' && !r.hidden ? [r.item.id] : [])),
    [rows]
  )
  useSelectAllShortcut(editMode, () => setSelected(new Set(visibleIds)))
  const selectItem = (id: number, e: React.MouseEvent): void =>
    setSelected((prev) => applyClickSelection(prev, visibleIds, id, e, anchorRef))

  const bulkDelete = async (): Promise<void> => {
    if (
      !(await askConfirm('선택 삭제', {
        message: `선택한 캐릭터 ${selected.size}개를 삭제합니다.`,
        confirmLabel: '삭제',
        danger: true
      }))
    )
      return
    for (const id of selected) removeCard(id)
    setSelected(new Set())
  }
  const bulkDuplicate = async (): Promise<void> => {
    for (const id of visibleIds.filter((id) => selected.has(id))) await duplicateCard(id)
    setSelected(new Set())
  }

  // 기본 프롬프트 + 캐릭터 프롬프트가 512 토큰을 합산 공유 (공홈 실측)
  const basePrompt = useGenerationStore((s) => s.request.prompt)
  const positiveTexts = useMemo(
    () =>
      [
        basePrompt,
        ...items.filter((c) => c.enabled && c.prompt.trim()).map((c) => c.prompt)
      ].filter((t) => t.trim()),
    [basePrompt, items]
  )
  const [charTokens, setCharTokens] = useState<number | null>(null)
  useEffect(() => {
    if (positiveTexts.length === 0) {
      const timer = setTimeout(() => setCharTokens(null))
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      void window.nais.invoke('tokens:count', { texts: positiveTexts }).then(({ counts }) => {
        // 공홈은 캡션별 EOS를 각각 포함해 그대로 합산
        setCharTokens(counts.reduce((a, b) => a + b, 0))
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [positiveTexts])

  // 편집 모드 헤더 — 선택 전용 행 (스위치/좌표 등 상호작용 제거)
  const renderHeaderEdit = (char: CharacterCard): React.ReactNode => {
    const checked = selected.has(char.id)
    return (
      <div
        className="flex h-10 cursor-pointer select-none items-center gap-2 px-2"
        onClick={(e) => selectItem(char.id, e)}
      >
        <span
          className={cn(
            'grid size-4 shrink-0 place-items-center rounded border-2',
            checked ? 'border-accent bg-accent text-white' : 'border-line'
          )}
        >
          {checked && <span className="text-[9px] leading-none">✓</span>}
        </span>
        {char.thumbnail ? (
          <img
            src={`data:image/webp;base64,${char.thumbnail}`}
            className="size-8 shrink-0 rounded-md object-cover"
            alt=""
            draggable={false}
          />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2 text-faint">
            <UserRound size={15} strokeWidth={1.5} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
          {char.name || char.prompt.slice(0, 40) || <span className="text-faint">빈 캐릭터</span>}
        </span>
      </div>
    )
  }

  const renderHeader = (char: CharacterCard): React.ReactNode => (
    <div
      data-char-card
      className={cn('flex h-10 items-center gap-2 px-2', !char.enabled && 'opacity-55')}
    >
      <Switch checked={char.enabled} onCheckedChange={(v) => updateCard(char.id, { enabled: v })} />
      {char.thumbnail ? (
        <img
          src={`data:image/webp;base64,${char.thumbnail}`}
          className="size-8 shrink-0 rounded-md object-cover"
          alt=""
          onMouseEnter={(e) => showPreview(e, char.thumbnail)}
          onMouseLeave={() => setHoverPreview(null)}
        />
      ) : (
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2 text-faint">
          <UserRound size={15} strokeWidth={1.5} />
        </div>
      )}
      <button
        className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
        title="눌러서 수정"
        onClick={() => setExpandedId((prev) => (prev === char.id ? null : char.id))}
      >
        {char.name || char.prompt.slice(0, 40) || <span className="text-faint">빈 캐릭터</span>}
      </button>
      {useCoords && char.enabled && (
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 font-mono text-[11px]">
              <Crosshair size={13} />
              {char.center.x},{char.center.y}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto">
            <PositionPicker
              center={char.center}
              onPick={(c) => updateCard(char.id, { center: c })}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )

  const renderExpanded = (char: CharacterCard): React.ReactNode => (
    <div className="flex flex-col gap-1.5 px-2 pb-2">
      <div className="flex gap-1.5">
        <Input
          className="h-8 flex-1 bg-surface-2 text-[12.5px]"
          value={char.name}
          placeholder="이름"
          onChange={(e) => updateCard(char.id, { name: e.target.value })}
        />
        {/* F12: 썸네일이 있으면 "이미지 제거"로 (옆의 캐릭터 삭제와 구분되게 이미지 아이콘 명시) */}
        {char.thumbnail ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1 px-2 text-[12px] hover:text-danger"
            title="캐릭터 썸네일 제거"
            onClick={() => void clearThumbnail(char.id)}
          >
            <ImageOff size={14} /> 제거
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1 px-2 text-[12px]"
            onClick={() => void pickThumbnail(char.id)}
          >
            <ImagePlus size={14} /> 이미지
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 hover:text-danger"
          title="캐릭터 삭제"
          onClick={() => removeCard(char.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      {/* resize-y: 우하단 핸들로 세로 크기 조절. 초기 크기 상향 (F11) */}
      <PromptEditor
        className="h-40 max-h-[520px] min-h-20 resize-y bg-surface-2"
        value={char.prompt}
        placeholder="girl, ..."
        onValueChange={(v) => updateCard(char.id, { prompt: v })}
      />
      <PromptEditor
        negative
        className="h-24 max-h-96 min-h-14 resize-y bg-surface-2"
        value={char.negativePrompt}
        placeholder="캐릭터 네거티브"
        onValueChange={(v) => updateCard(char.id, { negativePrompt: v })}
      />
    </div>
  )

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
        <span className="text-[13px] font-medium">캐릭터</span>
        {enabledCount > 0 && (
          <span
            className={cn(
              'rounded-full px-1.5 font-mono text-[10.5px]',
              enabledCount >= MAX_CHARACTERS
                ? 'bg-danger/15 text-danger'
                : 'bg-accent-soft text-accent'
            )}
            title={`활성 캐릭터 ${enabledCount}/${MAX_CHARACTERS} (NAI는 6명까지)`}
          >
            {enabledCount}/{MAX_CHARACTERS}
          </span>
        )}
        {enabledCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            title="활성 캐릭터 전체 해제"
            onClick={disableAll}
          >
            전체 해제
          </Button>
        )}
        {charTokens !== null && (
          <span
            className={cn(
              'font-mono text-[10.5px]',
              charTokens > 512 ? 'text-danger' : 'text-faint'
            )}
            title="기본 프롬프트 + 캐릭터 프롬프트 합산 (512 토큰 공유)"
          >
            {charTokens}/512
          </span>
        )}
        <div className="flex-1" />
        <label
          className="flex items-center gap-1.5 text-[11.5px] text-muted"
          title="끄면 AI's Choice (NAI가 위치 결정)"
        >
          위치 지정
          <Switch checked={useCoords} onCheckedChange={(v) => patch({ useCoords: v })} />
        </label>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            className="pl-7"
            value={search}
            placeholder="이름·프롬프트 검색"
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
        <Button size="sm" variant="accent" className="gap-1" onClick={() => void createCard(null)}>
          <Plus size={13} /> 캐릭터
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
            onClick={() => setBulkPromptOpen(true)}
          >
            <TextCursorInput size={12} /> 프롬프트 주입
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
          // 헤더가 item 밖 상태(좌표 토글/편집 선택)에 의존 — 바뀌면 카드 리렌더
          renderKey={editMode ? selected : useCoords}
          folderActions={{
            rename: renameFolder,
            toggleCollapse,
            setColor: setFolderColor,
            remove: removeFolder,
            addItem: (folderId) => void createCard(folderId)
          }}
          onMove={move}
          itemClassName={(char) =>
            cn(
              'transition-colors hover:border-muted/60', // F2: 호버 강조
              editMode
                ? selected.has(char.id) && 'border-accent ring-1 ring-accent/40'
                : char.enabled && 'border-accent/60 bg-accent-soft' // F3: 활성 강조
            )
          }
          renderHeader={editMode ? renderHeaderEdit : renderHeader}
          renderExpanded={renderExpanded}
          itemContextMenu={(char) => (
            <>
              <ContextMenuItem
                onSelect={async () => {
                  const name = await askText('이름 변경', char.name)
                  if (name != null) updateCard(char.id, { name })
                }}
              >
                <Pencil size={13} /> 이름 변경
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void duplicateCard(char.id)}>
                <Copy size={13} /> 복제
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem danger onSelect={() => removeCard(char.id)}>
                <Trash2 size={13} /> 삭제
              </ContextMenuItem>
            </>
          )}
          emptyText={items.length === 0 ? '캐릭터를 추가해보세요' : '검색 결과 없음'}
        />
      </div>

      {bulkPromptOpen && (
        <BulkPromptDialog
          count={selected.size}
          onApply={(pos, neg) => {
            const byIdCard = new Map(items.map((c) => [c.id, c]))
            for (const id of selected) {
              const card = byIdCard.get(id)
              if (!card) continue
              updateCard(id, {
                ...(pos ? { prompt: appendBelow(card.prompt, pos) } : {}),
                ...(neg ? { negativePrompt: appendBelow(card.negativePrompt, neg) } : {})
              })
            }
            setBulkPromptOpen(false)
          }}
          onClose={() => setBulkPromptOpen(false)}
        />
      )}

      {hoverPreview &&
        createPortal(
          <img
            src={`data:image/webp;base64,${hoverPreview.src}`}
            className="pointer-events-none fixed z-50 size-44 rounded-lg border border-line object-cover shadow-2xl"
            style={{ top: hoverPreview.top, left: hoverPreview.left }}
            alt=""
          />,
          document.body
        )}
    </div>
  )
}

/** 기존 프롬프트 하단(새 줄)에 이어붙임 — 비어 있으면 그대로 */
function appendBelow(base: string, add: string): string {
  const b = base.trimEnd()
  const a = add.trim()
  if (!b) return a
  return `${b}\n${a}`
}

/** 선택 캐릭터들의 프롬프트 하단에 일괄 주입 */
function BulkPromptDialog({
  count,
  onApply,
  onClose
}: {
  count: number
  onApply: (positive: string, negative: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [positive, setPositive] = useState('')
  const [negative, setNegative] = useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-4">
        <DialogTitle className="mb-1">프롬프트 일괄 주입</DialogTitle>
        <p className="mb-3 text-[12px] text-muted">
          선택한 캐릭터 {count}개의 프롬프트 하단(새 줄)에 이어붙입니다. 빈 칸은 건너뜁니다.
        </p>
        <div className="flex flex-col gap-2">
          <div>
            <p className="mb-1 text-[11.5px] text-muted">포지티브에 추가</p>
            <PromptEditor
              className="h-24 min-h-16 resize-y bg-surface-2"
              value={positive}
              tokensOverride={null}
              placeholder="예: smile, looking at viewer"
              onValueChange={setPositive}
            />
          </div>
          <div>
            <p className="mb-1 text-[11.5px] text-muted">네거티브에 추가</p>
            <PromptEditor
              className="h-20 min-h-16 resize-y bg-surface-2"
              value={negative}
              tokensOverride={null}
              placeholder="(선택)"
              onValueChange={setNegative}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="accent"
            disabled={!positive.trim() && !negative.trim()}
            onClick={() => onApply(positive, negative)}
          >
            적용
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

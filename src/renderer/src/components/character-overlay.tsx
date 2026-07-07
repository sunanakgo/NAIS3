import { Crosshair, FolderPlus, ImagePlus, Plus, Search, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CharacterCard } from '@shared/types'
import { cn } from '../lib/utils'
import { buildDisplayRows } from '../lib/folder-list'
import { useCharactersStore, MAX_CHARACTERS } from '../stores/characters-store'
import { useGenerationStore } from '../stores/generation-store'
import { FolderListView } from './folder-list-view'
import { PromptEditor } from './prompt-editor'
import { Button } from './ui/button'
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
  const pickThumbnail = useCharactersStore((s) => s.pickThumbnail)
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
  /** 썸네일 호버 미리보기 — 카드 오른쪽 바깥에 고정 위치로 (카드 내용을 가리지 않게) */
  const [hoverPreview, setHoverPreview] = useState<{ src: string; top: number; left: number } | null>(
    null
  )

  const showPreview = (e: React.MouseEvent, src: string): void => {
    const card = (e.currentTarget as HTMLElement).closest('[data-char-card]')
    if (!card) return
    const rect = card.getBoundingClientRect()
    const size = 176
    const top = Math.max(8, Math.min(rect.top + rect.height / 2 - size / 2, window.innerHeight - size - 8))
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

  // 기본 프롬프트 + 캐릭터 프롬프트가 512 토큰을 합산 공유 (공홈 실측)
  const basePrompt = useGenerationStore((s) => s.request.prompt)
  const positiveTexts = useMemo(
    () =>
      [basePrompt, ...items.filter((c) => c.enabled && c.prompt.trim()).map((c) => c.prompt)].filter(
        (t) => t.trim()
      ),
    [basePrompt, items]
  )
  const [charTokens, setCharTokens] = useState<number | null>(null)
  useEffect(() => {
    if (positiveTexts.length === 0) {
      setCharTokens(null)
      return
    }
    const timer = setTimeout(() => {
      void window.nais.invoke('tokens:count', { texts: positiveTexts }).then(({ counts }) => {
        // 공홈은 캡션별 EOS를 각각 포함해 그대로 합산
        setCharTokens(counts.reduce((a, b) => a + b, 0))
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [positiveTexts])

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
        onClick={() => setExpandedId(expandedId === char.id ? null : char.id)}
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
            <PositionPicker center={char.center} onPick={(c) => updateCard(char.id, { center: c })} />
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
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 px-2 text-[12px]"
          onClick={() => void pickThumbnail(char.id)}
        >
          <ImagePlus size={14} /> 이미지
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 hover:text-danger"
          title="삭제"
          onClick={() => removeCard(char.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <PromptEditor
        className="h-28 bg-surface-2"
        value={char.prompt}
        placeholder="girl, ..."
        onValueChange={(v) => updateCard(char.id, { prompt: v })}
      />
      <PromptEditor
        negative
        className="h-16 bg-surface-2"
        value={char.negativePrompt}
        placeholder="캐릭터 네거티브"
        onValueChange={(v) => updateCard(char.id, { negativePrompt: v })}
      />
    </div>
  )

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" title="닫기" onClick={() => setOverlayOpen(false)}>
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
        <Button size="sm" variant="ghost" title="폴더 추가" onClick={() => void createFolder('새 폴더')}>
          <FolderPlus size={14} />
        </Button>
        <Button size="sm" variant="accent" className="gap-1" onClick={() => void createCard(null)}>
          <Plus size={13} /> 캐릭터
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
            addItem: (folderId) => void createCard(folderId)
          }}
          onMove={move}
          renderHeader={renderHeader}
          renderExpanded={renderExpanded}
          emptyText={items.length === 0 ? '캐릭터를 추가해보세요' : '검색 결과 없음'}
        />
      </div>

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

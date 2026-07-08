import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { pickPresetParams, usePromptPresetsStore } from '../stores/prompt-presets-store'
import { useGenerationStore } from '../stores/generation-store'
import { askConfirm, askText } from '../stores/dialog-store'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { SortableList, SortableRow } from './sortable-list'
import { cn } from '../lib/utils'

/**
 * 프롬프트 프리셋 드롭다운 (씬 프리셋과 동일 UX).
 * - 새 프리셋: 빈 프롬프트로 시작 (씬 프리셋처럼)
 * - 활성 프리셋: 메인 프롬프트/네거티브 편집이 자동 저장됨 (NAIS2 방식)
 */
export function PromptPresetBar(): React.JSX.Element {
  const presets = usePromptPresetsStore((s) => s.presets)
  const loaded = usePromptPresetsStore((s) => s.loaded)
  const activeId = usePromptPresetsStore((s) => s.activeId)
  const setActive = usePromptPresetsStore((s) => s.setActive)
  const load = usePromptPresetsStore((s) => s.load)
  const create = usePromptPresetsStore((s) => s.create)
  const update = usePromptPresetsStore((s) => s.update)
  const remove = usePromptPresetsStore((s) => s.remove)
  const reorder = usePromptPresetsStore((s) => s.reorder)
  const request = useGenerationStore((s) => s.request)
  const currentPrompt = request.prompt
  const currentNegative = request.negativePrompt
  const patch = useGenerationStore((s) => s.patchRequest)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // 활성 프리셋에 편집 자동 저장 (디바운스) — 프롬프트 + 파라미터(스텝·CFG 등).
  // 프리셋 적용 직후엔 같은 값이라 no-op
  const syncTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!loaded || activeId == null) return
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => {
      const p = usePromptPresetsStore.getState().presets.find((x) => x.id === activeId)
      if (!p) return
      const params = pickPresetParams(useGenerationStore.getState().request)
      if (
        p.prompt !== currentPrompt ||
        p.negativePrompt !== currentNegative ||
        JSON.stringify(p.params) !== JSON.stringify(params)
      ) {
        void update(activeId, { prompt: currentPrompt, negativePrompt: currentNegative, params })
      }
    }, 500)
    return () => clearTimeout(syncTimer.current)
  }, [request, currentPrompt, currentNegative, activeId, loaded, update])

  const active = presets.find((p) => p.id === activeId)

  const apply = (id: number): void => {
    const p = presets.find((x) => x.id === id)
    if (!p) return
    // 파라미터도 함께 복원 (구버전 프리셋은 params 없음 — 프롬프트만)
    patch({ prompt: p.prompt, negativePrompt: p.negativePrompt, ...(p.params ?? {}) })
    setActive(id)
    // 닫기를 한 틱 미뤄 dnd/Radix의 같은 이벤트 처리에 덮이지 않게 (B9)
    setTimeout(() => setOpen(false), 0)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="no-drag flex h-8 w-full items-center gap-1.5 rounded-md border border-line bg-surface-2/50 px-2.5 text-[13px] font-medium hover:bg-surface-2">
          <span className="min-w-0 flex-1 truncate text-left">
            {active?.name ?? '프롬프트 프리셋'}
          </span>
          <ChevronDown size={14} className="shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
        <div className="max-h-72 overflow-y-auto overflow-x-hidden no-scrollbar">
          {presets.length === 0 ? (
            <p className="px-2 py-3 text-center text-[12px] text-faint">저장된 프리셋 없음</p>
          ) : (
            // 드래그로 순서 변경
            <SortableList ids={presets.map((p) => p.id)} onReorder={(ids) => void reorder(ids)}>
              {presets.map((p) => (
                <SortableRow key={p.id} id={p.id} className="group gap-1" onTap={() => apply(p.id)}>
                  <div
                    onClick={() => apply(p.id)}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                      p.id === activeId && 'font-semibold text-accent'
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                  </div>
                  <button
                    className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-ink group-hover:opacity-100"
                    onClick={async () => {
                      const name = await askText('프리셋 이름', p.name)
                      if (name) void update(p.id, { name })
                    }}
                    title="이름 변경"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
                    onClick={async () => {
                      if (await askConfirm(`"${p.name}" 프리셋을 삭제할까요?`, { danger: true }))
                        void remove(p.id)
                    }}
                    title="삭제"
                  >
                    <Trash2 size={12} />
                  </button>
                </SortableRow>
              ))}
            </SortableList>
          )}
        </div>
        <div className="my-1 h-px bg-line" />
        <button
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-accent hover:bg-surface-2"
          onClick={async () => {
            const name = await askText('새 프리셋 이름', '새 프리셋')
            if (!name?.trim()) return
            const id = await create(
              name.trim(),
              '',
              '',
              pickPresetParams(useGenerationStore.getState().request)
            )
            // 빈 칸으로 시작 — 이후 편집이 이 프리셋에 자동 저장
            patch({ prompt: '', negativePrompt: '' })
            setActive(id)
            setOpen(false)
          }}
        >
          <Plus size={14} /> 새 프리셋
        </button>
      </PopoverContent>
    </Popover>
  )
}

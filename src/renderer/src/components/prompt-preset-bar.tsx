import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  normalizePresetParts,
  partsForApply,
  pickPresetParams,
  presetParamsForApply,
  shouldSyncPromptPreset,
  splitPromptForPreset,
  usePromptPresetsStore
} from '../stores/prompt-presets-store'
import { useGenerationStore } from '../stores/generation-store'
import { askConfirm, askText } from '../stores/dialog-store'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { SortableList, SortableRow } from './sortable-list'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'

/** 활성 프리셋에 현재 편집 저장 — 실제 변경이 있을 때만 (자동 저장과 복제 전 즉시 반영이 공유) */
async function syncActivePromptPreset(): Promise<void> {
  const { presets, activeId, update } = usePromptPresetsStore.getState()
  const p = presets.find((x) => x.id === activeId)
  if (!p) return
  const gen = useGenerationStore.getState()
  // 저장된 파라미터를 불러오기 전의 기본 요청을 활성 프리셋에 쓰지 않는다
  if (!gen.hydrated) return
  const { prompt, negativePrompt } = gen.request
  const params = pickPresetParams(gen.request)
  // 3분할 켜진 동안만 조각을 프리셋에 저장 — 꺼져 있으면 저장된 조각을 건드리지 않음
  const promptParts = gen.promptSplitEnabled
    ? normalizePresetParts(gen.request.promptParts)
    : undefined
  if (shouldSyncPromptPreset(p, { prompt, negativePrompt, params, promptParts })) {
    await update(p.id, {
      prompt,
      negativePrompt,
      params,
      ...(promptParts !== undefined ? { promptParts } : {})
    })
  }
}

/**
 * 프롬프트 프리셋 드롭다운 (씬 프리셋과 동일 UX).
 * - 새 프리셋: 빈 프롬프트로 시작 (씬 프리셋처럼)
 * - 활성 프리셋: 메인 프롬프트/네거티브 편집이 자동 저장됨 (NAIS2 방식)
 */
export function PromptPresetBar(): React.JSX.Element {
  const t = useT()
  const presets = usePromptPresetsStore((s) => s.presets)
  const loaded = usePromptPresetsStore((s) => s.loaded)
  const activeId = usePromptPresetsStore((s) => s.activeId)
  const setActive = usePromptPresetsStore((s) => s.setActive)
  const load = usePromptPresetsStore((s) => s.load)
  const create = usePromptPresetsStore((s) => s.create)
  const update = usePromptPresetsStore((s) => s.update)
  const remove = usePromptPresetsStore((s) => s.remove)
  const duplicate = usePromptPresetsStore((s) => s.duplicate)
  const reorder = usePromptPresetsStore((s) => s.reorder)
  const request = useGenerationStore((s) => s.request)
  const hydrated = useGenerationStore((s) => s.hydrated)
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
    // 저장된 파라미터를 불러오기 전의 기본 요청을 활성 프리셋에 쓰지 않는다
    if (!loaded || !hydrated || activeId == null) return
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => void syncActivePromptPreset(), 500)
    return () => clearTimeout(syncTimer.current)
  }, [request, currentPrompt, currentNegative, activeId, loaded, hydrated, update])

  const active = presets.find((p) => p.id === activeId)

  const apply = (id: number): void => {
    // 복제 직후에도 찾을 수 있게 store의 최신 목록에서 조회
    const p = usePromptPresetsStore.getState().presets.find((x) => x.id === id)
    if (!p) return
    setOpen(false) // 먼저 닫기 (B9)
    // 활성 프리셋을 먼저 바꿔야 이전 프리셋이 적용값으로 자동 저장되는 레이스가 없다.
    setActive(id)
    // 파라미터도 함께 복원 — 저장되지 않은 필드는 직전 프리셋 값 대신 기본값으로.
    // 3분할 조각은 프리셋에 저장된 것을 복원 (없거나 낡았으면 prompt를 base로 재시드)
    patch({
      prompt: p.prompt,
      promptParts: partsForApply(p),
      negativePrompt: p.negativePrompt,
      ...presetParamsForApply(p.params, request.model)
    })
  }

  // 복제 후 사본을 선택·적용 (새 프리셋 만들기와 같은 흐름). 사본으로 넘어가면 활성 프리셋의
  // 대기 중인 편집이 버려지므로 어느 프리셋을 복제하든 먼저 저장한다 (활성 프리셋 복제면 사본에도 반영)
  const duplicatePreset = async (id: number): Promise<void> => {
    clearTimeout(syncTimer.current)
    await syncActivePromptPreset()
    const newId = await duplicate(id)
    if (newId != null) apply(newId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="no-drag flex h-8 w-full items-center gap-1.5 rounded-md border border-line bg-surface-2/50 px-2.5 text-[13px] font-medium hover:bg-surface-2">
          <span className="min-w-0 flex-1 truncate text-left">
            {active?.name ?? t('ui.promptPresets')}
          </span>
          <ChevronDown size={14} className="shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
        <div className="max-h-72 overflow-y-auto overflow-x-hidden no-scrollbar">
          {presets.length === 0 ? (
            <p className="px-2 py-3 text-center text-[12px] text-faint">{t('ui.noSavedPresets')}</p>
          ) : (
            // 드래그로 순서 변경
            <SortableList ids={presets.map((p) => p.id)} onReorder={(ids) => void reorder(ids)}>
              {presets.map((p) => (
                <SortableRow key={p.id} id={p.id} className="group gap-1" onTap={() => apply(p.id)}>
                  <div
                    onClick={() => apply(p.id)}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                      p.id === activeId && 'font-semibold text-accent-ink'
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                  </div>
                  <button
                    className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={async () => {
                      const name = await askText(t('ui.presetName'), p.name)
                      if (name) void update(p.id, { name })
                    }}
                    title={t('ui.rename')}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => void duplicatePreset(p.id)}
                    title={t('ui.duplicate')}
                    aria-label={t('ui.duplicate')}
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-danger-ink focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={async () => {
                      if (await askConfirm(t('ui.deletePresetValue', p.name), { danger: true }))
                        void remove(p.id)
                    }}
                    title={t('ui.delete')}
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
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-accent-ink hover:bg-surface-2"
          onClick={async () => {
            const name = await askText(t('ui.newPresetName'), t('ui.newPreset'))
            if (!name?.trim()) return
            const id = await create(
              name.trim(),
              '',
              '',
              pickPresetParams(useGenerationStore.getState().request)
            )
            // 빈 칸으로 시작 — 이후 편집이 이 프리셋에 자동 저장
            setActive(id)
            patch({ prompt: '', promptParts: splitPromptForPreset(''), negativePrompt: '' })
            setOpen(false)
          }}
        >
          <Plus size={14} /> {t('ui.newPreset')}
        </button>
      </PopoverContent>
    </Popover>
  )
}

import { History, Trash2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { KindBadge } from '../lib/kind-icon'
import { useGenerationStore } from '../stores/generation-store'
import { useLayoutStore } from '../stores/layout-store'
import { askConfirm } from '../stores/dialog-store'
import { toast } from '../stores/toast-store'
import { ImageContextMenu } from './image-context-menu'

export function HistoryPanel(): React.JSX.Element {
  const t = useT()
  const history = useGenerationStore((s) => s.history)
  const historyTotal = useGenerationStore((s) => s.historyTotal)
  const viewingFilePath = useGenerationStore((s) => s.viewingFilePath)
  const view = useGenerationStore((s) => s.view)
  const refreshHistory = useGenerationStore((s) => s.refreshHistory)
  const setCenterMode = useLayoutStore((s) => s.setCenterMode)

  const deleteOne = async (id: number, filePath: string): Promise<void> => {
    await window.nais.invoke('images:delete', { id })
    if (viewingFilePath === filePath) view(null)
    void refreshHistory()
  }

  const clearAll = async (): Promise<void> => {
    const ok = await askConfirm(t('ui.clearAllHistory'), {
      message: t(
        'ui.clearsValueGenerationRecordsIncludingSceneGalleriesImageFilesInT1cb5e46',
        historyTotal.toLocaleString()
      ),
      confirmLabel: t('ui.clearAll'),
      danger: true
    })
    if (!ok) return
    const { count } = await window.nais.invoke('images:clearAll', undefined)
    view(null)
    void refreshHistory()
    toast(t('ui.clearedValueRecordsFilesPreserved', count.toLocaleString()), 'success')
  }

  return (
    <aside className="flex h-full w-[240px] flex-col rounded-xl border border-line bg-surface">
      {/* 헤더는 창 드래그 영역 */}
      <div className="drag flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <History size={14} className="text-muted" />
        <span className="text-[13px] font-medium">{t('ui.history')}</span>
        <span className="ml-auto font-mono text-[11px] text-faint">{historyTotal}</span>
        {historyTotal > 0 && (
          <button
            className="no-drag grid size-6 place-items-center rounded text-faint transition-colors hover:text-danger"
            title={t('ui.clearAll')}
            onClick={() => void clearAll()}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {/* 스크롤바 숨김(공간 0) → 좌우 p-1.5 완전 대칭. 트랙패드/휠로 스크롤 */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
        {history.length === 0 ? (
          <p className="mt-8 text-center text-[12px] text-faint">{t('ui.nothingYet')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {history.map((item) => (
              <ImageContextMenu
                key={item.id}
                filePath={item.filePath}
                onDelete={() => void deleteOne(item.id, item.filePath)}
              >
                <button
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-md border border-line bg-paper transition-all',
                    viewingFilePath === item.filePath && 'ring-2 ring-accent'
                  )}
                  title={`seed ${item.seed ?? '?'}`}
                  onClick={() => {
                    view(item.filePath)
                    setCenterMode('main') // 씬/디렉터 페이지에서도 클릭 시 메인으로 이동해 원본 표시
                  }}
                >
                  {item.thumbnail && (
                    <img
                      src={`data:image/webp;base64,${item.thumbnail}`}
                      className="size-full object-cover"
                      // 프리뷰로 드래그해서 메타데이터 열기
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('nais/file-path', item.filePath)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      alt=""
                    />
                  )}
                  <KindBadge kind={item.kind} />
                  {/* 호버 삭제 — 기록만 삭제 (파일 보존) */}
                  <span
                    role="button"
                    className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur transition hover:bg-danger group-hover:opacity-100"
                    title={t('ui.removeFromHistoryFilePreserved')}
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteOne(item.id, item.filePath)
                    }}
                  >
                    <Trash2 size={12} />
                  </span>
                </button>
              </ImageContextMenu>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

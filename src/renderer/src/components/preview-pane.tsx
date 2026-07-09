import { ImageIcon, Loader2, Lock, LockOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { imageUrl } from '../lib/constants'
import { useGenerationStore } from '../stores/generation-store'
import { useMetadataStore } from '../stores/metadata-store'
import { cn } from '../lib/utils'
import { DropOverlay } from './drop-overlay'
import { ImageContextMenu } from './image-context-menu'

export function PreviewPane(): React.JSX.Element {
  const previewPng = useGenerationStore((s) => s.previewPng)
  const progress = useGenerationStore((s) => s.progress)
  const viewingFilePath = useGenerationStore((s) => s.viewingFilePath)
  const queue = useGenerationStore((s) => s.queue)
  const genStartAt = useGenerationStore((s) => s.genStartAt)
  const avgDurationMs = useGenerationStore((s) => s.avgDurationMs)

  const viewPinned = useGenerationStore((s) => s.viewPinned)
  const generating = queue?.items.some((i) => i.state === 'generating') ?? false
  const preparing = generating && !progress // 스텝 진행 전 = 준비 중(인코딩 등)

  // 생성 중엔 스트리밍 프레임 우선 — 단, 유저가 다른 이미지를 클릭(고정 보기)하면 그 파일 우선 (B11)
  const streamShown = generating && previewPng != null && !viewPinned
  const src = streamShown
    ? `data:image/png;base64,${previewPng}`
    : viewingFilePath
      ? imageUrl(viewingFilePath)
      : previewPng
        ? `data:image/png;base64,${previewPng}`
        : null

  const showMeta = useMetadataStore((s) => s.show)
  const seedLocked = useGenerationStore((s) => s.seedLocked)
  const requestSeed = useGenerationStore((s) => s.request.seed)
  const setSeedLocked = useGenerationStore((s) => s.setSeedLocked)
  const patchRequest = useGenerationStore((s) => s.patchRequest)
  const view = useGenerationStore((s) => s.view)
  const [dragOver, setDragOver] = useState(false)

  // 보고 있는 완성작의 해상도·시드 (하단 반투명 칩) — 파일이 바뀌면 메타데이터 로드
  const [info, setInfo] = useState<{ width?: number; height?: number; seed?: number } | null>(null)
  useEffect(() => {
    setInfo(null)
    if (!viewingFilePath) return
    let alive = true
    void window.nais
      .invoke('images:readMetadata', { filePath: viewingFilePath })
      .then((r) => {
        if (alive && 'meta' in r) setInfo({ width: r.meta.width, height: r.meta.height, seed: r.meta.seed })
      })
    return () => {
      alive = false
    }
  }, [viewingFilePath])

  const pct =
    progress && progress.totalSteps > 0
      ? Math.min(100, Math.round((progress.stepIx / progress.totalSteps) * 100))
      : 0

  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl border bg-surface p-2 transition-colors',
        dragOver ? 'border-accent' : 'border-line'
      )}
      onDragOver={(e) => {
        // 외부 파일 또는 히스토리 썸네일(내부 드래그) 둘 다 허용
        if (
          e.dataTransfer.types.includes('Files') ||
          e.dataTransfer.types.includes('nais/file-path')
        ) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        // 히스토리 썸네일 드래그 → 해당 이미지 메타데이터
        const internalPath = e.dataTransfer.getData('nais/file-path')
        if (internalPath) {
          void showMeta({ filePath: internalPath })
          return
        }
        const file = e.dataTransfer.files?.[0]
        if (!file?.type.startsWith('image/')) return
        const reader = new FileReader()
        reader.onload = (ev) => {
          const base64 = (ev.target?.result as string) ?? ''
          void showMeta({ base64 })
        }
        reader.readAsDataURL(file)
      }}
    >
      {/* 상단 스트립을 창 드래그 영역으로 (이미지 위쪽) */}
      <div className="drag absolute inset-x-0 top-0 z-20 h-6" />
      {src ? (
        // 긴 쪽이 박스 테두리에 닿도록 꽉 채움 (object-contain으로 비율 유지).
        // 완성작(파일)이 표시 중일 때만 우클릭 메뉴 — 스트리밍 미리보기(previewPng)는 파일이 아님
        !streamShown && viewingFilePath ? (
          <ImageContextMenu filePath={viewingFilePath}>
            <img
              src={src}
              className="h-full w-full rounded-md object-contain"
              draggable={false}
              // 파일이 밖에서 지워진 경우 깨진 이미지 대신 빈 상태로 (B8)
              onError={() => view(null)}
              alt=""
            />
          </ImageContextMenu>
        ) : (
          <img src={src} className="h-full w-full rounded-md object-contain" draggable={false} alt="" />
        )
      ) : generating ? (
        <div className="flex flex-col items-center gap-3 text-muted">
          <Loader2 size={38} className="animate-spin text-accent" strokeWidth={2} />
          <span className="text-[13px]">생성 준비 중…</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-faint">
          <ImageIcon size={40} strokeWidth={1.2} />
          <span className="text-[13px]">생성된 이미지가 여기 표시됩니다</span>
        </div>
      )}

      {generating && !viewingFilePath && (
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-line bg-paper/85 px-4 py-1.5 backdrop-blur">
          {preparing ? (
            <Loader2 size={14} className="animate-spin text-accent" />
          ) : (
            <div className="h-1.5 w-36 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <span className="font-mono text-[11px] text-muted">
            {preparing ? '준비 중' : `${progress?.stepIx}/${progress?.totalSteps}`}
          </span>
          <Eta startAt={genStartAt} avgMs={avgDurationMs} />
        </div>
      )}

      {/* 해상도·시드 칩 — 완성작(파일)이 표시 중일 때 (생성 중이라도 고정 보기면 표시). 시드 클릭=고정 토글 */}
      {viewingFilePath && !streamShown && info && (info.width || info.seed != null) && (
        <div className="absolute bottom-3 left-3 flex flex-col items-start gap-0.5 rounded-md bg-paper/35 px-2.5 py-1 font-mono text-[11px] leading-tight text-muted opacity-70 backdrop-blur-sm transition hover:bg-paper/90 hover:text-ink hover:opacity-100">
          {info.width && info.height && (
            <span>
              {info.width}×{info.height}
            </span>
          )}
          {info.seed != null && (
            <button
              className={cn(
                'flex items-center gap-1 rounded transition-colors',
                seedLocked && requestSeed === info.seed ? 'text-accent' : 'hover:text-ink'
              )}
              title={
                seedLocked && requestSeed === info.seed
                  ? '시드 고정됨 — 클릭하면 해제'
                  : '클릭하면 이 시드로 고정'
              }
              onClick={() => {
                if (seedLocked && requestSeed === info.seed) {
                  setSeedLocked(false)
                } else {
                  patchRequest({ seed: info.seed! })
                  setSeedLocked(true)
                }
              }}
            >
              {seedLocked && requestSeed === info.seed ? <Lock size={11} /> : <LockOpen size={11} />}
              {info.seed}
            </button>
          )}
        </div>
      )}

      <DropOverlay
        show={dragOver}
        icon={ImageIcon}
        label="여기 놓으면 메타데이터를 불러옵니다"
        sub="프롬프트·설정을 확인하고 선택 적용"
      />
    </div>
  )
}

/** 이전 기록 기반 남은 시간 표시 (매초 갱신) */
function Eta({ startAt, avgMs }: { startAt: number | null; avgMs: number | null }): React.JSX.Element | null {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [])
  if (!startAt || !avgMs) return null
  const remaining = Math.max(0, avgMs - (Date.now() - startAt))
  const sec = Math.ceil(remaining / 1000)
  return (
    <span className="border-l border-line pl-2.5 font-mono text-[11px] text-faint">
      {sec > 0 ? `~${sec}초` : '곧 완료'}
    </span>
  )
}

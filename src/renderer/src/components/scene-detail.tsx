import { ArrowLeft, Minus, Plus, Star, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Scene } from '@shared/types'
import { imageUrl } from '../lib/constants'
import { ResolutionPicker } from './resolution-picker'
import { useGenerationStore } from '../stores/generation-store'
import { useScenesStore } from '../stores/scenes-store'
import { cn } from '../lib/utils'
import { ImageContextMenu } from './image-context-menu'
import { Lightbox } from './lightbox'
import { PromptEditor } from './prompt-editor'
import { Button } from './ui/button'

export function SceneDetail({ scene }: { scene: Scene }): React.JSX.Element {
  const select = useScenesStore((s) => s.select)
  const update = useScenesStore((s) => s.update)
  const adjustReserve = useScenesStore((s) => s.adjustReserve)
  const images = useScenesStore((s) => s.images)
  const imagesTotal = useScenesStore((s) => s.imagesTotal)
  const imagesLoading = useScenesStore((s) => s.imagesLoading)
  const loadImages = useScenesStore((s) => s.loadImages)
  const toggleFavorite = useScenesStore((s) => s.toggleFavorite)
  const deleteImage = useScenesStore((s) => s.deleteImage)

  const source = useGenerationStore((s) => s.source)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(3)
  const [lightboxIdx, setLightboxIdx] = useState(-1)

  // 무한 스크롤 — 바닥 근처 도달 시 다음 페이지 (전부 로드하지 않음)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && images.length < imagesTotal && !imagesLoading) {
          void loadImages(scene.id, false)
        }
      },
      { rootMargin: '800px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [scene.id, images.length, imagesTotal, imagesLoading, loadImages])


  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-surface">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Button size="sm" variant="ghost" className="gap-1" onClick={() => select(null)}>
          <ArrowLeft size={15} /> 씬 목록
        </Button>
        <input
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 text-[15px] font-medium outline-none focus:bg-surface-2"
          value={scene.name}
          onChange={(e) => void update(scene.id, { name: e.target.value })}
        />
        <ResolutionPicker
          className="w-48"
          disabled={!!source}
          width={scene.width}
          height={scene.height}
          onPick={(width, height) => void update(scene.id, { width, height })}
        />
        {/* 예약 +/- */}
        <div className="flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
          <button
            className="grid size-6 place-items-center rounded-full text-muted hover:bg-paper disabled:opacity-30"
            disabled={scene.reserveCount === 0}
            onClick={() => void adjustReserve(scene.id, -1)}
          >
            <Minus size={14} />
          </button>
          <span className="min-w-6 text-center text-[13px] font-semibold">
            {scene.reserveCount}
          </span>
          <button
            className="grid size-6 place-items-center rounded-full text-muted hover:bg-paper"
            onClick={() => void adjustReserve(scene.id, 1)}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {source && (
        <p className="border-b border-line bg-surface-2 px-3 py-1 text-[11px] text-muted">
          i2i/인페인트 소스가 설정돼 있어 씬 해상도 대신 소스 해상도({source.width}×{source.height})로
          생성됩니다.
        </p>
      )}

      {/* 스크롤 영역: 프롬프트 + 생성 이미지. scrollbar-gutter로 스크롤바 등장/소멸 시 밀림 방지 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 no-scrollbar">
        <div className="grid gap-2">
          <PromptEditor
            value={scene.prompt}
            onValueChange={(v) => void update(scene.id, { prompt: v })}
            placeholder="씬 프롬프트"
            className="min-h-[96px]"
          />
          <PromptEditor
            value={scene.negativePrompt}
            onValueChange={(v) => void update(scene.id, { negativePrompt: v })}
            placeholder="씬 네거티브 프롬프트"
            negative
            className="min-h-[64px]"
          />
        </div>

        <div className="mt-4 mb-2 flex items-center gap-2 text-[12px] text-muted">
          <span className="font-medium text-fg">생성된 이미지</span>
          <span>{imagesTotal.toLocaleString()}장</span>
          <div className="flex-1" />
          <div className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setCols(n)}
                className={cn(
                  'grid h-5 w-5 place-items-center rounded text-[11px] font-medium',
                  cols === n ? 'bg-paper text-ink' : 'text-muted hover:text-ink'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {images.length === 0 && !imagesLoading ? (
          <p className="py-10 text-center text-[13px] text-faint">
            아직 생성된 이미지가 없습니다. 위에서 예약(+)하고 좌측 생성 버튼을 누르세요.
          </p>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {images.map((img, i) => (
              <ImageContextMenu
                key={img.id}
                filePath={img.filePath}
                onDelete={() => void deleteImage(img.id)}
              >
              <div
                className="group relative overflow-hidden rounded-md bg-surface-2"
                style={{ aspectRatio: `${scene.width} / ${scene.height}` }}
              >
                <img
                  src={imageUrl(img.filePath)}
                  className="h-full w-full cursor-pointer object-cover"
                  loading="lazy"
                  draggable={false}
                  onClick={() => setLightboxIdx(i)}
                  alt=""
                />
                <button
                  className={cn(
                    'absolute left-1 top-1 grid size-6 place-items-center rounded-full backdrop-blur transition',
                    img.favorite
                      ? 'bg-amber-400/90 text-black'
                      : 'bg-black/40 text-white opacity-0 group-hover:opacity-100'
                  )}
                  onClick={() => void toggleFavorite(img.id)}
                  title="즐겨찾기"
                >
                  <Star size={13} fill={img.favorite ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur transition hover:bg-danger group-hover:opacity-100"
                  onClick={() => void deleteImage(img.id)}
                  title="삭제"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              </ImageContextMenu>
            ))}
          </div>
        )}
        <div ref={sentinelRef} className="h-4" />
        {imagesLoading && <p className="py-3 text-center text-[12px] text-faint">불러오는 중…</p>}
      </div>

      {lightboxIdx >= 0 && (
        <Lightbox
          filePaths={images.map((i) => i.filePath)}
          index={lightboxIdx}
          onIndex={setLightboxIdx}
          onClose={() => setLightboxIdx(-1)}
        />
      )}
    </div>
  )
}

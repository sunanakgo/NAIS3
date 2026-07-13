import { ArrowLeft, Loader2, Minus, Play, Plus, Star, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Scene } from '@shared/types'
import { imageUrl } from '../lib/constants'
import { ResolutionPicker } from './resolution-picker'
import { useGenerationStore } from '../stores/generation-store'
import { useScenesStore, appendPrompt } from '../stores/scenes-store'
import { useCharactersStore } from '../stores/characters-store'
import { askConfirm } from '../stores/dialog-store'
import { toast } from '../stores/toast-store'
import { cn } from '../lib/utils'
import { ImageContextMenu } from './image-context-menu'
import { Lightbox } from './lightbox'
import { PromptEditor } from './prompt-editor'
import { Button } from './ui/button'

export function SceneDetail({ scene }: { scene: Scene }): React.JSX.Element {
  const select = useScenesStore((s) => s.select)
  const update = useScenesStore((s) => s.update)
  const adjustReserve = useScenesStore((s) => s.adjustReserve)
  const casts = useScenesStore((s) => s.casts)
  const activeCastId = useScenesStore((s) => s.activeCastId)
  const activeCast = casts.find((c) => c.id === activeCastId) ?? null
  const images = useScenesStore((s) => s.images)
  const imagesTotal = useScenesStore((s) => s.imagesTotal)
  const imagesLoading = useScenesStore((s) => s.imagesLoading)
  const loadImages = useScenesStore((s) => s.loadImages)
  const toggleFavorite = useScenesStore((s) => s.toggleFavorite)
  const deleteImage = useScenesStore((s) => s.deleteImage)
  const generateOne = useScenesStore((s) => s.generateOne)
  const favoritesOnly = useScenesStore((s) => s.favoritesOnly)
  const setFavoritesOnly = useScenesStore((s) => s.setFavoritesOnly)
  const deleteNonFavorites = useScenesStore((s) => s.deleteNonFavorites)

  const source = useGenerationStore((s) => s.source)
  const basePrompt = useGenerationStore((s) => s.request.prompt)
  const baseNegative = useGenerationStore((s) => s.request.negativePrompt)
  const charItems = useCharactersStore((s) => s.items)
  const previewPng = useGenerationStore((s) => s.previewPng)
  const generatingSceneId = useGenerationStore(
    (s) => s.queue?.items.find((i) => i.state === 'generating')?.request.sceneId ?? null
  )
  const streaming = generatingSceneId === scene.id
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(3)
  const [lightboxIdx, setLightboxIdx] = useState(-1)

  // F1 튐 방지: 스트리밍 마지막 프레임을 붙들었다가 완성본이 로드되면 교체.
  // 스트리밍 시작 시점의 최상단 이미지 id를 기록 → 그와 다른 새 이미지가 로드되면 프레임 해제.
  const [heldFrame, setHeldFrame] = useState<string | null>(null)
  const baselineTopId = useRef<number | null>(null)
  useEffect(() => {
    if (streaming) baselineTopId.current = images[0]?.id ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming])
  useEffect(() => {
    if (streaming && previewPng) setHeldFrame(previewPng)
  }, [streaming, previewPng])
  // 안전장치: 씬이 바뀌면 프레임 리셋 / 스트리밍 끝난 뒤 새 이미지가 안 오면 6초 후 해제
  useEffect(() => setHeldFrame(null), [scene.id])
  useEffect(() => {
    if (streaming || !heldFrame) return
    const t = setTimeout(() => setHeldFrame(null), 6000)
    return () => clearTimeout(t)
  }, [streaming, heldFrame])
  // 스트리밍이 끝났는데 아직 새 이미지가 안 들어왔으면 프레임 유지, 들어와 로드되면 해제
  const newTop =
    !streaming && heldFrame && images[0] && images[0].id !== baselineTopId.current
      ? images[0]
      : null
  const showTile = streaming || heldFrame != null

  // F9: 씬 에디터 토큰 수를 base(메인)+씬 합산으로 표시 — 실제 전송은 base 뒤에 씬을 붙이므로
  const [sceneTokens, setSceneTokens] = useState<{ pos: number | null; neg: number | null }>({
    pos: null,
    neg: null
  })
  useEffect(() => {
    const enabled = charItems.filter((c) => c.enabled && c.prompt.trim())
    const posTexts = [
      appendPrompt(basePrompt, scene.prompt),
      ...enabled.map((c) => c.prompt)
    ].filter((t) => t.trim())
    const negText = appendPrompt(baseNegative, scene.negativePrompt)
    const negTexts = negText.trim() ? [negText] : []
    if (posTexts.length === 0 && negTexts.length === 0) {
      setSceneTokens({ pos: null, neg: null })
      return
    }
    const timer = setTimeout(() => {
      void window.nais
        .invoke('tokens:count', { texts: [...posTexts, ...negTexts] })
        .then(({ counts }) => {
          const sum = (a: number[]): number | null =>
            a.length === 0 ? null : a.reduce((x, y) => x + y, 0)
          setSceneTokens({
            pos: sum(counts.slice(0, posTexts.length)),
            neg: sum(counts.slice(posTexts.length))
          })
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [basePrompt, baseNegative, scene.prompt, scene.negativePrompt, charItems])

  // ESC로 씬 목록으로 (라이트박스가 열려 있으면 라이트박스만 닫힘)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (lightboxIdx >= 0) return
      select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIdx, select])

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
        {/* 바로 생성 — 예약 없이 이 씬 1장 (NAIS2식) */}
        <Button
          size="sm"
          variant="accent"
          className="gap-1"
          title="이 씬 1장 바로 생성"
          onClick={() => void generateOne(scene.id)}
        >
          <Play size={13} /> 생성
        </Button>
        {/* 예약 +/- — 현재 선택된 출연 기준 (씬 목록 카드와 동일) */}
        <div className="flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
          <button
            className="grid size-6 place-items-center rounded-full text-muted hover:bg-paper disabled:opacity-30"
            disabled={(scene.reserves[activeCastId] ?? 0) === 0}
            onClick={() => void adjustReserve(scene.id, -1)}
          >
            <Minus size={14} />
          </button>
          <span
            className={cn(
              'min-w-6 rounded-full px-1 text-center text-[13px] font-semibold',
              !activeCast && (scene.reserves[''] ?? 0) > 0 && 'bg-danger text-white'
            )}
            style={
              activeCast && (scene.reserves[activeCastId] ?? 0) > 0
                ? { backgroundColor: activeCast.color, color: '#fff' }
                : undefined
            }
            title={activeCast ? `"${activeCast.name}" 출연 예약` : '사이드바 설정 예약'}
          >
            {scene.reserves[activeCastId] ?? 0}
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
          i2i/인페인트 소스가 설정돼 있어 씬 해상도 대신 소스 해상도({source.width}×{source.height}
          )로 생성됩니다.
        </p>
      )}

      {/* 스크롤 영역: 프롬프트 + 생성 이미지. scrollbar-gutter로 스크롤바 등장/소멸 시 밀림 방지 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 no-scrollbar">
        <div className="grid gap-2">
          {/* resize-y: 우하단 핸들로 세로 크기 조절 (F10) */}
          <PromptEditor
            value={scene.prompt}
            onValueChange={(v) => void update(scene.id, { prompt: v })}
            placeholder="씬 프롬프트"
            tokensOverride={sceneTokens.pos}
            className="h-32 max-h-[520px] min-h-24 resize-y"
          />
          <PromptEditor
            value={scene.negativePrompt}
            onValueChange={(v) => void update(scene.id, { negativePrompt: v })}
            placeholder="씬 네거티브 프롬프트"
            negative
            tokensOverride={sceneTokens.neg}
            className="h-20 max-h-96 min-h-16 resize-y"
          />
        </div>

        <div className="mt-4 mb-2 flex items-center gap-2 text-[12px] text-muted">
          <span className="font-medium text-fg">생성된 이미지</span>
          <span>{imagesTotal.toLocaleString()}장</span>
          <div className="flex-1" />
          {/* 즐겨찾기만 보기 (N4) */}
          <button
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            className={cn(
              'flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors',
              favoritesOnly
                ? 'bg-amber-400/90 text-black'
                : 'bg-surface-2 text-muted hover:text-ink'
            )}
            title="즐겨찾기만 보기"
          >
            <Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} /> 즐겨찾기
          </button>
          {/* 즐겨찾기 제외 삭제 (N5) */}
          <button
            onClick={async () => {
              const ok = await askConfirm('즐겨찾기 제외 삭제', {
                message:
                  '이 씬에서 즐겨찾기하지 않은 이미지를 모두 삭제합니다 (파일 포함). 되돌릴 수 없습니다.',
                confirmLabel: '삭제',
                danger: true
              })
              if (!ok) return
              const n = await deleteNonFavorites(scene.id)
              toast(
                n > 0 ? `${n.toLocaleString()}장 삭제됨` : '삭제할 이미지가 없습니다',
                n > 0 ? 'success' : 'info'
              )
            }}
            className="flex h-6 items-center gap-1 rounded-md bg-surface-2 px-2 text-[11.5px] font-medium text-muted transition-colors hover:text-danger"
            title="즐겨찾기 제외 전체 삭제"
          >
            <Trash2 size={12} /> 정리
          </button>
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

        {images.length === 0 && !imagesLoading && !streaming ? (
          <p className="py-10 text-center text-[13px] text-faint">
            {favoritesOnly
              ? '즐겨찾기한 이미지가 없습니다.'
              : '아직 생성된 이미지가 없습니다. 위에서 예약(+)하고 좌측 생성 버튼을 누르세요.'}
          </p>
        ) : (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {/* F1: 스트리밍 타일 — 완성본이 로드될 때까지 마지막 프레임을 붙든다 (튐 방지) */}
            {showTile && (
              <div
                className="relative overflow-hidden rounded-md bg-surface-2 ring-2 ring-accent/50"
                style={{ aspectRatio: `${scene.width} / ${scene.height}` }}
              >
                {streaming && previewPng ? (
                  <img
                    src={`data:image/png;base64,${previewPng}`}
                    className="h-full w-full object-cover"
                    alt=""
                  />
                ) : heldFrame ? (
                  <img
                    src={`data:image/png;base64,${heldFrame}`}
                    className="h-full w-full object-cover"
                    alt=""
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center">
                    <Loader2 size={26} className="animate-spin text-accent" />
                  </div>
                )}
                {streaming && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    생성 중…
                  </span>
                )}
                {/* 완성본이 도착하면 숨겨서 미리 디코드 → 로드되는 순간 프레임 해제(끊김 없음) */}
                {newTop && (
                  <img
                    src={imageUrl(newTop.filePath)}
                    className="hidden"
                    onLoad={() => setHeldFrame(null)}
                    alt=""
                  />
                )}
              </div>
            )}
            {/* 프레임을 붙들고 있는 동안엔 완성본(최상단)을 중복 표시하지 않는다 */}
            {(newTop ? images.slice(1) : images).map((img, i) => (
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
                    // 라이브러리/프리뷰로 드래그해서 추가 (히스토리 썸네일과 동일)
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('nais/file-path', img.filePath)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => setLightboxIdx(newTop ? i + 1 : i)}
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

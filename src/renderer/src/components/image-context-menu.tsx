import {
  Copy,
  Download,
  FileText,
  FolderOpen,
  ImageIcon,
  Layers,
  Library,
  Palette,
  Trash2,
  Wand2
} from 'lucide-react'
import { toast } from '../stores/toast-store'
import { useArtistTagsStore } from '../stores/artist-tags-store'
import { openInDirector } from '../stores/director-store'
import { setI2iSource, useGenerationStore } from '../stores/generation-store'
import { addToLibrary } from '../stores/library-store'
import { useMetadataStore } from '../stores/metadata-store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from './ui/context-menu'

/**
 * 이미지 우클릭 공용 메뉴 — 히스토리·씬 상세 등 이미지가 나오는 모든 곳에서 동일하게 사용.
 * I2I / 인페인트 / 디렉터 툴 / 파일 탐색기.
 */
export function ImageContextMenu({
  filePath,
  onDelete,
  hideLibraryAdd,
  extra,
  children
}: {
  filePath: string
  /** 지정 시 메뉴에 '삭제' 표시 — 호스트가 삭제+목록 갱신을 처리 */
  onDelete?: () => void
  /** 라이브러리 자신의 카드에서는 "라이브러리에 추가" 숨김 (중복 추가 방지) */
  hideLibraryAdd?: boolean
  /** 호스트 전용 추가 항목 (라이브러리의 "스택에 추가" 등) — 삭제 위에 렌더 */
  extra?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const startInpaint = useGenerationStore((s) => s.startInpaintFromPath)
  const showMeta = useMetadataStore((s) => s.show)
  const showArtists = useArtistTagsStore((s) => s.show)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void setI2iSource(filePath)}>
          <ImageIcon size={13} className="text-indigo-400" /> I2I
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void startInpaint(filePath)}>
          <Layers size={13} className="text-pink-400" /> 인페인트
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void openInDirector(filePath)}>
          <Wand2 size={13} className="text-violet-400" /> 디렉터 툴에서 열기
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void showMeta({ filePath })}>
          <FileText size={13} className="text-sky-400" /> 메타데이터 보기
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void showArtists({ filePath })}>
          <Palette size={13} className="text-orange-400" /> 작가 태그 분석
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={async () => {
            const { copied } = await window.nais.invoke('images:copy', { filePath })
            if (copied) toast('클립보드에 복사됨', 'success')
          }}
        >
          <Copy size={13} className="text-teal-400" /> 이미지 복사
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void window.nais.invoke('images:saveAs', { filePath })}>
          <Download size={13} className="text-emerald-400" /> 다른 이름으로 저장
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void window.nais.invoke('images:showInFolder', { filePath })}
        >
          <FolderOpen size={13} className="text-amber-400" /> 파일 탐색기에서 보기
        </ContextMenuItem>
        {!hideLibraryAdd && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void addToLibrary([filePath])}>
              <Library size={13} className="text-fuchsia-400" /> 라이브러리에 추가
            </ContextMenuItem>
          </>
        )}
        {extra}
        {onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem danger onSelect={onDelete}>
              <Trash2 size={13} /> 삭제
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

import {
  Copy,
  Download,
  FileText,
  FolderOpen,
  ImageIcon,
  Layers,
  Library,
  Trash2,
  Wand2
} from 'lucide-react'
import { toast } from '../stores/toast-store'
import { useT } from '../lib/i18n'
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
  const t = useT()
  const startInpaint = useGenerationStore((s) => s.startInpaintFromPath)
  const showMeta = useMetadataStore((s) => s.show)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void setI2iSource(filePath)}>
          <ImageIcon size={13} className="text-indigo-400" /> I2I
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void startInpaint(filePath)}>
          <Layers size={13} className="text-pink-400" /> {t('ui.inpaint')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void openInDirector(filePath)}>
          <Wand2 size={13} className="text-violet-400" /> {t('ui.openInDirectorTools')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void showMeta({ filePath })}>
          <FileText size={13} className="text-sky-400" /> {t('ui.viewMetadata')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={async () => {
            const { copied } = await window.nais.invoke('images:copy', { filePath })
            if (copied) toast(t('ui.copiedToClipboard'), 'success')
          }}
        >
          <Copy size={13} className="text-teal-400" /> {t('ui.copyImage')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void window.nais.invoke('images:saveAs', { filePath })}>
          <Download size={13} className="text-emerald-400" /> {t('ui.saveAs')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void window.nais.invoke('images:showInFolder', { filePath })}
        >
          <FolderOpen size={13} className="text-amber-400" /> {t('ui.showInFileExplorer')}
        </ContextMenuItem>
        {!hideLibraryAdd && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void addToLibrary([filePath])}>
              <Library size={13} className="text-fuchsia-400" /> {t('ui.addToLibrary')}
            </ContextMenuItem>
          </>
        )}
        {extra}
        {onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem danger onSelect={onDelete}>
              <Trash2 size={13} /> {t('ui.delete')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

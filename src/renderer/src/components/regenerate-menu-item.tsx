import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { useGenerationStore } from '../stores/generation-store'
import {
  isGenerationActive,
  readImageMetadata,
  regenerateFromImage,
  type ImageMetadataResult
} from '../stores/regenerate'
import { ContextMenuItem } from './ui/context-menu'

/**
 * 이미지 메뉴의 "재생성" — 메뉴가 열릴 때(마운트) 메타데이터를 미리 읽어
 * 메타데이터가 없으면 비활성화한다. 생성 중에는 생성 버튼처럼 쓸 수 없다.
 */
export function RegenerateMenuItem({ filePath }: { filePath: string }): React.JSX.Element {
  const t = useT()
  const generating = useGenerationStore((s) => isGenerationActive(s.queue))
  const metadata = useRef<Promise<ImageMetadataResult> | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let current = true
    const pending = readImageMetadata(filePath).catch((e: unknown): ImageMetadataResult => ({
      error: e instanceof Error ? e.message : String(e)
    }))
    metadata.current = pending
    void pending.then((res) => {
      if (current) setUnavailable('error' in res)
    })
    return () => {
      current = false
    }
  }, [filePath])

  const hint = generating ? t('ui.generating') : unavailable ? t('ui.metadataNotFound') : null
  return (
    <ContextMenuItem
      disabled={generating || unavailable}
      className="data-[disabled]:opacity-50"
      title={t('ui.regenerateWithTheSameSettingsAndANewSeed')}
      onSelect={() => void regenerateFromImage(filePath, metadata.current ?? undefined)}
    >
      <RefreshCw size={13} className="text-hue-cyan" /> {t('ui.regenerate')}
      {hint && <span className="ml-auto pl-3 text-[11px] text-faint">{hint}</span>}
    </ContextMenuItem>
  )
}

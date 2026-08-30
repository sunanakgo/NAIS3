import {
  Droplets,
  Eraser,
  Film,
  Grid3x3,
  ImageIcon,
  Layers,
  Maximize2,
  MessageSquareText,
  Paintbrush,
  Pencil,
  PenTool,
  Smile,
  Sparkles,
  Wand2,
  type LucideIcon
} from 'lucide-react'
import type { MessageId } from '@shared/i18n'
import { useT } from './i18n'

/** 생성 종류별 아이콘·색 (NAIS2 히스토리 배지 계승). 디렉터는 툴별 아이콘/색을 director-mode와 일치 */
type KindMeta = { Icon: LucideIcon; className: string; label: MessageId }

const KIND_MAP: Record<string, KindMeta> = {
  t2i: { Icon: ImageIcon, className: 'text-amber-500', label: 'ui.t2i' },
  i2i: { Icon: Layers, className: 'text-indigo-400', label: 'ui.i2i' },
  inpaint: { Icon: Paintbrush, className: 'text-pink-400', label: 'ui.inpaint' },
  upscale: { Icon: Maximize2, className: 'text-purple-400', label: 'ui.upscale' },
  scene: { Icon: Film, className: 'text-emerald-400', label: 'ui.scene' },
  director: { Icon: Wand2, className: 'text-fuchsia-400', label: 'ui.director' },
  'bg-removal': { Icon: Eraser, className: 'text-rose-400', label: 'ui.removeBg' },
  lineart: { Icon: PenTool, className: 'text-sky-400', label: 'ui.lineArt' },
  sketch: { Icon: Pencil, className: 'text-amber-400', label: 'ui.sketch' },
  colorize: { Icon: Droplets, className: 'text-emerald-400', label: 'ui.colorize' },
  emotion: { Icon: Smile, className: 'text-fuchsia-400', label: 'ui.emotion' },
  declutter: { Icon: Sparkles, className: 'text-violet-400', label: 'ui.declutter' },
  'declutter-keep-bubbles': {
    Icon: MessageSquareText,
    className: 'text-violet-300',
    label: 'ui.declutter.85446fc'
  },
  mosaic: { Icon: Grid3x3, className: 'text-orange-400', label: 'ui.mosaic' }
}

export function kindMeta(kind: string): KindMeta {
  return KIND_MAP[kind] ?? KIND_MAP.t2i
}

/** 좌하단 배지 형태 (히스토리 썸네일·소스 배너 공용) */
export function KindBadge({ kind, size = 12 }: { kind: string; size?: number }): React.JSX.Element {
  const t = useT()
  const { Icon, className, label } = kindMeta(kind)
  return (
    <span
      className="pointer-events-none absolute bottom-1 left-1 grid place-items-center rounded bg-black/55 p-0.5 backdrop-blur-sm"
      title={t(label)}
    >
      <Icon size={size} className={className} />
    </span>
  )
}

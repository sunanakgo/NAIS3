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

/** 생성 종류별 아이콘·색 (NAIS2 히스토리 배지 계승). 디렉터는 툴별 아이콘/색을 director-mode와 일치 */
const KIND_MAP: Record<string, { Icon: LucideIcon; className: string; label: string }> = {
  t2i: { Icon: ImageIcon, className: 'text-amber-500', label: 't2i' },
  i2i: { Icon: Layers, className: 'text-indigo-400', label: 'i2i' },
  inpaint: { Icon: Paintbrush, className: 'text-pink-400', label: '인페인트' },
  upscale: { Icon: Maximize2, className: 'text-purple-400', label: '업스케일' },
  scene: { Icon: Film, className: 'text-emerald-400', label: '씬' },
  director: { Icon: Wand2, className: 'text-fuchsia-400', label: '디렉터' },
  'bg-removal': { Icon: Eraser, className: 'text-rose-400', label: '배경 제거' },
  lineart: { Icon: PenTool, className: 'text-sky-400', label: '라인아트' },
  sketch: { Icon: Pencil, className: 'text-amber-400', label: '스케치' },
  colorize: { Icon: Droplets, className: 'text-emerald-400', label: '색칠' },
  emotion: { Icon: Smile, className: 'text-fuchsia-400', label: '표정' },
  declutter: { Icon: Sparkles, className: 'text-violet-400', label: '정리' },
  'declutter-keep-bubbles': {
    Icon: MessageSquareText,
    className: 'text-violet-300',
    label: '정리+'
  },
  mosaic: { Icon: Grid3x3, className: 'text-orange-400', label: '모자이크' }
}

export function kindMeta(kind: string): { Icon: LucideIcon; className: string; label: string } {
  return KIND_MAP[kind] ?? KIND_MAP.t2i
}

/** 좌하단 배지 형태 (히스토리 썸네일·소스 배너 공용) */
export function KindBadge({ kind, size = 12 }: { kind: string; size?: number }): React.JSX.Element {
  const { Icon, className, label } = kindMeta(kind)
  return (
    <span
      className="pointer-events-none absolute bottom-1 left-1 grid place-items-center rounded bg-black/55 p-0.5 backdrop-blur-sm"
      title={label}
    >
      <Icon size={size} className={className} />
    </span>
  )
}

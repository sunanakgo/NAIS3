interface Rgb {
  r: number
  g: number
  b: number
}

function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  if (h.length === 8) h = h.slice(0, 6)
  const n = parseInt(h.padEnd(6, '0').slice(0, 6), 16)
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function toHex({ r, g, b }: Rgb): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  const lerp = (x: number, y: number): number => x + (y - x) * t
  return toHex({ r: lerp(ca.r, cb.r), g: lerp(ca.g, cb.g), b: lerp(ca.b, cb.b) })
}

/** WCAG 2.x relative luminance */
function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  const ch = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

/** WCAG contrast ratio (1–21) */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Nudges text color fg toward `toward` until it reaches target contrast on every background.
 * With tint > 0, it also checks chips tinted with fg itself at that alpha (bg-x/15 etc.).
 */
export function ensureContrast(
  fg: string,
  backgrounds: string[],
  toward: string,
  target = 4.5,
  tint = 0
): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const candidate = mixHex(fg, toward, t)
    const bgs =
      tint > 0
        ? [...backgrounds, ...backgrounds.map((bg) => mixHex(bg, candidate, tint))]
        : backgrounds
    if (bgs.every((bg) => contrastRatio(candidate, bg) >= target)) return candidate
  }
  return toward
}

/** Text color for a filled background bg — whichever of white or black contrasts more */
export function readableOn(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#000000') ? '#ffffff' : '#000000'
}

/** Inpaint mask display color (R, G, B). Canvas can't read CSS variables, so it lives in TS. */
export const MASK_PAINT_RGB = '233, 94, 80'

import {
  composite,
  contrastRatio,
  ensureContrast,
  ensureMarkContrast,
  mixHex,
  readableOn
} from './color'
import { MARK_ALPHA } from './prompt-weights'

/** Base prompt highlight colors, adjusted per theme for body text contrast (--*-mark tokens). */
const MARK_BASE = {
  weightUp: '#e95e50',
  weightDown: '#6091eb',
  comment: '#808088',
  fragment: '#5cbe7d',
  searchHit: '#e9c832',
  searchHitCurrent: '#e99632'
} as const

/** Tag kind colors (Danbooru autocomplete), adjusted per theme to read as text (--tag-*). */
const TAG_BASE = {
  artist: '#e05c50',
  character: '#5c9e6e',
  copyright: '#b07fd8',
  meta: '#c9a34f',
  fragment: '#5cbe7d'
} as const

const ANLAS_BASE = '#c9a34f'

/** Icon/chip hues — Tailwind 600 (light) / 400 (dark) tones, adjusted into the --hue-* tokens. */
export const HUE_BASE = {
  orange: ['#f54900', '#ff8904'],
  amber: ['#e17100', '#ffb900'],
  emerald: ['#009966', '#00d492'],
  teal: ['#009689', '#00d5be'],
  cyan: ['#0092b8', '#00d3f2'],
  sky: ['#0084d1', '#00bcff'],
  indigo: ['#4f39f6', '#7c86ff'],
  violet: ['#7f22fe', '#a684ff'],
  purple: ['#9810fa', '#c27aff'],
  fuchsia: ['#c800de', '#ed6aff'],
  pink: ['#e60076', '#fb64b6'],
  rose: ['#ec003f', '#ff637e']
} as const

/** Max hue chip tint (hover:bg-hue-x/20 on scene-cast-dialog chips, over the dialog surface) */
export const HUE_CHIP_ALPHA = 0.2

/** Hues also used as chip text */
export const HUE_CHIP_TEXT: readonly string[] = ['sky', 'emerald', 'violet']

export type ThemeMode = 'dark' | 'light'

export interface Palette {
  neutral: string
  ink: string
  primary: string
  accent: string
  success: string
  warning: string
  error: string
  info: string
  syntaxKeyword: string
  syntaxComment: string
}

export interface ThemePreset {
  id: string
  name: string
  dark?: Palette
  light?: Palette
}

export function buildWhimsTokens(palette: Palette, mode: ThemeMode): Record<string, string> {
  const dark = mode === 'dark'
  const m = (amount: number): string => mixHex(palette.neutral, palette.ink, amount)
  const surface = m(dark ? 0.045 : 0.035)
  const surface2 = m(dark ? 0.095 : 0.08)
  const surfaces = [palette.neutral, surface, surface2]
  const toward = dark ? '#ffffff' : '#000000'
  // Body text gets 7:1 (AAA) on every surface so that themes hovering near 4.5:1, like Solarized,
  // still keep 4.5:1 once highlights or selection backgrounds sit behind the text.
  const ink = ensureContrast(palette.ink, surfaces, toward, 7)
  const dim = (amount: number): string => mixHex(ink, palette.neutral, amount)
  const target = 4.5

  // Secondary text. muted meets body-level 4.5:1, so must-read hints like placeholders use it.
  // faint is for extras like shortcut hints and disabled icons, so to keep the hierarchy
  // it only meets 3:1 (the UI component threshold).
  const mutedBase = ensureContrast(dim(dark ? 0.42 : 0.46), surfaces, ink, target)

  // Selected-row background (accent-soft). To keep body and muted text readable on it,
  // first lower its strength (for muted, only down to 10% light / 14% dark);
  // if that is still not enough, muted itself is nudged below.
  const accent = palette.primary
  const passesOnSoft = (fg: string, pct: number): boolean =>
    surfaces.every((bg) => contrastRatio(fg, composite(bg, accent, pct / 100)) >= target)
  let softPct = dark ? 18 : 13
  while (
    (softPct > 6 && !passesOnSoft(ink, softPct)) ||
    (softPct > (dark ? 14 : 10) && !passesOnSoft(mutedBase, softPct))
  )
    softPct--
  // Every background text sits on: the three surfaces plus the selection over each
  const textBgs = [...surfaces, ...surfaces.map((bg) => composite(bg, accent, softPct / 100))]
  const muted = ensureContrast(mutedBase, textBgs, ink, target)
  const faint = ensureContrast(dim(dark ? 0.62 : 0.58), textBgs, ink, 3)

  // Accent fills (bg-accent) keep the palette color; only accent text and icons
  // (text-accent-ink) are nudged.
  // Accent text sits on every background and on accent chips over them
  // (bg-accent/10–15, including icon boxes on selected rows).
  const accentChips = [...surfaces, textBgs[3], textBgs[4]].map((bg) => composite(bg, accent, 0.15))
  const accentInk = ensureContrast(accent, [...textBgs, ...accentChips], toward, target)

  // Status colors double as body text, so they meet 4.5:1. 15% chips (bg-x/15) are checked
  // on the three surfaces and on the selection over paper/surface (Director tool cost chips);
  // bare text is checked on every background.
  // Only lightness is nudged, toward white/black rather than ink, to preserve the hue.
  const chipBgs = [...surfaces, textBgs[3], textBgs[4]]
  const readable = (color: string): string =>
    ensureContrast(ensureContrast(color, chipBgs, toward, target, 0.15), textBgs, toward, target)
  const danger = readable(palette.error)

  // Palette-independent identity colors are used as text too. Anlas (titlebar, settings) and
  // tag kinds (autocomplete list) never sit on a selection, so 4.5:1 on the surfaces suffices.
  const onSurfaces = (color: string): string => ensureContrast(color, surfaces, toward, target)
  const fixedColors: Record<string, string> = { '--anlas': onSurfaces(ANLAS_BASE) }
  for (const [kind, color] of Object.entries(TAG_BASE))
    fixedColors[`--tag-${kind}`] = onSurfaces(color)
  // Hues are mostly icons, so they only meet 3:1 (non-text) on every background. Chip hues
  // also used as text (HUE_CHIP_TEXT) meet 4.5:1 on their own chip (up to 20% on hover)
  // over the dialog surface.
  for (const [name, [light, darkTone]] of Object.entries(HUE_BASE)) {
    const base = dark ? darkTone : light
    const chipReadable = HUE_CHIP_TEXT.includes(name)
      ? ensureContrast(base, [palette.neutral, surface], toward, target, HUE_CHIP_ALPHA)
      : base
    fixedColors[`--hue-${name}`] = ensureContrast(chipReadable, textBgs, toward, 3)
  }

  // Prompt highlights sit behind text, so they are nudged the other way, toward the
  // background (black in dark mode, white in light mode).
  const markAway = dark ? '#000000' : '#ffffff'
  const mark = (color: string, alpha: number): string =>
    ensureMarkContrast(color, ink, surfaces, markAway, alpha, target)
  // Find highlights overlap weight highlights, so they are opaque to avoid stacked tints.
  const searchMark = (color: string, alpha: number): string =>
    ensureContrast(mixHex(palette.neutral, color, alpha), [ink], markAway, target)

  // Hover for filled buttons. Lowering opacity would break text contrast, so the fill is
  // pushed 10% away from its text color, raising contrast on hover instead.
  const hoverFill = (fill: string): string =>
    mixHex(fill, readableOn(fill) === '#ffffff' ? '#000000' : '#ffffff', 0.1)

  return {
    '--paper': palette.neutral,
    '--surface': surface,
    '--surface-2': surface2,
    '--ink': ink,
    '--muted': muted,
    '--faint': faint,
    '--line': m(dark ? 0.14 : 0.16),
    '--accent': palette.primary,
    '--accent-soft': `color-mix(in srgb, ${accent} ${softPct}%, transparent)`,
    '--accent-ink': accentInk,
    '--on-accent': readableOn(palette.primary),
    '--accent-hover': hoverFill(palette.primary),
    '--danger': danger,
    '--on-danger': readableOn(danger),
    '--danger-hover': hoverFill(danger),
    '--success': readable(palette.success),
    '--warning': readable(palette.warning),
    '--info': readable(palette.info),
    '--dialogue': palette.primary,
    '--dialogue-bg': `color-mix(in srgb, ${palette.primary} 16%, transparent)`,
    '--quote': palette.warning,
    '--quote-bg': `color-mix(in srgb, ${palette.warning} 16%, transparent)`,
    '--onomatopoeia': palette.accent,
    '--weight-up': mark(MARK_BASE.weightUp, MARK_ALPHA.weight),
    '--weight-down': mark(
      MARK_BASE.weightDown,
      Math.max(MARK_ALPHA.weight, MARK_ALPHA.weightNegative)
    ),
    '--comment-mark': mark(MARK_BASE.comment, MARK_ALPHA.comment),
    '--fragment-mark': mark(MARK_BASE.fragment, MARK_ALPHA.fragment),
    '--search-hit': searchMark(MARK_BASE.searchHit, 0.4),
    '--search-hit-current': searchMark(MARK_BASE.searchHitCurrent, 0.85),
    ...fixedColors
  }
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    // NAIS3 기본 테마 — 무채색 모노크롬 + 주황 강조색(primary가 --accent를 구동).
    id: 'nais3',
    name: 'NAIS3',
    dark: {
      neutral: '#0f0f10',
      ink: '#e9e9ea',
      primary: '#eb9550',
      accent: '#eb9550',
      success: '#84ac8e',
      warning: '#c4b184',
      error: '#c47a72',
      info: '#8fa4b5',
      syntaxKeyword: '#a6a8b2',
      syntaxComment: '#606066'
    },
    light: {
      neutral: '#fafafa',
      ink: '#19191b',
      primary: '#c2610a',
      accent: '#c2610a',
      success: '#4c7f5c',
      warning: '#8f7638',
      error: '#a85a52',
      info: '#4f7189',
      syntaxKeyword: '#5b5d68',
      syntaxComment: '#8f8f95'
    }
  },
  {
    id: 'tokyonight',
    name: 'Tokyo Night',
    dark: {
      neutral: '#1a1b26',
      ink: '#c0caf5',
      primary: '#7aa2f7',
      accent: '#ff9e64',
      success: '#9ece6a',
      warning: '#e0af68',
      error: '#f7768e',
      info: '#7dcfff',
      syntaxKeyword: '#bb9af7',
      syntaxComment: '#565f89'
    },
    light: {
      neutral: '#e1e2e7',
      ink: '#273153',
      primary: '#2e7de9',
      accent: '#b15c00',
      success: '#587539',
      warning: '#8c6c3e',
      error: '#c94060',
      info: '#007197',
      syntaxKeyword: '#9854f1',
      syntaxComment: '#6b6f7a'
    }
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    dark: {
      neutral: '#1e1e2e',
      ink: '#cdd6f4',
      primary: '#b4befe',
      accent: '#f38ba8',
      success: '#a6d189',
      warning: '#f4b8e4',
      error: '#f38ba8',
      info: '#89dceb',
      syntaxKeyword: '#cba6f7',
      syntaxComment: '#6c7086'
    },
    light: {
      neutral: '#f5e0dc',
      ink: '#4c4f69',
      primary: '#7287fd',
      accent: '#d20f39',
      success: '#40a02b',
      warning: '#df8e1d',
      error: '#d20f39',
      info: '#04a5e5',
      syntaxKeyword: '#8839ef',
      syntaxComment: '#6c7086'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    dark: {
      neutral: '#1d1e28',
      ink: '#f8f8f2',
      primary: '#bd93f9',
      accent: '#ff79c6',
      success: '#50fa7b',
      warning: '#ffb86c',
      error: '#ff5555',
      info: '#8be9fd',
      syntaxKeyword: '#ff79c6',
      syntaxComment: '#6272a4'
    },
    light: {
      neutral: '#f8f8f2',
      ink: '#1f1f2f',
      primary: '#7c6bf5',
      accent: '#d16090',
      success: '#2fbf71',
      warning: '#f7a14d',
      error: '#d9536f',
      info: '#1d7fc5',
      syntaxKeyword: '#d16090',
      syntaxComment: '#7d7f97'
    }
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    dark: {
      neutral: '#282c34',
      ink: '#abb2bf',
      primary: '#61afef',
      accent: '#56b6c2',
      success: '#98c379',
      warning: '#e5c07b',
      error: '#e06c75',
      info: '#d19a66',
      syntaxKeyword: '#c678dd',
      syntaxComment: '#5c6370'
    },
    light: {
      neutral: '#fafafa',
      ink: '#383a42',
      primary: '#4078f2',
      accent: '#0184bc',
      success: '#50a14f',
      warning: '#c18401',
      error: '#e45649',
      info: '#986801',
      syntaxKeyword: '#a626a4',
      syntaxComment: '#a0a1a7'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: {
      neutral: '#2e3440',
      ink: '#e5e9f0',
      primary: '#88c0d0',
      accent: '#d57780',
      success: '#a3be8c',
      warning: '#d08770',
      error: '#bf616a',
      info: '#81a1c1',
      syntaxKeyword: '#81a1c1',
      syntaxComment: '#616e88'
    },
    light: {
      neutral: '#eceff4',
      ink: '#2e3440',
      primary: '#5e81ac',
      accent: '#bf616a',
      success: '#8fbcbb',
      warning: '#d08770',
      error: '#bf616a',
      info: '#81a1c1',
      syntaxKeyword: '#5e81ac',
      syntaxComment: '#6b7282'
    }
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    dark: {
      neutral: '#282828',
      ink: '#ebdbb2',
      primary: '#83a598',
      accent: '#fb4934',
      success: '#b8bb26',
      warning: '#fabd2f',
      error: '#fb4934',
      info: '#d3869b',
      syntaxKeyword: '#fb4934',
      syntaxComment: '#928374'
    },
    light: {
      neutral: '#fbf1c7',
      ink: '#3c3836',
      primary: '#076678',
      accent: '#9d0006',
      success: '#79740e',
      warning: '#b57614',
      error: '#9d0006',
      info: '#8f3f71',
      syntaxKeyword: '#9d0006',
      syntaxComment: '#928374'
    }
  },
  {
    id: 'github',
    name: 'GitHub',
    dark: {
      neutral: '#0d1117',
      ink: '#c9d1d9',
      primary: '#58a6ff',
      accent: '#39c5cf',
      success: '#3fb950',
      warning: '#e3b341',
      error: '#f85149',
      info: '#d29922',
      syntaxKeyword: '#ff7b72',
      syntaxComment: '#8b949e'
    },
    light: {
      neutral: '#ffffff',
      ink: '#24292f',
      primary: '#0969da',
      accent: '#1b7c83',
      success: '#1a7f37',
      warning: '#9a6700',
      error: '#cf222e',
      info: '#bc4c00',
      syntaxKeyword: '#cf222e',
      syntaxComment: '#57606a'
    }
  },
  {
    id: 'rosepine',
    name: 'Rose Pine',
    dark: {
      neutral: '#191724',
      ink: '#e0def4',
      primary: '#9ccfd8',
      accent: '#ebbcba',
      success: '#31748f',
      warning: '#f6c177',
      error: '#eb6f92',
      info: '#9ccfd8',
      syntaxKeyword: '#31748f',
      syntaxComment: '#6e6a86'
    },
    light: {
      neutral: '#faf4ed',
      ink: '#575279',
      primary: '#31748f',
      accent: '#d7827e',
      success: '#286983',
      warning: '#ea9d34',
      error: '#b4637a',
      info: '#56949f',
      syntaxKeyword: '#286983',
      syntaxComment: '#9893a5'
    }
  },
  {
    id: 'solarized',
    name: 'Solarized',
    dark: {
      neutral: '#002b36',
      ink: '#93a1a1',
      primary: '#6c71c4',
      accent: '#d33682',
      success: '#859900',
      warning: '#b58900',
      error: '#dc322f',
      info: '#2aa198',
      syntaxKeyword: '#859900',
      syntaxComment: '#586e75'
    },
    light: {
      neutral: '#fdf6e3',
      ink: '#586e75',
      primary: '#268bd2',
      accent: '#d33682',
      success: '#859900',
      warning: '#b58900',
      error: '#dc322f',
      info: '#2aa198',
      syntaxKeyword: '#728600',
      syntaxComment: '#657b83'
    }
  },
  {
    id: 'kanagawa',
    name: 'Kanagawa',
    dark: {
      neutral: '#1f1f28',
      ink: '#dcd7ba',
      primary: '#7e9cd8',
      accent: '#d27e99',
      success: '#98bb6c',
      warning: '#d7a657',
      error: '#e82424',
      info: '#76946a',
      syntaxKeyword: '#957fb8',
      syntaxComment: '#727169'
    },
    light: {
      neutral: '#f2e9de',
      ink: '#54433a',
      primary: '#2d4f67',
      accent: '#d27e99',
      success: '#98bb6c',
      warning: '#d7a657',
      error: '#e82424',
      info: '#76946a',
      syntaxKeyword: '#957fb8',
      syntaxComment: '#9e9389'
    }
  },
  {
    id: 'vercel',
    name: 'Vercel',
    dark: {
      neutral: '#000000',
      ink: '#ededed',
      primary: '#0070f3',
      accent: '#8e4ec6',
      success: '#46a758',
      warning: '#ffb224',
      error: '#e5484d',
      info: '#52a8ff',
      syntaxKeyword: '#f75590',
      syntaxComment: '#878787'
    },
    light: {
      neutral: '#ffffff',
      ink: '#171717',
      primary: '#0070f3',
      accent: '#8e4ec6',
      success: '#388e3c',
      warning: '#ff9500',
      error: '#dc3545',
      info: '#0070f3',
      syntaxKeyword: '#e93d82',
      syntaxComment: '#888888'
    }
  }
]

export function getThemePreset(id: string): ThemePreset {
  return THEME_PRESETS.find((preset) => preset.id === id) ?? THEME_PRESETS[0]
}

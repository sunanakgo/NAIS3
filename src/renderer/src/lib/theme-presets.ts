import { contrastRatio, ensureContrast, mixHex, readableOn } from './color'

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
  const dim = (amount: number): string => mixHex(palette.ink, palette.neutral, amount)
  const surface = m(dark ? 0.045 : 0.035)
  const surface2 = m(dark ? 0.095 : 0.08)
  // Status colors double as body text, so they meet 4.5:1 on every surface and 15% chip.
  // Low-contrast themes whose body text (ink) is already below 4.5:1 only require ink's level.
  // Only lightness is nudged, toward white/black rather than ink, to preserve the hue.
  const surfaces = [palette.neutral, surface, surface2]
  const inkContrast = Math.min(...surfaces.map((bg) => contrastRatio(palette.ink, bg)))
  const target = Math.min(4.5, inkContrast)
  const readable = (color: string): string =>
    ensureContrast(color, surfaces, dark ? '#ffffff' : '#000000', target, 0.15)
  const danger = readable(palette.error)

  return {
    '--paper': palette.neutral,
    '--surface': surface,
    '--surface-2': surface2,
    '--ink': palette.ink,
    '--muted': dim(dark ? 0.42 : 0.46),
    '--faint': dim(dark ? 0.62 : 0.58),
    '--line': m(dark ? 0.14 : 0.16),
    '--accent': palette.primary,
    '--accent-soft': `color-mix(in srgb, ${palette.primary} ${dark ? 18 : 13}%, transparent)`,
    '--on-accent': readableOn(palette.primary),
    '--danger': danger,
    '--on-danger': readableOn(danger),
    '--success': readable(palette.success),
    '--warning': readable(palette.warning),
    '--info': readable(palette.info),
    '--dialogue': palette.primary,
    '--dialogue-bg': `color-mix(in srgb, ${palette.primary} 16%, transparent)`,
    '--quote': palette.warning,
    '--quote-bg': `color-mix(in srgb, ${palette.warning} 16%, transparent)`,
    '--onomatopoeia': palette.accent
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

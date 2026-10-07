import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { MARK_ALPHA } from '../src/renderer/src/lib/prompt-weights'
import {
  buildWhimsTokens,
  HUE_BASE,
  HUE_CHIP_ALPHA,
  HUE_CHIP_TEXT,
  THEME_PRESETS,
  type ThemeMode
} from '../src/renderer/src/lib/theme-presets'

/** Actual runtime tokens for every preset × mode */
const CASES = THEME_PRESETS.flatMap((preset) =>
  (['light', 'dark'] as ThemeMode[]).flatMap((mode) => {
    const palette = preset[mode]
    if (!palette) return []
    return [{ name: `${preset.id}/${mode}`, tokens: buildWhimsTokens(palette, mode) }]
  })
)

/*
 * Contrast math stays independent of the implementation (color.ts). Composites are not
 * rounded to integers, so a failing 4.49:1 can never pass through rounding error.
 */
type Rgb = [number, number, number]
type Color = string | Rgb

function rgb(color: Color): Rgb {
  if (typeof color !== 'string') return color
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Composites over onto bg at alpha (no rounding) */
function mixHex(bg: Color, over: Color, alpha: number): Rgb {
  const a = rgb(bg)
  const b = rgb(over)
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * alpha) as Rgb
}

function luminance(color: Color): number {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: Color, b: Color): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function surfacesOf(tokens: Record<string, string>): string[] {
  return [tokens['--paper'], tokens['--surface'], tokens['--surface-2']]
}

/** Every background text sits on, including the selected-row background over each surface */
function textBgsOf(tokens: Record<string, string>): Color[] {
  const pct = Number(/(\d+)%/.exec(tokens['--accent-soft'])?.[1])
  expect(pct).toBeGreaterThan(0)
  const surfaces = surfacesOf(tokens)
  return [...surfaces, ...surfaces.map((bg) => mixHex(bg, tokens['--accent'], pct / 100))]
}

function minContrast(fg: Color, bgs: Color[]): number {
  return Math.min(...bgs.map((bg) => contrastRatio(fg, bg)))
}

/** Only a tiny epsilon for float noise, so values like 4.4999… still fail */
const EPS = 1e-9

describe.each(CASES)('$name 대비', ({ tokens }) => {
  const ink = tokens['--ink']
  const surfaces = surfacesOf(tokens)
  const target = 4.5

  const textBgs = textBgsOf(tokens)

  it('본문 글자는 모든 면에서 7:1, 선택 배경 위에서도 4.5:1', () => {
    expect(minContrast(ink, surfaces)).toBeGreaterThanOrEqual(7 - EPS)
    expect(minContrast(ink, textBgs)).toBeGreaterThanOrEqual(target - EPS)
  })

  it('muted는 4.5:1, faint는 3:1 (선택 배경 포함)', () => {
    expect(minContrast(tokens['--muted'], textBgs)).toBeGreaterThanOrEqual(target - EPS)
    expect(minContrast(tokens['--faint'], textBgs)).toBeGreaterThanOrEqual(3 - EPS)
  })

  it('accent-ink 글자는 모든 배경과 강조색 15% 칩(선택 배경 위 포함)에서 4.5:1', () => {
    const fg = tokens['--accent-ink']
    const chips = [...surfaces, textBgs[3], textBgs[4]].map((bg) =>
      mixHex(bg, tokens['--accent'], 0.15)
    )
    expect(minContrast(fg, [...textBgs, ...chips])).toBeGreaterThanOrEqual(target - EPS)
  })

  it.each([
    ['--accent', '--accent-hover', '--on-accent'],
    ['--danger', '--danger-hover', '--on-danger']
  ])('%s 채움과 hover 위 글자는 4.5:1', (fill, hover, on) => {
    expect(minContrast(tokens[on], [tokens[fill], tokens[hover]])).toBeGreaterThanOrEqual(
      target - EPS
    )
  })

  it.each(['--danger', '--success', '--warning', '--info'])(
    '%s 글자는 모든 배경, 15% 칩은 기본 면과 paper/surface 위 선택 배경에서 4.5:1',
    (token) => {
      const fg = tokens[token]
      const chips = [...surfaces, textBgs[3], textBgs[4]].map((bg) => mixHex(bg, fg, 0.15))
      expect(minContrast(fg, [...textBgs, ...chips])).toBeGreaterThanOrEqual(target - EPS)
    }
  )

  it.each([
    ['--weight-up', MARK_ALPHA.weight],
    ['--weight-down', Math.max(MARK_ALPHA.weight, MARK_ALPHA.weightNegative)],
    ['--comment-mark', MARK_ALPHA.comment],
    ['--fragment-mark', MARK_ALPHA.fragment]
  ])('%s 하이라이트(최대 알파) 위 본문 글자', (token, alpha) => {
    for (const bg of surfaces) {
      expect(contrastRatio(ink, mixHex(bg, tokens[token], alpha))).toBeGreaterThanOrEqual(
        target - EPS
      )
    }
  })

  it.each(['--search-hit', '--search-hit-current'])(
    '%s는 불투명이고 본문 글자가 읽힌다',
    (token) => {
      expect(tokens[token]).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrastRatio(ink, tokens[token])).toBeGreaterThanOrEqual(target - EPS)
    }
  )

  it.each([
    '--anlas',
    '--tag-artist',
    '--tag-character',
    '--tag-copyright',
    '--tag-meta',
    '--tag-fragment'
  ])('%s 글자는 기본 면 3종 위에서 4.5:1', (token) => {
    expect(minContrast(tokens[token], surfaces)).toBeGreaterThanOrEqual(target - EPS)
  })

  const hues = Object.keys(tokens).filter((key) => key.startsWith('--hue-'))

  it('색조 토큰 12종이 모두 계산된다', () => {
    expect(hues).toHaveLength(12)
  })

  it.each(hues)('%s 아이콘은 모든 배경에서 3:1', (token) => {
    expect(minContrast(tokens[token], textBgs)).toBeGreaterThanOrEqual(3 - EPS)
  })

  it.each(HUE_CHIP_TEXT)('hue-%s 칩 글자는 paper/surface 위 칩(hover 포함)에서 4.5:1', (name) => {
    const fg = tokens[`--hue-${name}`]
    const chips = [tokens['--paper'], tokens['--surface']].flatMap((bg) => [
      bg,
      mixHex(bg, fg, 0.12),
      mixHex(bg, fg, HUE_CHIP_ALPHA)
    ])
    expect(minContrast(fg, chips)).toBeGreaterThanOrEqual(target - EPS)
  })
})

/** main.css initial-paint defaults must match the nais3 tokens computed at startup */
describe('main.css 기본값', () => {
  const css = readFileSync('src/renderer/src/assets/main.css', 'utf8')
  const block = (selector: string): Record<string, string> => {
    const start = css.indexOf(`\n${selector} {`)
    const body = css.slice(start, css.indexOf('\n}', start))
    return Object.fromEntries(
      [...body.matchAll(/\n\s*(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]])
    )
  }
  const rgba = (value: string): string =>
    value.replace(
      /color-mix\(in srgb, #(\w\w)(\w\w)(\w\w) (\d+)%, transparent\)/,
      (_, r, g, b, a) =>
        `rgba(${[r, g, b].map((h) => parseInt(h, 16)).join(', ')}, ${Number(a) / 100})`
    )
  const nais3 = THEME_PRESETS.find((preset) => preset.id === 'nais3')!
  const light = block(':root')
  const dark = { ...light, ...block("[data-theme='dark']") }

  it.each([
    ['light', light],
    ['dark', dark]
  ] as const)('%s', (mode, defaults) => {
    const tokens = buildWhimsTokens(nais3[mode]!, mode)
    for (const [key, value] of Object.entries(tokens)) {
      // Dialogue and quote tokens are not used in CSS
      if (/^--(dialogue|quote|onomatopoeia)/.test(key)) continue
      expect(defaults[key], key).toBe(rgba(value))
    }
  })
})

/** Original 400-tone icons on image badges (.on-image, bg-black/80) — 3:1 even over white */
it.each(Object.entries(HUE_BASE))('.on-image hue-%s', (_, [, tone]) => {
  expect(contrastRatio(tone, mixHex('#ffffff', '#000000', 0.8))).toBeGreaterThanOrEqual(3 - EPS)
})

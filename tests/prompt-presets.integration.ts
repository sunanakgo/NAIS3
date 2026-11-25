import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, initDb } from '../src/main/db'
import { setSetting } from '../src/main/db/settings'
import {
  createPromptPreset,
  duplicatePromptPreset,
  listPromptPresets,
  reorderPromptPresets,
  updatePromptPreset
} from '../src/main/prompts/repo'
import type { PresetParams } from '../src/shared/types'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'en-US' },
  BrowserWindow: {},
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const params: PresetParams = {
  model: 'nai-diffusion-4-5-full',
  width: 1024,
  height: 1024,
  steps: 28,
  cfgScale: 5.5,
  cfgRescale: 0.2,
  sampler: 'k_euler',
  noiseSchedule: 'karras',
  variety: true,
  qualityToggle: false,
  ucPreset: 2
}

describe('duplicatePromptPreset', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nais3-prompt-presets-'))
    environment.directory = root
    initDb()
    setSetting('ui_language', 'en')
  })
  afterEach(() => {
    closeDb()
    rmSync(root, { recursive: true, force: true })
  })

  it('copies every field under a translated copy name and appends it to the list', () => {
    const first = createPromptPreset('Portrait', '1girl, smile', 'lowres', params)
    const last = createPromptPreset('Landscape', 'scenery', 'blurry')
    const parts = { base: '1girl', additional: 'smile', detail: '' }
    updatePromptPreset(first, { promptParts: parts })

    const copy = duplicatePromptPreset(first)

    expect(copy).toBeGreaterThan(0)
    expect(listPromptPresets()).toEqual([
      {
        id: first,
        name: 'Portrait',
        prompt: '1girl, smile',
        negativePrompt: 'lowres',
        params,
        promptParts: parts
      },
      {
        id: last,
        name: 'Landscape',
        prompt: 'scenery',
        negativePrompt: 'blurry',
        params: null,
        promptParts: null
      },
      {
        id: copy,
        name: 'Portrait copy',
        prompt: '1girl, smile',
        negativePrompt: 'lowres',
        params,
        promptParts: parts
      }
    ])
  })

  it('keeps the copy independent of the original', () => {
    const source = createPromptPreset('Base', 'a', 'b', params)
    const copy = duplicatePromptPreset(source)
    updatePromptPreset(copy, { prompt: 'changed' })
    const byId = new Map(listPromptPresets().map((preset) => [preset.id, preset]))
    expect(byId.get(source)?.prompt).toBe('a')
    expect(byId.get(copy)?.prompt).toBe('changed')
  })

  it('appends after reordered presets and uses the current language', () => {
    setSetting('ui_language', 'ko')
    const a = createPromptPreset('A', '', '')
    const b = createPromptPreset('B', '', '')
    reorderPromptPresets([b, a])
    const copy = duplicatePromptPreset(b)
    expect(listPromptPresets().map((preset) => [preset.id, preset.name])).toEqual([
      [b, 'B'],
      [a, 'A'],
      [copy, 'B 복제']
    ])
  })

  it('returns 0 without inserting when the preset does not exist', () => {
    createPromptPreset('Only', '', '')
    expect(duplicatePromptPreset(9999)).toBe(0)
    expect(listPromptPresets()).toHaveLength(1)
  })
})

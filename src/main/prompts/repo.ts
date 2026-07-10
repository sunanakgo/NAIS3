import { getDb } from '../db'
import type { PresetParams, PromptParts, PromptPreset } from '../../shared/types'

/** 프롬프트 프리셋 CRUD — 프롬프트+네거티브+생성 파라미터(+3분할 조각)를 이름 붙여 저장 */

function parseJson<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null // 깨진 JSON은 없음으로
  }
}

export function listPromptPresets(): PromptPreset[] {
  const rows = getDb()
    .prepare(
      'SELECT id, name, prompt, negative_prompt AS negativePrompt, params_json, prompt_parts_json FROM prompt_presets ORDER BY sort_order, id'
    )
    .all() as (Omit<PromptPreset, 'params' | 'promptParts'> & {
    params_json: string | null
    prompt_parts_json: string | null
  })[]
  return rows.map(({ params_json, prompt_parts_json, ...r }) => ({
    ...r,
    params: parseJson<PresetParams>(params_json),
    promptParts: parseJson<PromptParts>(prompt_parts_json)
  }))
}

export function createPromptPreset(
  name: string,
  prompt: string,
  negativePrompt: string,
  params?: PresetParams
): number {
  const db = getDb()
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM prompt_presets').get() as {
    m: number
  }
  const info = db
    .prepare(
      'INSERT INTO prompt_presets (name, prompt, negative_prompt, params_json, sort_order) VALUES (?, ?, ?, ?, ?)'
    )
    .run(name, prompt, negativePrompt, params ? JSON.stringify(params) : null, max.m + 1)
  return Number(info.lastInsertRowid)
}

export function updatePromptPreset(
  id: number,
  patch: Partial<
    Pick<PromptPreset, 'name' | 'prompt' | 'negativePrompt' | 'params' | 'promptParts'>
  >
): void {
  const cols: string[] = []
  const vals: unknown[] = []
  if (patch.name !== undefined) (cols.push('name = ?'), vals.push(patch.name))
  if (patch.prompt !== undefined) (cols.push('prompt = ?'), vals.push(patch.prompt))
  if (patch.negativePrompt !== undefined)
    (cols.push('negative_prompt = ?'), vals.push(patch.negativePrompt))
  if (patch.params !== undefined)
    (cols.push('params_json = ?'), vals.push(patch.params ? JSON.stringify(patch.params) : null))
  if (patch.promptParts !== undefined) {
    cols.push('prompt_parts_json = ?')
    vals.push(patch.promptParts ? JSON.stringify(patch.promptParts) : null)
  }
  if (!cols.length) return
  vals.push(id)
  getDb()
    .prepare(`UPDATE prompt_presets SET ${cols.join(', ')} WHERE id = ?`)
    .run(...vals)
}

export function deletePromptPreset(id: number): void {
  getDb().prepare('DELETE FROM prompt_presets WHERE id = ?').run(id)
}

export function reorderPromptPresets(ids: number[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE prompt_presets SET sort_order = ? WHERE id = ?')
  db.transaction(() => {
    ids.forEach((id, i) => stmt.run(i, id))
  })()
}

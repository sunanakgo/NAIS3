import { getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { createPromptPreset } from '../prompts/repo'
import type { PresetParams } from '../../shared/types'

export interface Nais2ImportResult {
  characters: number
  presets: number
  fragments: number
  scenes: number
  prompt: boolean
}

/**
 * NAIS2 백업 JSON → NAIS3 가져오기 (텍스트 데이터만: 캐릭터·프롬프트 프리셋·조각).
 * 바이브/캐릭레퍼/라이브러리 이미지는 NAIS2 백업 JSON에 원본 base64가 비어 있어(파일 경로만) 제외.
 * 기존 NAIS3 데이터는 지우지 않고 추가(merge)한다.
 */

type Obj = Record<string, unknown>

function state(data: Obj, key: string): Obj {
  const wrap = data[key] as Obj | undefined
  return (wrap?.state ?? {}) as Obj
}
function removeComments(s: string): string {
  return s
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')
}

/** base+additional+detail를 NAIS2 규칙(주석 제거, ', ' 결합)으로 합친다 */
function mergePrompt(base: unknown, add: unknown, detail: unknown): string {
  return [base, add, detail]
    .map((x) => removeComments(String(x ?? '')).trim())
    .filter(Boolean)
    .join(', ')
}

/** NAIS2 프리셋의 생성 파라미터 → NAIS3 PresetParams (해당 필드가 있을 때만) (F5) */
function nais2PresetParams(p: Obj): PresetParams | undefined {
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v ? v : undefined
  const res = p.selectedResolution as { width?: unknown; height?: unknown } | undefined
  const params: PresetParams = {
    model: str(p.model),
    width: num(res?.width),
    height: num(res?.height),
    steps: num(p.steps),
    cfgScale: num(p.cfgScale),
    cfgRescale: num(p.cfgRescale),
    sampler: str(p.sampler),
    noiseSchedule: str(p.scheduler), // NAIS2는 scheduler
    variety: typeof p.variety === 'boolean' ? p.variety : undefined,
    qualityToggle: typeof p.qualityToggle === 'boolean' ? p.qualityToggle : undefined,
    ucPreset: num(p.ucPreset) as PresetParams['ucPreset']
  }
  // 정의된 값이 하나도 없으면 undefined
  const hasAny = Object.values(params).some((v) => v !== undefined)
  return hasAny ? params : undefined
}

export function importNais2(data: Obj): Nais2ImportResult {
  const db = getDb()
  const res: Nais2ImportResult = { characters: 0, presets: 0, fragments: 0, scenes: 0, prompt: false }

  // 폴더 find-or-create (동명이면 재사용) — 캐릭터/조각 폴더 구조 유지용
  const folderIdFor = (table: 'character_folders' | 'fragment_folders', name: string): number => {
    const existing = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as
      | { id: number }
      | undefined
    if (existing) return existing.id
    const max = (
      db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM ${table}`).get() as { m: number }
    ).m
    return Number(
      db.prepare(`INSERT INTO ${table} (name, sort_order) VALUES (?, ?)`).run(name, max + 1)
        .lastInsertRowid
    )
  }

  const tx = db.transaction(() => {
    // 1. 캐릭터 — 가져올 항목이 있으면 기존 캐릭터를 비우고 교체 (바이브/캐릭레퍼는 건드리지 않음)
    //    NAIS2 groups(폴더) → character_folders로 매핑해 폴더 구조 유지
    const chs = state(data, 'nais2-character-prompts')
    const groups = (Array.isArray(chs.groups) ? (chs.groups as Obj[]) : []).filter(
      (g) => g.id != null && g.name
    )
    const rawChars = (Array.isArray(chs.characters) && chs.characters.length
      ? chs.characters
      : chs.presets) as Obj[] | undefined
    const chars = (rawChars ?? [])
      .map((c) => ({
        name: String(c.name ?? ''),
        prompt: String(c.prompt ?? ''),
        negative: String(c.negative ?? ''),
        groupId: c.groupId != null ? String(c.groupId) : null
      }))
      .filter((c) => c.prompt || c.negative || c.name)
    if (chars.length) {
      const groupFolder = new Map<string, number>()
      for (const g of groups) groupFolder.set(String(g.id), folderIdFor('character_folders', String(g.name)))
      db.prepare('DELETE FROM character_prompts').run()
      chars.forEach((c, i) => {
        db.prepare(
          'INSERT INTO character_prompts (name, prompt, negative_prompt, folder_id, sort_order) VALUES (?, ?, ?, ?, ?)'
        ).run(c.name, c.prompt, c.negative, c.groupId ? (groupFolder.get(c.groupId) ?? null) : null, i)
        res.characters++
      })
    }

    // 2. 프롬프트 프리셋 — '기본'(default) 포함(내용 있는 경우 많음). 빈 것만 제외.
    //    NAIS2 프리셋의 생성 파라미터(모델·해상도·스텝·CFG 등)도 함께 가져온다 (F5).
    const ps = state(data, 'nais2-presets')
    const presets = (Array.isArray(ps.presets) ? (ps.presets as Obj[]) : [])
      .map((p) => ({
        name: String(p.name ?? '가져온 프리셋'),
        prompt: mergePrompt(p.basePrompt, p.additionalPrompt, p.detailPrompt),
        negative: removeComments(String(p.negativePrompt ?? '')).trim(),
        params: nais2PresetParams(p)
      }))
      .filter((p) => p.prompt || p.negative)
    if (presets.length) {
      db.prepare('DELETE FROM prompt_presets').run()
      for (const p of presets) {
        createPromptPreset(p.name, p.prompt, p.negative, p.params)
        res.presets++
      }
    }

    // 3. 조각 — 메타(nais2-wildcards.files) + 내용(nais2-wildcard-content[id])
    const wc = state(data, 'nais2-wildcards')
    const contentMap = (data['nais2-wildcard-content'] ?? {}) as Record<string, unknown>
    const frags = (Array.isArray(wc.files) ? (wc.files as Obj[]) : [])
      .map((f) => {
        const lines = (Array.isArray(contentMap[String(f.id)])
          ? contentMap[String(f.id)]
          : Array.isArray(f.content)
            ? f.content
            : []) as unknown[]
        return {
          name: String(f.name ?? '').trim(),
          content: lines.map((l) => String(l)).join('\n'),
          folder: f.folder ? String(f.folder) : null
        }
      })
      .filter((f) => f.name)
    if (frags.length) {
      db.prepare('DELETE FROM fragments').run()
      // 이름 UNIQUE — 충돌 시 스킵하지 말고 -2, -3 접미사로 전부 보존 (일부 누락 버그 수정)
      const used = new Set<string>()
      const unique = (name: string): string => {
        if (!used.has(name)) {
          used.add(name)
          return name
        }
        for (let n = 2; ; n++) {
          const cand = `${name}-${n}`
          if (!used.has(cand)) {
            used.add(cand)
            return cand
          }
        }
      }
      frags.forEach((f, i) => {
        // NAIS2 folder는 경로 문자열 — fragment_folders를 만들어 folder_id로 매핑 (구조 유지)
        const folderId = f.folder ? folderIdFor('fragment_folders', f.folder.replace(/\//g, '-')) : null
        db.prepare(
          'INSERT INTO fragments (name, content, folder_id, sort_order) VALUES (?, ?, ?, ?)'
        ).run(unique(f.name), f.content, folderId, i)
        res.fragments++
      })
    }

    // 4. 씬 — NAIS2: nais2-scenes.state.presets[] { name, scenes: [{name, scenePrompt, width?, height?}] }
    //    기존 NAIS3 씬은 생성 이미지와 연결돼 있어 교체하지 않고 새 프리셋으로 추가(merge).
    //    이미지(url)는 NAIS2 백업에 로컬 경로만 있어 가져오지 않음.
    const sc = state(data, 'nais2-scenes')
    if (Array.isArray(sc.presets)) {
      for (const p of sc.presets as Obj[]) {
        const scenes = (Array.isArray(p.scenes) ? (p.scenes as Obj[]) : []).map((s) => ({
          name: String(s.name ?? '씬'),
          prompt: String(s.scenePrompt ?? ''),
          width: Number(s.width) || 832,
          height: Number(s.height) || 1216
        }))
        if (!scenes.length) continue
        const maxOrder = (
          db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM scene_presets').get() as {
            m: number
          }
        ).m
        const presetId = Number(
          db
            .prepare('INSERT INTO scene_presets (name, sort_order) VALUES (?, ?)')
            .run(String(p.name ?? '가져온 씬'), maxOrder + 1).lastInsertRowid
        )
        scenes.forEach((s, i) => {
          db.prepare(
            'INSERT INTO gen_scenes (preset_id, name, prompt, width, height, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(presetId, s.name, s.prompt, s.width, s.height, i)
          res.scenes++
        })
      }
    }

    // 5. 현재 메인 프롬프트 (nais2-generation) → NAIS3 main_params에 병합
    const gen = state(data, 'nais2-generation')
    const prompt = mergePrompt(gen.basePrompt, gen.additionalPrompt, gen.detailPrompt)
    const negative = removeComments(String(gen.negativePrompt ?? '')).trim()
    if (prompt || negative) {
      let params: Record<string, unknown> = {}
      try {
        params = JSON.parse(getSetting('main_params') || '{}')
      } catch {
        params = {}
      }
      params.prompt = prompt
      params.negativePrompt = negative
      setSetting('main_params', JSON.stringify(params))
      res.prompt = true
    }
  })
  tx()
  return res
}

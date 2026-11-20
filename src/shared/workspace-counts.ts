import type { WorkspaceCounts } from './types'

/** 표시 순서 — 사람이 직접 만든 것부터, 쌓이는 생성 기록은 뒤에 */
export const WORKSPACE_COUNT_KEYS = [
  'characters',
  'fragments',
  'promptPresets',
  'scenes',
  'vibes',
  'characterReferences',
  'library',
  'history'
] as const satisfies readonly (keyof WorkspaceCounts)[]

export function emptyWorkspaceCounts(): WorkspaceCounts {
  return {
    characters: 0,
    fragments: 0,
    promptPresets: 0,
    scenes: 0,
    history: 0,
    library: 0,
    vibes: 0,
    characterReferences: 0
  }
}

export function totalWorkspaceCount(counts: WorkspaceCounts): number {
  return WORKSPACE_COUNT_KEYS.reduce((sum, key) => sum + counts[key], 0)
}

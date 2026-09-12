import type { BrowserState } from './browser-db'
import type { FragmentSource } from '../../../main/fragments/processor'

const WORKSPACE_KEYS = [
  'nextId',
  'characterFolders',
  'characters',
  'fragmentFolders',
  'fragments',
  'vibeFolders',
  'vibes',
  'vibeEncodings',
  'charRefFolders',
  'charRefs',
  'promptPresets',
  'scenePresets',
  'scenes',
  'images',
  'libraryImages',
  'libraryStacks'
] as const satisfies readonly (keyof BrowserState)[]
const SETTING_KEYS = ['main_params', 'scene_casts', 'prompt_split_enabled', 'ui_language']

type Workspace = Pick<BrowserState, (typeof WORKSPACE_KEYS)[number] | 'settings'>

export function exportBrowserWorkspace(state: BrowserState): {
  _app: 'NAIS3-web'
  version: 1
  workspace: Workspace
} {
  const workspace = Object.fromEntries(WORKSPACE_KEYS.map((key) => [key, state[key]])) as Workspace
  workspace.settings = Object.fromEntries(
    SETTING_KEYS.filter((key) => typeof state.settings[key] === 'string').map((key) => [
      key,
      state.settings[key]
    ])
  )
  return { _app: 'NAIS3-web', version: 1, workspace }
}

/** Accept old browser backups too, but never restore credentials from a workspace file. */
export function importBrowserWorkspace(state: BrowserState, input: unknown): void {
  if (!input || typeof input !== 'object') throw new Error('Invalid browser backup')
  const envelope = input as Record<string, unknown>
  if (envelope._app !== undefined && (envelope._app !== 'NAIS3-web' || envelope.version !== 1))
    throw new Error('Unsupported browser backup format')
  const data = (envelope._app === 'NAIS3-web' ? envelope.workspace : input) as BrowserState
  if (!data || !Number.isSafeInteger(data.nextId) || data.nextId < 1)
    throw new Error('Invalid browser backup workspace')
  for (const key of WORKSPACE_KEYS) {
    if (key === 'nextId') continue
    if (key === 'vibeEncodings') {
      if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key]))
        throw new Error(`Invalid browser backup: ${key}`)
    } else if (!Array.isArray(data[key])) throw new Error(`Invalid browser backup: ${key}`)
  }
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings))
    throw new Error('Invalid browser backup settings')
  const { workspace } = exportBrowserWorkspace(data)
  Object.assign(state, workspace, { settings: { ...state.settings, ...workspace.settings } })
}

export function browserFragmentSource(state: BrowserState): FragmentSource {
  const folders = new Map(state.fragmentFolders.map((folder) => [folder.id, folder.name]))
  const paths = new Map<string, string[]>()
  for (const fragment of state.fragments) {
    const name = fragment.name.trim().toLowerCase()
    const lines = fragment.content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    paths.set(name, lines)
    const folder = fragment.folderId == null ? null : folders.get(fragment.folderId)
    if (folder) paths.set(`${folder.trim().toLowerCase()}/${name}`, lines)
  }
  return { getLines: (path) => paths.get(path) ?? null }
}

export function findBrowserImage(
  state: BrowserState,
  filePath: unknown
): (BrowserState['images'][number] | BrowserState['libraryImages'][number]) | undefined {
  return (
    state.images.find((image) => image.filePath === filePath) ??
    state.libraryImages.find((image) => image.filePath === filePath)
  )
}

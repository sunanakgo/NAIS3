import type { NaisApi } from '../../../preload/index'
import type {
  CharacterOrderEntry,
  GenerationRequest,
  IpcEventMap,
  IpcInvokeMap,
  ListFolder,
  QueueStatus
} from '@shared/types'
import {
  mutateBrowserState,
  nextBrowserId,
  readBrowserState,
  type BrowserAccount,
  type BrowserImage,
  type BrowserState
} from './browser-db'

const listeners = new Map<keyof IpcEventMap, Set<(payload: unknown) => void>>()
const queue: QueueStatus = { items: [], running: false, delayMs: 600 }
const queueControllers = new Map<string, AbortController>()
let queueRunning = false

function emit<C extends keyof IpcEventMap>(channel: C, payload: IpcEventMap[C]): void {
  listeners.get(channel)?.forEach((listener) => listener(payload))
}

async function gateway<T>(route: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/__nais/api/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok || result.error)
    throw new Error(result.error ?? `Gateway error ${response.status}`)
  return result
}

function accountInfo(account: BrowserAccount): BrowserAccount {
  return { ...account, token: account.token }
}

function reorderByIds<T extends { id: number }>(items: T[], ids: number[]): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]))
  return [...items].sort((a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length))
}

function applyFolderOrder<T extends { id: number; folderId: number | null }>(
  folders: ListFolder[],
  items: T[],
  order: CharacterOrderEntry[]
): { folders: ListFolder[]; items: T[] } {
  const folderRank = new Map<number, number>()
  const itemRank = new Map<number, number>()
  let currentFolder: number | null = null
  order.forEach((entry, index) => {
    if (entry.type === 'folder') {
      currentFolder = entry.id
      folderRank.set(entry.id, index)
    } else {
      itemRank.set(entry.id, index)
      const item = items.find((candidate) => candidate.id === entry.id)
      if (item) item.folderId = currentFolder
    }
  })
  return {
    folders: [...folders].sort(
      (a, b) => (folderRank.get(a.id) ?? order.length) - (folderRank.get(b.id) ?? order.length)
    ),
    items: [...items].sort(
      (a, b) => (itemRank.get(a.id) ?? order.length) - (itemRank.get(b.id) ?? order.length)
    )
  }
}

function activeAccount(state: BrowserState): BrowserAccount | null {
  return state.accounts.find((account) => account.id === state.activeAccountId) ?? null
}

async function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve([...Array.from(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

async function fileBase64(file: File): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
    reader.readAsDataURL(file)
  })
  return url.slice(url.indexOf(',') + 1)
}

function download(base64: string, name: string, mime = 'image/png'): void {
  const anchor = document.createElement('a')
  anchor.href = `data:${mime};base64,${base64}`
  anchor.download = name
  anchor.click()
}

function webPath(base64: string): string {
  return `data:image/png;base64,${base64}`
}

async function imageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Image dimensions could not be read'))
    image.src = webPath(base64)
  })
}

async function saveBrowserImage(
  base64: string,
  kind: string,
  payloadJson: string | null = null
): Promise<string> {
  return mutateBrowserState((state) => {
    const id = nextBrowserId(state)
    const filePath = webPath(base64)
    state.images.unshift({
      id,
      filePath,
      thumbnail: base64,
      kind,
      seed: null,
      createdAt: new Date().toISOString(),
      base64,
      payloadJson,
      sceneId: null,
      favorite: false
    })
    return filePath
  })
}

async function recordAnlasSpend(
  token: string,
  operation: () => Promise<{ base64: string }>
): Promise<{ base64: string }> {
  const before = await gateway<IpcInvokeMap['nai:balance']['res']>('balance', { token })
  const result = await operation()
  const after = await gateway<IpcInvokeMap['nai:balance']['res']>('balance', { token })
  if (before.anlas != null && after.anlas != null && before.anlas > after.anlas) {
    await mutateBrowserState((state) => {
      state.anlasLog.push({ at: new Date().toISOString(), spent: before.anlas! - after.anlas! })
    })
  }
  return result
}

async function runQueue(): Promise<void> {
  if (queueRunning) return
  queueRunning = true
  queue.running = true
  emit('queue:changed', structuredClone(queue))
  try {
    let item = queue.items.find((candidate) => candidate.state === 'pending')
    while (item) {
      item.state = 'generating'
      emit('queue:changed', structuredClone(queue))
      const controller = new AbortController()
      queueControllers.set(item.id, controller)
      try {
        const state = await readBrowserState()
        const account = activeAccount(state)
        if (!account) throw new Error('NAI token is not configured')
        const before = await gateway<IpcInvokeMap['nai:balance']['res']>(
          'balance',
          {
            token: account.token
          },
          controller.signal
        )
        const selectedVibes =
          item.request.vibeIds !== undefined
            ? state.vibes.filter((vibe) => item!.request.vibeIds!.includes(vibe.id))
            : state.vibes.filter((vibe) => vibe.enabled)
        const selectedCharRefs =
          item.request.charRefIds !== undefined
            ? state.charRefs.filter((reference) => item!.request.charRefIds!.includes(reference.id))
            : state.charRefs.filter((reference) => reference.enabled)
        const result = await gateway<{
          base64: string
          payloadJson: string
          vibeEncodings: { id: number; encodedBase64: string }[]
        }>(
          'generate',
          {
            token: account.token,
            request: item.request,
            vibes: selectedVibes.map((vibe) => ({
              id: vibe.id,
              imageBase64: vibe.thumbnail,
              strength: vibe.strength,
              informationExtracted: vibe.infoExtracted,
              encodedBase64:
                state.vibeEncodings[`${vibe.id}:${item!.request.model}:${vibe.infoExtracted}`]
            })),
            characterReferences: selectedCharRefs.map((reference) => ({
              imageBase64: reference.thumbnail,
              referenceType: reference.refType,
              strength: reference.strength,
              fidelity: reference.fidelity
            }))
          },
          controller.signal
        )
        const image = await mutateBrowserState((next) => {
          const id = nextBrowserId(next)
          const created: BrowserImage = {
            id,
            filePath: webPath(result.base64),
            thumbnail: result.base64,
            kind: 'generated',
            seed: item!.request.seed,
            createdAt: new Date().toISOString(),
            base64: result.base64,
            payloadJson: result.payloadJson,
            sceneId: item!.request.sceneId ?? null,
            favorite: false
          }
          next.images.unshift(created)
          for (const encoding of result.vibeEncodings) {
            const vibe = next.vibes.find((candidate) => candidate.id === encoding.id)
            if (!vibe) continue
            next.vibeEncodings[`${vibe.id}:${item!.request.model}:${vibe.infoExtracted}`] =
              encoding.encodedBase64
            vibe.encodedModels = [...new Set([...(vibe.encodedModels ?? []), item!.request.model])]
            vibe.encodedReady = true
          }
          const scene = next.scenes.find((candidate) => candidate.id === created.sceneId)
          if (scene) {
            scene.imageCount += 1
            scene.thumbnail = created.thumbnail
            scene.thumbnailPath = created.filePath
          }
          return created
        })
        const after = await gateway<IpcInvokeMap['nai:balance']['res']>(
          'balance',
          {
            token: account.token
          },
          controller.signal
        )
        if (before.anlas != null && after.anlas != null && before.anlas > after.anlas) {
          await mutateBrowserState((next) => {
            next.anlasLog.push({
              at: new Date().toISOString(),
              spent: before.anlas! - after.anlas!
            })
          })
        }
        item.filePath = image.filePath
        item.state = 'done'
        if (image.sceneId != null) {
          emit('scenes:changed', { sceneId: image.sceneId, filePath: image.filePath })
        }
      } catch (error) {
        if (controller.signal.aborted) item.state = 'cancelled'
        else {
          item.state = 'failed'
          item.error = error instanceof Error ? error.message : String(error)
        }
      } finally {
        queueControllers.delete(item.id)
      }
      emit('queue:changed', structuredClone(queue))
      await new Promise((resolve) => setTimeout(resolve, queue.delayMs))
      item = queue.items.find((candidate) => candidate.state === 'pending')
    }
  } finally {
    queue.running = false
    queueRunning = false
    emit('queue:changed', structuredClone(queue))
  }
}

async function dispatch(channel: string, rawRequest: unknown): Promise<unknown> {
  const request = (rawRequest ?? {}) as Record<string, unknown>

  if (channel === 'db:status') return { version: 1, path: 'IndexedDB/nais3-web' }
  if (channel === 'app:version') return { version: 'web-dev' }
  if (channel === 'settings:get') {
    const state = await readBrowserState()
    return { value: state.settings[String(request.key)] ?? null }
  }
  if (channel === 'settings:set') {
    await mutateBrowserState((state) => {
      state.settings[String(request.key)] = String(request.value)
    })
    return undefined
  }

  if (channel === 'nai:verifyToken') return gateway('verify-token', request)
  if (channel === 'nai:setToken') {
    const result = await gateway<IpcInvokeMap['nai:setToken']['res']>('verify-token', request)
    if (result.valid) {
      await mutateBrowserState((state) => {
        const token = String(request.token).trim()
        const existing = activeAccount(state)
        if (existing) {
          existing.token = token
          existing.prefix = token.slice(0, 4)
          existing.suffix = token.slice(-4)
          existing.length = token.length
        } else {
          const id = crypto.randomUUID()
          state.accounts.push({
            id,
            label: 'Account 1',
            token,
            prefix: token.slice(0, 4),
            suffix: token.slice(-4),
            length: token.length,
            active: true
          })
          state.activeAccountId = id
        }
      })
    }
    return result
  }
  if (channel === 'nai:tokenStatus') {
    const account = activeAccount(await readBrowserState())
    return { hasToken: !!account, prefix: account?.prefix ?? '', length: account?.length ?? 0 }
  }
  if (channel === 'nai:revealToken')
    return { token: activeAccount(await readBrowserState())?.token ?? null }
  if (channel === 'nai:deleteToken') {
    await mutateBrowserState((state) => {
      state.accounts = []
      state.activeAccountId = null
    })
    return undefined
  }
  if (channel === 'nai:listAccounts') {
    const state = await readBrowserState()
    const balances = await Promise.all(
      state.accounts.map(async (account) => {
        const balance = await gateway<IpcInvokeMap['nai:balance']['res']>('balance', {
          token: account.token
        })
        return { ...accountInfo(account), ...balance, active: account.id === state.activeAccountId }
      })
    )
    return {
      accounts: balances.map(({ token, ...account }) => {
        void token
        return account
      }),
      activeId: state.activeAccountId
    }
  }
  if (channel === 'nai:addAccount') {
    const verification = await gateway<IpcInvokeMap['nai:verifyToken']['res']>(
      'verify-token',
      request
    )
    if (!verification.valid) return verification
    const accountId = await mutateBrowserState((state) => {
      const token = String(request.token).trim()
      const duplicate = state.accounts.find((account) => account.token === token)
      if (duplicate) {
        state.activeAccountId = duplicate.id
        return duplicate.id
      }
      const id = crypto.randomUUID()
      state.accounts.push({
        id,
        label: String(request.label ?? '').trim() || `Account ${state.accounts.length + 1}`,
        token,
        prefix: token.slice(0, 4),
        suffix: token.slice(-4),
        length: token.length,
        active: true
      })
      state.activeAccountId = id
      return id
    })
    emit('nai:accountChanged', { accountId, reason: 'added' })
    return { ...verification, accountId }
  }
  if (channel === 'nai:setActiveAccount') {
    const account = await mutateBrowserState((state) => {
      const selected = state.accounts.find((candidate) => candidate.id === request.id) ?? null
      if (selected) state.activeAccountId = selected.id
      return selected
    })
    if (!account) return { active: false, anlas: null, tier: null }
    const balance = await gateway<IpcInvokeMap['nai:balance']['res']>('balance', {
      token: account.token
    })
    emit('nai:accountChanged', { accountId: account.id, reason: 'selected', label: account.label })
    return { active: true, ...balance }
  }
  if (channel === 'nai:revealAccountToken') {
    const state = await readBrowserState()
    return { token: state.accounts.find((account) => account.id === request.id)?.token ?? null }
  }
  if (channel === 'nai:deleteAccount') {
    const activeId = await mutateBrowserState((state) => {
      state.accounts = state.accounts.filter((account) => account.id !== request.id)
      if (state.activeAccountId === request.id)
        state.activeAccountId = state.accounts[0]?.id ?? null
      return state.activeAccountId
    })
    emit('nai:accountChanged', { accountId: activeId, reason: 'deleted' })
    return { activeId }
  }
  if (channel === 'nai:balance') {
    const account = activeAccount(await readBrowserState())
    return account ? gateway('balance', { token: account.token }) : { anlas: null, tier: null }
  }
  if (channel === 'nai:anlasUsage') {
    const state = await readBrowserState()
    const now = Date.now()
    const dayAgo = now - 24 * 60 * 60 * 1000
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000
    return {
      today: state.anlasLog
        .filter((entry) => Date.parse(entry.at) >= dayAgo)
        .reduce((sum, entry) => sum + entry.spent, 0),
      week: state.anlasLog
        .filter((entry) => Date.parse(entry.at) >= weekAgo)
        .reduce((sum, entry) => sum + entry.spent, 0)
    }
  }

  if (channel === 'queue:status') return structuredClone(queue)
  if (channel === 'queue:enqueue') {
    const generation = request.request as GenerationRequest
    const count = Math.max(1, Number(request.count) || 1)
    const ids = Array.from({ length: count }, (_, index) => {
      const id = crypto.randomUUID()
      queue.items.push({
        id,
        state: 'pending',
        request: index === 0 ? generation : { ...generation, seed: generation.seed + index }
      })
      return id
    })
    emit('queue:changed', structuredClone(queue))
    void runQueue()
    return { ids }
  }
  if (channel === 'queue:cancel') {
    const ids = new Set(request.ids as string[])
    queue.items.forEach((item) => {
      if (ids.has(item.id) && item.state === 'pending') item.state = 'cancelled'
      if (ids.has(item.id) && item.state === 'generating') queueControllers.get(item.id)?.abort()
    })
    emit('queue:changed', structuredClone(queue))
    return undefined
  }
  if (channel === 'gen:setDelay') {
    queue.delayMs = Math.max(0, Number(request.ms) || 0)
    await mutateBrowserState((state) => {
      state.settings.gen_delay_ms = String(queue.delayMs)
    })
    return undefined
  }

  if (channel === 'chars:list') {
    const state = await readBrowserState()
    return { folders: state.characterFolders, items: state.characters }
  }
  if (channel === 'chars:create') {
    const id = await mutateBrowserState((state) => {
      const id = nextBrowserId(state)
      state.characters.push({
        id,
        name: String(request.name ?? ''),
        prompt: '',
        negativePrompt: '',
        thumbnail: '',
        enabled: false,
        center: { x: 0.5, y: 0.5 },
        folderId: (request.folderId as number | null) ?? null
      })
      return id
    })
    return { id }
  }
  if (channel === 'chars:update') {
    await mutateBrowserState((state) => {
      const item = state.characters.find((candidate) => candidate.id === request.id)
      if (item) Object.assign(item, request.patch)
    })
    return undefined
  }
  if (channel === 'chars:delete') {
    await mutateBrowserState((state) => {
      state.characters = state.characters.filter((item) => item.id !== request.id)
    })
    return undefined
  }
  if (channel === 'chars:duplicate') {
    const id = await mutateBrowserState((state) => {
      const source = state.characters.find((item) => item.id === request.id)
      if (!source) return 0
      const id = nextBrowserId(state)
      state.characters.push({ ...structuredClone(source), id, name: `${source.name} copy` })
      return id
    })
    return { id }
  }
  if (channel === 'chars:pickThumbnail') {
    const file = (await pickFiles('image/*'))[0]
    if (!file) return { thumbnail: null }
    const thumbnail = await fileBase64(file)
    await mutateBrowserState((state) => {
      const item = state.characters.find((candidate) => candidate.id === request.id)
      if (item) item.thumbnail = thumbnail
    })
    return { thumbnail }
  }
  if (channel === 'chars:clearThumbnail') {
    await mutateBrowserState((state) => {
      const item = state.characters.find((candidate) => candidate.id === request.id)
      if (item) item.thumbnail = ''
    })
    return undefined
  }
  if (channel === 'chars:reorder') {
    await mutateBrowserState((state) => {
      const ordered = applyFolderOrder(
        state.characterFolders,
        state.characters,
        request.order as CharacterOrderEntry[]
      )
      state.characterFolders = ordered.folders
      state.characters = ordered.items
    })
    return undefined
  }
  if (channel.startsWith('chars:folder')) return folderDispatch(channel, request, 'character')

  if (channel === 'frags:list') {
    const state = await readBrowserState()
    return { folders: state.fragmentFolders, items: state.fragments }
  }
  if (channel === 'frags:create') {
    const id = await mutateBrowserState((state) => {
      const id = nextBrowserId(state)
      state.fragments.push({
        id,
        name: String(request.name),
        content: '',
        folderId: (request.folderId as number | null) ?? null
      })
      return id
    })
    return { id }
  }
  if (channel === 'frags:update') {
    await mutateBrowserState((state) => {
      const item = state.fragments.find((candidate) => candidate.id === request.id)
      if (item) Object.assign(item, request.patch)
    })
    return undefined
  }
  if (channel === 'frags:delete') {
    await mutateBrowserState((state) => {
      state.fragments = state.fragments.filter((item) => item.id !== request.id)
    })
    return undefined
  }
  if (channel === 'frags:duplicate') {
    const id = await mutateBrowserState((state) => {
      const source = state.fragments.find((item) => item.id === request.id)
      if (!source) return null
      const id = nextBrowserId(state)
      state.fragments.push({ ...source, id, name: `${source.name} copy` })
      return id
    })
    return { id }
  }
  if (channel === 'frags:reorder') {
    await mutateBrowserState((state) => {
      const ordered = applyFolderOrder(
        state.fragmentFolders,
        state.fragments,
        request.order as CharacterOrderEntry[]
      )
      state.fragmentFolders = ordered.folders
      state.fragments = ordered.items
    })
    return undefined
  }
  if (channel === 'frags:importTxt') {
    const files = await pickFiles('.txt,text/plain', true)
    await mutateBrowserState(async (state) => {
      for (const file of files)
        state.fragments.push({
          id: nextBrowserId(state),
          name: file.name.replace(/\.txt$/i, ''),
          content: await file.text(),
          folderId: null
        })
    })
    return { count: files.length }
  }
  if (channel === 'frags:exportTxt') {
    const fragment = (await readBrowserState()).fragments.find((item) => item.id === request.id)
    if (!fragment) return { saved: false }
    download(
      btoa(unescape(encodeURIComponent(fragment.content))),
      `${fragment.name}.txt`,
      'text/plain;charset=utf-8'
    )
    return { saved: true }
  }
  if (channel === 'frags:exportAll') {
    throw new Error('Fragment ZIP export is not available in the browser runtime yet')
  }
  if (channel === 'frags:resetSequential') return undefined
  if (channel.startsWith('frags:folder')) return folderDispatch(channel, request, 'fragment')

  if (channel.startsWith('vibes:') || channel.startsWith('crefs:'))
    return refsDispatch(channel, request)
  if (channel === 'tags:search') return gateway('tags', request)
  if (channel === 'tokens:count') return gateway('tokens', request)

  if (channel === 'images:list') {
    const state = await readBrowserState()
    const offset = Number(request.offset) || 0
    const limit = Number(request.limit) || 60
    return { items: state.images.slice(offset, offset + limit), total: state.images.length }
  }
  if (channel === 'images:payload') {
    const item = (await readBrowserState()).images.find((candidate) => candidate.id === request.id)
    return { payloadJson: item?.payloadJson ?? null }
  }
  if (channel === 'images:readForSource') {
    const item = (await readBrowserState()).images.find(
      (candidate) => candidate.filePath === request.filePath
    )
    if (!item) return { error: 'Image not found' }
    return { base64: item.base64, ...(await imageDimensions(item.base64)) }
  }
  if (channel === 'images:readMetadata') {
    const state = await readBrowserState()
    const item = state.images.find((candidate) => candidate.filePath === request.filePath)
    if (!item) return { error: 'Metadata is unavailable for this image' }
    const sent = item.payloadJson
      ? (JSON.parse(item.payloadJson) as {
          input?: string
          model?: string
          parameters?: Record<string, unknown>
        })
      : null
    const parameters = sent?.parameters ?? {}
    return {
      meta: {
        prompt: sent?.input ?? '',
        negativePrompt: '',
        seed: item.seed ?? undefined,
        width: Number(parameters.width) || undefined,
        height: Number(parameters.height) || undefined,
        model: sent?.model
      }
    }
  }
  if (channel === 'images:analyzeArtists') {
    const state = await readBrowserState()
    const stored = state.images.find((candidate) => candidate.filePath === request.filePath)
    const imageBase64 = String(request.base64 ?? stored?.base64 ?? '')
    if (!imageBase64) return { error: 'Image not found' }
    return gateway('analyze-artists', { imageBase64 })
  }
  if (channel === 'images:upscale') {
    const account = activeAccount(await readBrowserState())
    if (!account) return { error: 'NAI token is not configured' }
    try {
      const result = await recordAnlasSpend(account.token, () =>
        gateway('upscale', {
          token: account.token,
          imageBase64: request.imageBase64,
          scale: request.scale
        })
      )
      const filePath = await saveBrowserImage(
        result.base64,
        'upscale',
        JSON.stringify({ upscale: request.scale })
      )
      return { filePath, base64: result.base64 }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  if (channel === 'director:run') {
    const account = activeAccount(await readBrowserState())
    if (!account) return { error: 'NAI token is not configured' }
    try {
      const result = await recordAnlasSpend(account.token, () =>
        gateway('director', {
          token: account.token,
          method: request.method,
          imageBase64: request.imageBase64,
          prompt: request.prompt,
          defry: request.defry
        })
      )
      const filePath = await saveBrowserImage(
        result.base64,
        String(request.method),
        JSON.stringify({ director: request.method, prompt: request.prompt, defry: request.defry })
      )
      return { filePath, base64: result.base64 }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  if (channel === 'images:saveAs') {
    const item = (await readBrowserState()).images.find(
      (candidate) => candidate.filePath === request.filePath
    )
    if (!item) return { saved: false }
    download(item.base64, `nais3-${item.id}.png`)
    return { saved: true }
  }
  if (channel === 'images:saveBase64As') {
    download(String(request.base64), String(request.defaultName ?? 'nais3.png'))
    return { saved: true }
  }
  if (channel === 'images:copy') {
    const item = (await readBrowserState()).images.find(
      (candidate) => candidate.filePath === request.filePath
    )
    if (!item || !navigator.clipboard || typeof ClipboardItem === 'undefined')
      return { copied: false }
    const blob = await (await fetch(webPath(item.base64))).blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return { copied: true }
  }
  if (channel === 'images:delete') {
    await mutateBrowserState((state) => {
      state.images = state.images.filter((item) => item.id !== request.id)
    })
    return undefined
  }
  if (channel === 'images:clearAll') {
    const count = await mutateBrowserState((state) => {
      const count = state.images.length
      state.images = []
      return count
    })
    return { count }
  }
  if (channel === 'images:setFavorite') {
    await mutateBrowserState((state) => {
      const item = state.images.find((candidate) => candidate.id === request.id)
      if (item) item.favorite = Boolean(request.favorite)
    })
    return undefined
  }
  if (channel === 'images:showInFolder') return undefined
  if (channel === 'images:saveLocal') {
    const base64 = String(request.base64)
    const filePath = await saveBrowserImage(base64, 'mosaic')
    return { filePath }
  }

  if (channel.startsWith('scenePresets:') || channel.startsWith('scenes:'))
    return scenesDispatch(channel, request)
  if (channel.startsWith('promptPresets:')) return promptPresetsDispatch(channel, request)
  if (channel.startsWith('library:')) return libraryDispatch(channel, request)

  if (channel === 'settings:getSaveDir') return { dir: 'Browser downloads', isDefault: true }
  if (channel === 'settings:pickSaveDir') return { dir: null }
  if (channel === 'settings:resetSaveDir') return { dir: 'Browser downloads' }
  if (
    channel === 'window:control' ||
    channel === 'window:setBackground' ||
    channel === 'notify:done' ||
    channel === 'update:start'
  )
    return undefined
  if (channel === 'backup:export') {
    const state = await readBrowserState()
    download(
      btoa(unescape(encodeURIComponent(JSON.stringify(state, null, 2)))),
      'nais3-web-backup.json',
      'application/json'
    )
    return { saved: true }
  }
  if (channel === 'backup:import') {
    const file = (await pickFiles('.json,application/json'))[0]
    if (!file) return { canceled: true }
    try {
      const parsed = JSON.parse(await file.text()) as BrowserState
      await mutateBrowserState((state) => Object.assign(state, parsed))
      return { summary: 'Browser backup imported', needsPromptReload: true }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  if (channel === 'update:status') return undefined

  throw new Error(`Browser runtime does not support ${channel}`)
}

async function folderDispatch(
  channel: string,
  request: Record<string, unknown>,
  kind: 'character' | 'fragment'
): Promise<unknown> {
  return mutateBrowserState((state) => {
    const folders = kind === 'character' ? state.characterFolders : state.fragmentFolders
    const items = kind === 'character' ? state.characters : state.fragments
    if (channel.endsWith('folderCreate')) {
      const id = nextBrowserId(state)
      folders.push({ id, name: String(request.name), collapsed: false, color: null })
      return { id }
    }
    const folder = folders.find((candidate) => candidate.id === request.id)
    if (channel.endsWith('folderRename') && folder) folder.name = String(request.name)
    if (channel.endsWith('folderCollapse') && folder) folder.collapsed = Boolean(request.collapsed)
    if (channel.endsWith('folderColor') && folder) folder.color = request.color as string | null
    if (channel.endsWith('folderDelete')) {
      const index = folders.findIndex((candidate) => candidate.id === request.id)
      if (index >= 0) folders.splice(index, 1)
      items.forEach((item) => {
        if (item.folderId === request.id) item.folderId = null
      })
    }
    return undefined
  })
}

async function refsDispatch(channel: string, request: Record<string, unknown>): Promise<unknown> {
  const vibe = channel.startsWith('vibes:')
  return mutateBrowserState(async (state) => {
    const items = vibe ? state.vibes : state.charRefs
    const folders = vibe ? state.vibeFolders : state.charRefFolders
    const action = channel.slice(channel.indexOf(':') + 1)
    if (action === 'list') return { folders, items }
    if (action === 'add') {
      const files = await pickFiles('image/*', true)
      for (const file of files) {
        const thumbnail = await fileBase64(file)
        const id = nextBrowserId(state)
        if (vibe)
          state.vibes.push({
            id,
            name: file.name,
            thumbnail,
            enabled: true,
            strength: 0.6,
            infoExtracted: 1,
            encodedReady: false,
            folderId: (request.folderId as number | null) ?? null
          })
        else
          state.charRefs.push({
            id,
            name: file.name,
            thumbnail,
            enabled: true,
            refType: 'character&style',
            strength: 1,
            fidelity: 1,
            folderId: (request.folderId as number | null) ?? null
          })
      }
      return { count: files.length }
    }
    if (action === 'update') {
      const item = items.find((candidate) => candidate.id === request.id)
      if (item) Object.assign(item, request.patch)
      return undefined
    }
    if (action === 'delete') {
      if (vibe) state.vibes = state.vibes.filter((item) => item.id !== request.id)
      else state.charRefs = state.charRefs.filter((item) => item.id !== request.id)
      return undefined
    }
    if (action === 'duplicate') {
      const source = items.find((candidate) => candidate.id === request.id)
      if (!source) return { id: 0 }
      const id = nextBrowserId(state)
      if (vibe) state.vibes.push({ ...structuredClone(source), id } as (typeof state.vibes)[number])
      else
        state.charRefs.push({ ...structuredClone(source), id } as (typeof state.charRefs)[number])
      return { id }
    }
    if (action === 'reorder') {
      if (vibe) {
        const ordered = applyFolderOrder(
          state.vibeFolders,
          state.vibes,
          request.order as CharacterOrderEntry[]
        )
        state.vibeFolders = ordered.folders
        state.vibes = ordered.items
      } else {
        const ordered = applyFolderOrder(
          state.charRefFolders,
          state.charRefs,
          request.order as CharacterOrderEntry[]
        )
        state.charRefFolders = ordered.folders
        state.charRefs = ordered.items
      }
      return undefined
    }
    if (action === 'folderCreate') {
      const id = nextBrowserId(state)
      folders.push({ id, name: String(request.name), collapsed: false, color: null })
      return { id }
    }
    const folder = folders.find((candidate) => candidate.id === request.id)
    if (action === 'folderRename' && folder) folder.name = String(request.name)
    if (action === 'folderCollapse' && folder) folder.collapsed = Boolean(request.collapsed)
    if (action === 'folderColor' && folder) folder.color = request.color as string | null
    if (action === 'folderDelete') {
      const index = folders.findIndex((candidate) => candidate.id === request.id)
      if (index >= 0) folders.splice(index, 1)
      items.forEach((item) => {
        if (item.folderId === request.id) item.folderId = null
      })
    }
    return undefined
  })
}

async function promptPresetsDispatch(
  channel: string,
  request: Record<string, unknown>
): Promise<unknown> {
  return mutateBrowserState((state) => {
    const action = channel.slice(channel.indexOf(':') + 1)
    if (action === 'list') return { items: state.promptPresets }
    if (action === 'create') {
      const id = nextBrowserId(state)
      state.promptPresets.push({
        id,
        name: String(request.name),
        prompt: String(request.prompt),
        negativePrompt: String(request.negativePrompt),
        params: (request.params as never) ?? null,
        promptParts: null
      })
      return { id }
    }
    if (action === 'update') {
      const item = state.promptPresets.find((candidate) => candidate.id === request.id)
      if (item) Object.assign(item, request.patch)
    }
    if (action === 'delete')
      state.promptPresets = state.promptPresets.filter((item) => item.id !== request.id)
    if (action === 'reorder')
      state.promptPresets = reorderByIds(state.promptPresets, request.ids as number[])
    return undefined
  })
}

async function scenesDispatch(channel: string, request: Record<string, unknown>): Promise<unknown> {
  return mutateBrowserState((state) => {
    if (channel === 'scenePresets:list') return { items: state.scenePresets }
    if (channel === 'scenePresets:create') {
      const id = nextBrowserId(state)
      state.scenePresets.push({
        id,
        name: String(request.name),
        defaultWidth: null,
        defaultHeight: null,
        characterIds: null
      })
      return { id }
    }
    if (channel === 'scenePresets:rename') {
      const item = state.scenePresets.find((candidate) => candidate.id === request.id)
      if (item) item.name = String(request.name)
      return undefined
    }
    if (channel === 'scenePresets:delete') {
      state.scenePresets = state.scenePresets.filter((item) => item.id !== request.id)
      state.scenes = state.scenes.filter((item) => item.presetId !== request.id)
      return undefined
    }
    if (channel === 'scenePresets:reorder') {
      state.scenePresets = reorderByIds(state.scenePresets, request.ids as number[])
      return undefined
    }
    if (
      channel === 'scenePresets:setDefaultResolution' ||
      channel === 'scenePresets:setCharacters'
    ) {
      const item = state.scenePresets.find((candidate) => candidate.id === request.id)
      if (item && channel.endsWith('setDefaultResolution')) {
        item.defaultWidth = Number(request.width)
        item.defaultHeight = Number(request.height)
      }
      if (item && channel.endsWith('setCharacters'))
        item.characterIds = request.characterIds as number[] | null
      return undefined
    }
    if (channel === 'scenes:list')
      return { items: state.scenes.filter((scene) => scene.presetId === request.presetId) }
    if (channel === 'scenes:get')
      return { scene: state.scenes.find((scene) => scene.id === request.id) ?? null }
    if (channel === 'scenes:create') {
      const preset = state.scenePresets.find((item) => item.id === request.presetId)
      const id = nextBrowserId(state)
      state.scenes.push({
        id,
        presetId: Number(request.presetId),
        name: String(request.name),
        prompt: '',
        negativePrompt: '',
        width: preset?.defaultWidth ?? 832,
        height: preset?.defaultHeight ?? 1216,
        reserveCount: 0,
        reserves: {},
        thumbnail: '',
        thumbnailPath: '',
        imageCount: 0,
        hasFavorite: false
      })
      return { id }
    }
    if (channel === 'scenes:update') {
      const scene = state.scenes.find((item) => item.id === request.id)
      if (scene) Object.assign(scene, request.patch)
      return undefined
    }
    if (channel === 'scenes:duplicate') {
      const source = state.scenes.find((item) => item.id === request.id)
      if (!source) return { id: 0 }
      const id = nextBrowserId(state)
      state.scenes.push({ ...structuredClone(source), id, name: `${source.name} copy` })
      return { id }
    }
    if (channel === 'scenes:delete')
      state.scenes = state.scenes.filter((item) => item.id !== request.id)
    if (channel === 'scenes:reorder')
      state.scenes = reorderByIds(state.scenes, request.ids as number[])
    if (channel === 'scenes:setReserveAll')
      state.scenes
        .filter((item) => item.presetId === request.presetId)
        .forEach((item) => {
          item.reserves = Number(request.count) > 0 ? { '': Number(request.count) } : {}
          item.reserveCount = Number(request.count)
        })
    if (channel === 'scenes:adjustReserveAll') {
      state.scenes
        .filter((item) => item.presetId === request.presetId)
        .forEach((item) => {
          const castId = String(request.castId)
          item.reserves[castId] = Math.max(0, (item.reserves[castId] ?? 0) + Number(request.delta))
          item.reserveCount = Object.values(item.reserves).reduce((sum, value) => sum + value, 0)
        })
    }
    if (channel === 'scenes:setReserves') {
      const scene = state.scenes.find((item) => item.id === request.id)
      if (scene) {
        scene.reserves = request.reserves as Record<string, number>
        scene.reserveCount = Object.values(scene.reserves).reduce((sum, value) => sum + value, 0)
      }
    }
    if (channel === 'scenes:reservedTotal')
      return { total: state.scenes.reduce((sum, scene) => sum + scene.reserveCount, 0) }
    if (channel === 'scenes:images') {
      const all = state.images.filter(
        (image) => image.sceneId === request.sceneId && (!request.favoritesOnly || image.favorite)
      )
      const offset = Number(request.offset) || 0
      const limit = Number(request.limit) || 60
      return { items: all.slice(offset, offset + limit), total: all.length }
    }
    if (channel === 'scenes:deleteNonFavorites') {
      const before = state.images.length
      state.images = state.images.filter(
        (image) => image.sceneId !== request.sceneId || image.favorite
      )
      return { deleted: before - state.images.length }
    }
    if (channel === 'scenes:bulkMove')
      state.scenes
        .filter((item) => (request.ids as number[]).includes(item.id))
        .forEach((item) => {
          item.presetId = Number(request.presetId)
        })
    if (channel === 'scenes:bulkDelete')
      state.scenes = state.scenes.filter((item) => !(request.ids as number[]).includes(item.id))
    if (channel === 'scenes:bulkSetResolution')
      state.scenes
        .filter((item) => (request.ids as number[]).includes(item.id))
        .forEach((item) => {
          item.width = Number(request.width)
          item.height = Number(request.height)
        })
    if (channel === 'scenes:bulkAdjustReserve') {
      state.scenes
        .filter((item) => (request.ids as number[]).includes(item.id))
        .forEach((item) => {
          const castId = String(request.castId)
          item.reserves[castId] = Math.max(0, (item.reserves[castId] ?? 0) + Number(request.delta))
          item.reserveCount = Object.values(item.reserves).reduce((sum, value) => sum + value, 0)
        })
    }
    if (channel === 'scenes:bulkClearFavorites') {
      state.images
        .filter((image) => (request.ids as number[]).includes(image.sceneId ?? -1))
        .forEach((image) => {
          image.favorite = false
        })
    }
    if (channel === 'scenes:bulkClearImages') {
      const before = state.images.length
      state.images = state.images.filter(
        (image) => !(request.ids as number[]).includes(image.sceneId ?? -1)
      )
      return { deleted: before - state.images.length }
    }
    if (
      channel.endsWith('exportJson') ||
      channel.endsWith('exportZip') ||
      channel.endsWith('bulkExportZip') ||
      channel === 'scenes:importJson'
    ) {
      throw new Error(`${channel} is not available in the browser runtime yet`)
    }
    if (channel === 'scenes:openFolder') return { ok: false }
    return undefined
  })
}

async function libraryDispatch(
  channel: string,
  request: Record<string, unknown>
): Promise<unknown> {
  return mutateBrowserState(async (state) => {
    const action = channel.slice(channel.indexOf(':') + 1)
    if (action === 'list') {
      const stackId = request.stackId as number | null | undefined
      const all = state.libraryImages.filter((item) =>
        stackId === undefined ? item.stackId == null : item.stackId === stackId
      )
      const offset = Number(request.offset) || 0
      const limit = Number(request.limit) || 60
      const stacks = state.libraryStacks.map((stack) => {
        const images = state.libraryImages.filter((item) => item.stackId === stack.id)
        return {
          ...stack,
          count: images.length,
          coverThumbnail: images.at(-1)?.thumbnail ?? ''
        }
      })
      return {
        items: all.slice(offset, offset + limit),
        stacks: stackId === undefined || stackId === null ? stacks : [],
        total: all.length
      }
    }
    if (action === 'import') {
      const files = await pickFiles('image/*', true)
      for (const file of files) {
        const base64 = await fileBase64(file)
        const id = nextBrowserId(state)
        state.libraryImages.push({
          id,
          name: file.name,
          filePath: webPath(base64),
          thumbnail: base64,
          width: null,
          height: null,
          stackId: (request.stackId as number | null) ?? null,
          base64
        })
      }
      return { count: files.length }
    }
    if (action === 'importImages') {
      const images = request.images as { name: string; base64: string }[]
      images.forEach((image) => {
        const id = nextBrowserId(state)
        state.libraryImages.push({
          id,
          name: image.name,
          filePath: webPath(image.base64),
          thumbnail: image.base64,
          width: null,
          height: null,
          stackId: (request.stackId as number | null) ?? null,
          base64: image.base64
        })
      })
      return { count: images.length }
    }
    if (action === 'importPaths') {
      const source = state.images.filter((image) =>
        (request.filePaths as string[]).includes(image.filePath)
      )
      source.forEach((image) => {
        const id = nextBrowserId(state)
        state.libraryImages.push({
          id,
          name: `image-${id}.png`,
          filePath: image.filePath,
          thumbnail: image.thumbnail,
          width: null,
          height: null,
          stackId: (request.stackId as number | null) ?? null,
          base64: image.base64
        })
      })
      return { count: source.length }
    }
    if (action === 'delete')
      state.libraryImages = state.libraryImages.filter(
        (item) => !(request.ids as number[]).includes(item.id)
      )
    if (action === 'reorder')
      state.libraryImages = reorderByIds(state.libraryImages, request.ids as number[])
    if (action === 'stackCreate') {
      const id = nextBrowserId(state)
      state.libraryStacks.push({ id, name: String(request.name), count: 0, coverThumbnail: '' })
      state.libraryImages
        .filter((item) => (request.imageIds as number[]).includes(item.id))
        .forEach((item) => {
          item.stackId = id
        })
      return { id }
    }
    if (action === 'stackRename') {
      const stack = state.libraryStacks.find((item) => item.id === request.id)
      if (stack) stack.name = String(request.name)
    }
    if (action === 'stackDelete') {
      state.libraryStacks = state.libraryStacks.filter((item) => item.id !== request.id)
      state.libraryImages
        .filter((item) => item.stackId === request.id)
        .forEach((item) => {
          item.stackId = null
        })
    }
    if (action === 'stackSet')
      state.libraryImages
        .filter((item) => (request.imageIds as number[]).includes(item.id))
        .forEach((item) => {
          item.stackId = request.stackId as number | null
        })
    if (action === 'export') {
      const images = state.libraryImages.filter((item) =>
        (request.ids as number[]).includes(item.id)
      )
      images.forEach((image, index) =>
        download(
          image.base64,
          `${String(request.prefix ?? 'nais3')}_${String(index + 1).padStart(3, '0')}.png`
        )
      )
      return { count: images.length }
    }
    if (action === 'exportStack') {
      const images = state.libraryImages.filter((item) => item.stackId === request.id)
      images.forEach((image, index) =>
        download(image.base64, `nais3_${String(index + 1).padStart(3, '0')}.png`)
      )
      return { count: images.length }
    }
    return undefined
  })
}

function install(): void {
  if (window.nais) return
  const api: NaisApi = {
    invoke<C extends keyof IpcInvokeMap>(channel: C, request: IpcInvokeMap[C]['req']) {
      return dispatch(channel, request) as Promise<IpcInvokeMap[C]['res']>
    },
    on<C extends keyof IpcEventMap>(channel: C, listener: (payload: IpcEventMap[C]) => void) {
      const set = listeners.get(channel) ?? new Set<(payload: unknown) => void>()
      listeners.set(channel, set)
      const wrapped = (payload: unknown): void => listener(payload as IpcEventMap[C])
      set.add(wrapped)
      return () => set.delete(wrapped)
    }
  }
  window.nais = api
}

install()

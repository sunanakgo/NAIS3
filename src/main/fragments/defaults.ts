import type Database from 'better-sqlite3'

export interface DefaultFragment {
  name: string
  content: string
}

export const DEFAULT_DANBOORU_FOLDER = 'Default'

/**
 * Small, general-purpose wildcard set curated from resources/tags.json.
 * Lines are ordered by Danbooru post count so common choices remain easy to inspect.
 */
export const DEFAULT_DANBOORU_FRAGMENTS: readonly DefaultFragment[] = [
  {
    name: 'Hair color',
    content: [
      'black hair',
      'blonde hair',
      'brown hair',
      'blue hair',
      'pink hair',
      'white hair',
      'grey hair',
      'purple hair',
      'red hair',
      'green hair',
      'orange hair',
      'aqua hair'
    ].join('\n')
  },
  {
    name: 'Eye color',
    content: [
      'blue eyes',
      'red eyes',
      'purple eyes',
      'green eyes',
      'brown eyes',
      'yellow eyes',
      'pink eyes',
      'black eyes',
      'grey eyes',
      'aqua eyes',
      'orange eyes'
    ].join('\n')
  },
  {
    name: 'Hairstyle',
    content: [
      'long hair',
      'short hair',
      'very long hair',
      'twintails',
      'ponytail',
      'braid',
      'hair bun',
      'twin braids',
      'side ponytail',
      'bob cut'
    ].join('\n')
  },
  {
    name: 'Expression',
    content: [
      'smile',
      'blush',
      'open mouth',
      'closed mouth',
      'closed eyes',
      'one eye closed',
      'tongue out',
      'grin',
      'tears',
      'surprised'
    ].join('\n')
  },
  {
    name: 'Composition',
    content: [
      'looking at viewer',
      'full body',
      'upper body',
      'cowboy shot',
      'looking back',
      'from side',
      'from behind',
      'portrait',
      'close-up'
    ].join('\n')
  },
  {
    name: 'Pose',
    content: [
      'standing',
      'sitting',
      'lying',
      'hands up',
      'arms up',
      'hand on own hip',
      'kneeling',
      'squatting'
    ].join('\n')
  },
  {
    name: 'Setting',
    content: [
      'simple background',
      'white background',
      'outdoors',
      'sky',
      'indoors',
      'beach',
      'forest',
      'city',
      'classroom',
      'bedroom'
    ].join('\n')
  },
  {
    name: 'Outfit',
    content: [
      'shirt',
      'skirt',
      'dress',
      'school uniform',
      'swimsuit',
      'kimono',
      'armor',
      'maid',
      'hoodie',
      'suit'
    ].join('\n')
  }
]

export interface DefaultDanbooruSeedPlan {
  folderName: string
  fragments: readonly DefaultFragment[]
}

function uniqueFolderName(existingNames: ReadonlySet<string>, base: string): string {
  if (!existingNames.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`
    if (!existingNames.has(candidate)) return candidate
  }
}

export function planDefaultDanbooruSeed(
  existingFragmentNames: Iterable<string>,
  existingFolderNames: Iterable<string>
): DefaultDanbooruSeedPlan | null {
  const fragmentNames = new Set(existingFragmentNames)
  const missing = DEFAULT_DANBOORU_FRAGMENTS.filter((fragment) => !fragmentNames.has(fragment.name))
  if (missing.length === 0) return null

  return {
    folderName: uniqueFolderName(new Set(existingFolderNames), DEFAULT_DANBOORU_FOLDER),
    fragments: missing
  }
}

/** Add missing defaults without changing any user-created fragment or folder. */
export function seedDefaultDanbooruFragments(db: Database.Database): void {
  const fragmentNames = db.prepare('SELECT name FROM fragments').all() as { name: string }[]
  const folderNames = db.prepare('SELECT name FROM fragment_folders').all() as { name: string }[]
  const plan = planDefaultDanbooruSeed(
    fragmentNames.map((row) => row.name),
    folderNames.map((row) => row.name)
  )
  if (!plan) return

  const folderOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM fragment_folders')
    .get() as { value: number }
  const folderId = Number(
    db
      .prepare('INSERT INTO fragment_folders (name, sort_order) VALUES (?, ?)')
      .run(plan.folderName, folderOrder.value + 1).lastInsertRowid
  )

  const fragmentOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM fragments')
    .get() as { value: number }
  const insert = db.prepare(
    'INSERT INTO fragments (name, content, folder_id, sort_order) VALUES (?, ?, ?, ?)'
  )
  plan.fragments.forEach((fragment, index) => {
    insert.run(fragment.name, fragment.content, folderId, fragmentOrder.value + index + 1)
  })
}

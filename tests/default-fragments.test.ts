import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { processWildcards } from '../src/main/fragments/processor'
import { browserFragmentSource } from '../src/renderer/src/browser/browser-workspace'
import { emptyState } from '../src/renderer/src/browser/browser-db'
import {
  DEFAULT_DANBOORU_FOLDER,
  DEFAULT_DANBOORU_FRAGMENTS,
  planDefaultDanbooruSeed
} from '../src/main/fragments/defaults'

interface TagEntry {
  value: string
  count: number
  type: string
}

const tags = JSON.parse(
  readFileSync(resolve(process.cwd(), 'resources', 'tags.json'), 'utf-8')
) as TagEntry[]
const tagsByName = new Map(tags.map((tag) => [tag.value, tag]))

describe('기본 Danbooru 조각', () => {
  it('대소문자와 공백이 달라도 기존 프롬프트 참조를 보존한다', () => {
    const state = emptyState()
    state.fragments = [{ id: 1, name: ' hair COLOR ', content: 'USER CONTENT', folderId: null }]
    const plan = planDefaultDanbooruSeed([' hair COLOR '], [' default ', 'DEFAULT (2)'])!
    expect(plan.folderName).toBe('Default (3)')
    expect(plan.fragments).toHaveLength(7)
    state.fragments.push(
      ...plan.fragments.map((fragment, index) => ({
        ...fragment,
        id: index + 2,
        folderId: null
      }))
    )
    expect(processWildcards('<hair color>', browserFragmentSource(state))).toBe('USER CONTENT')
    expect(
      planDefaultDanbooruSeed(
        state.fragments.map((fragment) => fragment.name),
        []
      )
    ).toBeNull()
  })

  it('작은 범용 세트만 제공한다', () => {
    const lines = DEFAULT_DANBOORU_FRAGMENTS.flatMap((fragment) => fragment.content.split('\n'))

    expect(DEFAULT_DANBOORU_FRAGMENTS).toHaveLength(8)
    expect(lines.length).toBeLessThanOrEqual(80)
    expect(new Set(DEFAULT_DANBOORU_FRAGMENTS.map((fragment) => fragment.name)).size).toBe(
      DEFAULT_DANBOORU_FRAGMENTS.length
    )
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('모든 줄이 autocomplete 데이터의 general 태그이며 인기순이다', () => {
    for (const fragment of DEFAULT_DANBOORU_FRAGMENTS) {
      const entries = fragment.content.split('\n').map((line) => tagsByName.get(line))
      expect(entries.every((entry) => entry?.type === 'general')).toBe(true)

      const counts = entries.map((entry) => entry?.count ?? -1)
      expect(counts).toEqual([...counts].sort((a, b) => b - a))
    }
  })

  it('설치할 기본 폴더와 조각을 계획한다', () => {
    expect(planDefaultDanbooruSeed([], [])).toEqual({
      folderName: DEFAULT_DANBOORU_FOLDER,
      fragments: DEFAULT_DANBOORU_FRAGMENTS
    })

    expect(
      planDefaultDanbooruSeed(
        DEFAULT_DANBOORU_FRAGMENTS.map((fragment) => fragment.name),
        [DEFAULT_DANBOORU_FOLDER]
      )
    ).toBeNull()
  })

  it('동일 이름의 사용자 조각과 폴더를 덮어쓰지 않는다', () => {
    const plan = planDefaultDanbooruSeed(
      ['Hair color'],
      [DEFAULT_DANBOORU_FOLDER, `${DEFAULT_DANBOORU_FOLDER} (2)`]
    )

    expect(plan?.folderName).toBe(`${DEFAULT_DANBOORU_FOLDER} (3)`)
    expect(plan?.fragments.map((fragment) => fragment.name)).not.toContain('Hair color')
    expect(plan?.fragments).toHaveLength(DEFAULT_DANBOORU_FRAGMENTS.length - 1)
  })
})

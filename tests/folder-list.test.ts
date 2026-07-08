import { describe, expect, it } from 'vitest'
import {
  buildDisplayRows,
  canonicalize,
  moveRow,
  rowKey,
  toOrderEntries
} from '../src/renderer/src/lib/folder-list'
import type { ListFolder } from '../src/shared/types'

const folders: ListFolder[] = [
  { id: 1, name: 'A', collapsed: false },
  { id: 2, name: 'B', collapsed: false }
]
const items = [
  { id: 10, folderId: null },
  { id: 11, folderId: 1 },
  { id: 12, folderId: 1 },
  { id: 13, folderId: 2 }
]

function keys(f: ListFolder[], i: { id: number; folderId: number | null }[]): string[] {
  return buildDisplayRows(f, i).map(rowKey)
}

describe('폴더 리스트 이동 로직 (폴더 섹션 상단 + 미분류 구분선)', () => {
  it('정규 순서: 폴더1(아이템) → 폴더2(아이템) → 구분선 → 미분류', () => {
    expect(keys(folders, items)).toEqual([
      'f-1', 'i-11', 'i-12', 'f-2', 'i-13', 'divider', 'i-10'
    ])
  })

  it('폴더가 없으면 구분선도 없다', () => {
    expect(keys([], [{ id: 10, folderId: null }])).toEqual(['i-10'])
  })

  it('아이템을 다른 폴더로 이동하면 소속이 바뀐다', () => {
    const r = moveRow(folders, items, 'i-11', 'i-13')
    expect(r.items.find((i) => i.id === 11)?.folderId).toBe(2)
    expect(keys(r.folders, canonicalize(r.folders, r.items))).toEqual([
      'f-1', 'i-12', 'f-2', 'i-13', 'i-11', 'divider', 'i-10'
    ])
  })

  it('아이템을 구분선 위치로 내리면 미분류가 된다', () => {
    const r = moveRow(folders, items, 'i-12', 'divider')
    expect(r.items.find((i) => i.id === 12)?.folderId).toBeNull()
  })

  it('아이템을 첫 폴더 위(맨 위)로 올리면 미분류가 된다', () => {
    const r = moveRow(folders, items, 'i-12', 'f-1')
    expect(r.items.find((i) => i.id === 12)?.folderId).toBeNull()
  })

  it('폴더 이동 시 소속 아이템이 블록째 따라간다', () => {
    const r = moveRow(folders, items, 'f-1', 'f-2')
    expect(keys(r.folders, r.items)).toEqual([
      'f-2', 'i-13', 'f-1', 'i-11', 'i-12', 'divider', 'i-10'
    ])
  })

  it('폴더를 미분류 아이템 위로 끌면 폴더 섹션 끝으로 스냅된다 (미분류 아래로 못 감)', () => {
    const r = moveRow(folders, items, 'f-1', 'i-10')
    expect(r.folders.map((f) => f.id)).toEqual([2, 1])
    expect(keys(r.folders, r.items)).toEqual([
      'f-2', 'i-13', 'f-1', 'i-11', 'i-12', 'divider', 'i-10'
    ])
  })

  it('toOrderEntries: 미분류가 반드시 먼저 — repo가 직전 폴더로 소속을 파생하기 때문 (v1.0.2 오염 버그 회귀 방지)', () => {
    const order = toOrderEntries(folders, items)
    expect(order).toEqual([
      { type: 'char', id: 10 }, // 미분류 먼저!
      { type: 'folder', id: 1 },
      { type: 'char', id: 11 },
      { type: 'char', id: 12 },
      { type: 'folder', id: 2 },
      { type: 'char', id: 13 }
    ])
    // repo의 소속 파생 로직 시뮬레이션 — 미분류 아이템이 폴더에 배정되면 안 됨
    let current: number | null = null
    const derived = new Map<number, number | null>()
    for (const e of order) {
      if (e.type === 'folder') current = e.id
      else derived.set(e.id, current)
    }
    expect(derived.get(10)).toBeNull()
    expect(derived.get(11)).toBe(1)
    expect(derived.get(13)).toBe(2)
  })
})

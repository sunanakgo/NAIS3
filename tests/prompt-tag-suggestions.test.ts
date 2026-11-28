// @vitest-environment happy-dom
import { act, createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildTagIndex, createTagSearcher, type RawTag } from '../src/shared/tag-search'
import {
  clearTagSuggestionCache,
  rememberTagSuggestions
} from '../src/renderer/src/lib/tag-suggestions'
import { PromptEditor } from '../src/renderer/src/components/prompt-editor'
import { togglePromptTag } from '../src/shared/prompt-tags'
vi.mock('../src/renderer/src/lib/i18n', () => ({ useT: () => (id: string) => id }))
const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => clearTagSuggestionCache())
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'execCommand')
})
function input(
  ta: HTMLTextAreaElement,
  value: string,
  inputType = 'insertText',
  cursor = value.length
): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, value)
  ta.setSelectionRange(cursor, cursor)
  ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }))
}
async function mount(
  value: string
): Promise<{ ta: HTMLTextAreaElement; search: ReturnType<typeof vi.fn> }> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const search = vi.fn(async () => ({
    items: [{ tag: 'normal_input_suggestion', count: 20, type: 0 }]
  }))
  window.nais = { invoke: search, on: () => () => {} } as unknown as typeof window.nais
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  function Editor(): React.JSX.Element {
    const [text, setText] = useState(value)
    return h(PromptEditor, { value: text, onValueChange: setText, ariaLabel: 'Prompt' })
  }
  await act(async () => root.render(h(Editor)))
  const ta = container.querySelector('textarea')!
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn((_command: string, _show: boolean, text: string) => {
      const next = ta.value.slice(0, ta.selectionStart) + text + ta.value.slice(ta.selectionEnd)
      input(ta, next)
      return true
    })
  })
  return { ta, search }
}
async function menu(ta: HTMLTextAreaElement): Promise<void> {
  document.querySelectorAll<HTMLElement>('[data-tag-start]').forEach((span) => {
    span.getClientRects = () =>
      [{ left: 10, right: 90, top: 10, bottom: 30 }] as unknown as DOMRectList
  })
  await act(async () => {
    ta.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 20, clientY: 20, bubbles: true, cancelable: true })
    )
  })
  await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}
it('does not request or display suggestions when reactivating, but still suggests for normal input', async () => {
  const { ta, search } = await mount(togglePromptTag('blue eyes', 0, 9))
  await menu(ta)
  expect(ta.value).toBe('blue eyes')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 130))
  })
  expect(search).not.toHaveBeenCalled()
  expect(document.querySelector('[data-prompt-suggestions]')).toBeNull()
  await act(async () => input(ta, 'ordinary typing'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
  })
  expect(search).toHaveBeenCalledWith(
    'tags:search',
    expect.objectContaining({ query: 'ordinary typing' })
  )
  expect(document.querySelector('[data-prompt-suggestions]')).not.toBeNull()
})
it.each(['historyUndo', 'historyRedo'])('does not suggest after %s', async (inputType) => {
  const { ta, search } = await mount('before')
  await act(async () => input(ta, 'restored prompt', inputType))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 130))
  })
  expect(search).not.toHaveBeenCalled()
  expect(document.querySelector('[data-prompt-suggestions]')).toBeNull()
})

it('rejects an in-flight recommendation result after a tag toggle', async () => {
  const { ta, search } = await mount('initial')
  let finish!: (value: { items: { tag: string; count: number; type: number }[] }) => void
  search.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await act(async () => input(ta, 'pending recommendation'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120))
  })
  expect(search).toHaveBeenCalledTimes(1)
  await menu(ta)
  await act(async () => finish({ items: [{ tag: 'stale_result', count: 1, type: 0 }] }))
  expect(document.querySelector('[data-prompt-suggestions]')).toBeNull()
})

const realSearcher = createTagSearcher(
  buildTagIndex(JSON.parse(readFileSync('resources/tags.json', 'utf8')) as RawTag[])
)
it.each([
  ['empty', 'blue', 4],
  ['comma', '1girl, blue', 11],
  ['numeric weight', '1.5::blue', 9],
  ['bracket', '{blue', 5],
  ['negative', '-2::blue', 8],
  ['middle', 'blue, smile', 4],
  ['multiline', '1girl,\nblue', 11]
])('shows real-data suggestions during direct typing at %s', async (_name, value, cursor) => {
  const { ta, search } = await mount('')
  search.mockImplementation(async (_channel: string, args: { query: string; limit: number }) => ({
    items: realSearcher.search(args.query, args.limit)
  }))
  await act(async () => input(ta, value as string, 'insertText', cursor as number))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
  })
  expect(search).toHaveBeenCalledWith('tags:search', expect.objectContaining({ query: 'blue' }))
  expect(document.querySelector('[data-prompt-suggestions]')?.textContent).toContain('blue eyes')
})
it('keeps stored state markers out of the input presentation and real suggestion queries', async () => {
  const { ta, search } = await mount(togglePromptTag('blue ey', 0, 7))
  search.mockImplementation(async (_channel: string, args: { query: string; limit: number }) => ({
    items: realSearcher.search(args.query, args.limit)
  }))
  expect(ta.value).toContain('\u2060')
  expect(ta.value).not.toContain('\u0336')
  await act(async () => input(ta, ta.value + 'e'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
  })
  expect(search).toHaveBeenCalledWith('tags:search', expect.objectContaining({ query: 'blue eye' }))
  expect(document.querySelector('[data-prompt-suggestions]')?.textContent).toContain('blue eyes')
})

it('does not let an old blur timer close cached suggestions after returning from a tag menu', async () => {
  const { ta } = await mount(togglePromptTag('blue eyes', 0, 9))
  rememberTagSuggestions('blue', 8, realSearcher.search('blue', 8))
  await act(async () => ta.focus())
  await menu(ta)
  await act(async () => input(ta, 'blue'))
  expect(document.querySelector('[data-prompt-suggestions]')).not.toBeNull()
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180))
  })
  expect(document.activeElement).toBe(ta)
  expect(document.querySelector('[data-prompt-suggestions]')).not.toBeNull()
})

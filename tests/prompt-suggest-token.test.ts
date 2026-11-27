import { describe, expect, it } from 'vitest'
import {
  suggestionTokenAtCursor,
  suggestionTokenEnd
} from '../src/renderer/src/lib/prompt-suggest-token'

const PROMPT = [
  '1girl, solo, long hair, smile, long hair',
  '1.3::blue eyes, red ribbon::, outdoors',
  '# comment, with, commas',
  '<fragment>, night sky'
].join('\n')

describe('suggestionTokenAtCursor', () => {
  const tokenStart = PROMPT.indexOf('night sky')

  it('accepts a cursor at or inside the suggested token', () => {
    expect(suggestionTokenAtCursor(PROMPT, tokenStart, PROMPT.length, 'tag')).toBe(true)
    expect(suggestionTokenAtCursor(PROMPT, tokenStart, tokenStart + 5, 'tag')).toBe(true)
    expect(suggestionTokenAtCursor(PROMPT, tokenStart, tokenStart, 'tag')).toBe(true)
  })

  it('rejects a cursor moved before the token, which would duplicate the text between', () => {
    const cursor = PROMPT.indexOf('hair\n') // "long |hair" on the first line
    expect(suggestionTokenAtCursor(PROMPT, tokenStart, cursor, 'tag')).toBe(false)
  })

  it('rejects a cursor moved past a separator into another tag or line', () => {
    const text = 'night sky, smile\nblue eyes'
    expect(suggestionTokenAtCursor(text, 0, text.indexOf('smile') + 2, 'tag')).toBe(false)
    expect(suggestionTokenAtCursor(text, 0, text.length, 'tag')).toBe(false)
  })

  it('rejects an unset token start or an out-of-range cursor', () => {
    expect(suggestionTokenAtCursor(PROMPT, -1, 3, 'tag')).toBe(false)
    expect(suggestionTokenAtCursor(PROMPT, tokenStart, PROMPT.length + 1, 'tag')).toBe(false)
  })

  it('lets fragment tokens span tag separators but not fragment brackets', () => {
    const text = 'a, <chars/main, b'
    const start = text.indexOf('<') + 1
    expect(suggestionTokenAtCursor(text, start, text.length, 'frag')).toBe(true)
    const closed = 'a, <chars>, b'
    expect(suggestionTokenAtCursor(closed, closed.indexOf('<') + 1, closed.length, 'frag')).toBe(
      false
    )
  })
})

describe('suggestionTokenEnd', () => {
  it('extends a tag to the next separator without its trailing spaces', () => {
    const text = 'smile, long hair , outdoors'
    expect(suggestionTokenEnd(text, text.indexOf('hair'), 'tag')).toBe(text.indexOf(' ,'))
  })

  it('stops at the end of the line or the text', () => {
    const text = 'long hair\nsmile'
    expect(suggestionTokenEnd(text, 2, 'tag')).toBe(text.indexOf('\n'))
    expect(suggestionTokenEnd(text, text.length - 2, 'tag')).toBe(text.length)
  })

  it('includes the closing bracket of a fragment', () => {
    const text = 'a, <chars/main>, b'
    expect(suggestionTokenEnd(text, text.indexOf('main'), 'frag')).toBe(text.indexOf('>') + 1)
  })
})

import { describe, expect, it } from 'vitest'
import { dayPartOf, greetingFor } from '../src/renderer/src/lib/greeting'

describe('greeting', () => {
  it('maps local hours to day parts at the boundaries', () => {
    expect([0, 4, 5, 11, 12, 16, 17, 20, 21, 23].map(dayPartOf)).toEqual([
      'dawn',
      'dawn',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
      'night',
      'night'
    ])
  })

  it('picks a variant for the current day part', () => {
    expect(greetingFor(9, 0)).toBe('ui.greetingMorning1')
    expect(greetingFor(9, 0.99)).toBe('ui.greetingMorning6')
    expect(greetingFor(2, 1)).toBe('ui.greetingDawn6')
  })
})

it('uses greeting IDs that exist in the catalog', async () => {
  const { KO } = await import('../src/shared/i18n/catalog-ko')
  for (let hour = 0; hour < 24; hour++)
    for (let n = 0; n < 6; n++) expect(KO).toHaveProperty([greetingFor(hour, n / 6)])
})

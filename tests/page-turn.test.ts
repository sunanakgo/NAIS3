// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import type { TargetResolver } from 'motion/react'
import { behind, FRONT, recedeVariants } from '../src/renderer/src/lib/page-turn'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

function resolve(shift: number, transform: string, inline = transform): ReturnType<TargetResolver> {
  const element = document.createElement('div')
  element.style.transform = inline
  document.body.append(element)
  vi.stubGlobal('getComputedStyle', () => ({ transform }))
  return (recedeVariants(shift).behind as TargetResolver)({ current: element }, {}, {})
}

it.each([-12, 12])('starts a settled recede at scale 1 in direction %s', (shift) => {
  expect(resolve(shift, 'none')).toMatchObject({
    transform: ['translateX(0%) scale(1)', `translateX(${shift}%) scale(0.94)`],
    opacity: 0.4,
    transitionEnd: { willChange: 'auto' }
  })
  expect(FRONT.transitionEnd).toEqual({ transform: 'none', willChange: 'auto' })
})

it('does not restart an in-flight transition whose inline style is still none', () => {
  expect(resolve(-12, 'matrix(0.97, 0, 0, 0.97, -15, 0)', 'none')).toEqual(behind(-12))
})

it('leaves an unmounted initial target unchanged', () => {
  expect((recedeVariants(12).behind as TargetResolver)({ current: null }, {}, {})).toEqual(
    behind(12)
  )
})

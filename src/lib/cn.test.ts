import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('joins truthy parts', () => {
    expect(cn('a', false, null, undefined, 0, 'b')).toBe('a b')
  })

  it('lets later classes override conflicting ones', () => {
    expect(cn('w-full h-10', 'w-24')).toBe('h-10 w-24')
    expect(cn('inline-flex', 'hidden')).toBe('hidden')
    expect(cn('px-4 text-sm', 'px-2')).toBe('text-sm px-2')
  })

  it('keeps design-token colours separate from font sizes', () => {
    expect(cn('text-[13px] text-fg-2', 'text-accent')).toBe('text-[13px] text-accent')
    expect(cn('text-sm text-fg', 'text-lg')).toBe('text-fg text-lg')
    expect(cn('bg-surface', 'bg-fill')).toBe('bg-fill')
  })

  it('knows custom shadows are shadow sizes, not colours', () => {
    expect(cn('shadow-card', 'shadow-float')).toBe('shadow-float')
    expect(cn('shadow-sm shadow-accent/20', 'shadow-card')).toBe('shadow-accent/20 shadow-card')
  })

  it('keeps line-height when a font size comes later', () => {
    expect(cn('leading-relaxed', 'text-[13px]')).toBe('leading-relaxed text-[13px]')
    expect(cn('leading-6 text-sm', 'leading-8')).toBe('text-sm leading-8')
  })

  it('keeps unknown custom utilities', () => {
    expect(cn('glass headline no-scrollbar', 'thin-scrollbar')).toBe(
      'glass headline no-scrollbar thin-scrollbar',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { seededRandom, seededSequence } from './seeded-random'

describe('seededRandom', () => {
  it('同一种子得到同一序列', () => {
    expect(seededSequence(42, 8)).toEqual(seededSequence(42, 8))
  })

  it('不同种子得到不同序列', () => {
    expect(seededSequence(1, 8)).not.toEqual(seededSequence(2, 8))
  })

  it('数值落在 [0, 1) 且不全相同', () => {
    const xs = seededSequence(7, 500)
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
    expect(new Set(xs).size).toBeGreaterThan(400)
  })

  it('种子 0、负数与小数也能用', () => {
    expect(() => seededRandom(0)()).not.toThrow()
    expect(seededSequence(-3, 3)).toEqual(seededSequence(3, 3))
    expect(seededSequence(3.9, 3)).toEqual(seededSequence(3, 3))
  })
})

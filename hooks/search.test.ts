import { expect, test } from 'claude-code/testing'

import { score, search } from './search'

test('matches characters in order, case-insensitive; misses return null', () => {
  expect(score('crlim', 'Credit Limit (LCY)')).not.toBe(null)
  expect(score('CRLIM', 'credit limit')).not.toBe(null)
  expect(score('limcr', 'Credit Limit')).toBe(null)
  expect(score('', 'anything')).toBe(null)
})

test('a contiguous word beats letters scattered across the line', () => {
  const exact = score('match', 'Matching rules') ?? 0
  const scattered = score('match', 'make a tiny cheap thing') ?? 0
  expect(exact).toBeGreaterThan(scattered)
})

test('word starts beat mid-word hits', () => {
  expect(score('cl', 'Credit Limit') ?? 0).toBeGreaterThan(score('cl', 'uncle') ?? 0)
})

test('search ranks, limits and keeps document order on ties', () => {
  const entries = [
    { block: 0, text: 'Overview' },
    { block: 1, text: 'Matching' },
    { block: 2, text: 'Tolerance settings' },
    { block: 3, text: 'Matching modes' },
  ]
  expect(search('match', entries).map(h => h.block)).toEqual([1, 3])
  expect(search('t', entries, 1)).toHaveLength(1)
  expect(search('zzz', entries)).toEqual([])
})

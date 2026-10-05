import { expect, test } from 'claude-code/testing'

import { argv, lines, parse, spansOf, style } from './highlighters'

test('parses entries: several languages, quoted paths with spaces, bad entries skipped', () => {
  const map = parse(['AL, alx: node "C:/My Tools/highlight.mjs" --x', 'nothing here', 'py:', ': node x'])
  expect(map.get('al')).toEqual(['node', 'C:/My Tools/highlight.mjs', '--x'])
  expect(map.get('alx')).toEqual(map.get('al'))
  expect([...map.keys()]).toEqual(['al', 'alx'])
  expect(argv('  a  "b c"  d ')).toEqual(['a', 'b c', 'd'])
})

test('captures fall back to their parent name; spans split into lines', () => {
  expect(style('keyword.control.conditional')).toEqual({ color: '#ff7b72' })
  expect(style('variable')).toEqual({})
  const out = lines([['begin', 'keyword'], ['\n  x', null], ['\n', null]])
  expect(out).toEqual([[{ text: 'begin', color: '#ff7b72' }], [{ text: '  x' }]])
})

test('accepts only spans that join back into the source', () => {
  expect(spansOf('[["a","keyword"],[" b",null]]', 'a b')).toEqual([['a', 'keyword'], [' b', null]])
  expect(spansOf('[["a","keyword"]]', 'a b')).toBe(null)
  expect(spansOf('null', 'a')).toBe(null)
  expect(spansOf('not json', 'a')).toBe(null)
})

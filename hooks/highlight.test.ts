import { expect, test } from 'claude-code/testing'

import { lines, style } from './highlight'

test('captures fall back to their parent name, unknown ones stay plain', () => {
  expect(style('keyword.control.conditional')).toEqual({ color: '#ff7b72' })
  expect(style('variable.builtin')).toEqual({ color: '#ffa657' })
  expect(style('variable')).toEqual({})
  expect(style(null)).toEqual({})
})

test('spans split into lines, newlines inside a span included', () => {
  const out = lines([['a', 'keyword'], [' b\n  c', null], ['/*x\ny*/', 'comment'], ['\n', null]])
  expect(out.map(l => l.map(s => s.text).join(''))).toEqual(['a b', '  c/*x', 'y*/'])
  expect(out[2]?.[0]).toEqual({ text: 'y*/', color: '#8b949e', italic: true })
})

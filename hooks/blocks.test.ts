import { expect, test } from 'claude-code/testing'

import { blocks, fit } from './blocks'

const DOC = [
  '# Title',
  '',
  '| Name | **Qty** | Note |',
  '|:-----|-----:|:----:|',
  '| `a` | 1 | [link](x.md) |',
  '| b \\| c | 22 |',
  '',
  '```mermaid',
  'graph LR',
  'A --> B',
  '```',
  '',
  '```',
  '| not | a table |',
  '|-----|---------|',
  '```',
].join('\n')

test('splits prose, tables and mermaid; leaves fenced pipes alone', () => {
  const b = blocks(DOC)
  expect(b.map(x => x.kind)).toEqual(['heading', 'table', 'mermaid', 'code'])
  const t = b[1]
  if (t?.kind !== 'table') throw new Error('no table')
  expect(t.table.head).toEqual(['Name', 'Qty', 'Note'])
  expect(t.table.align).toEqual(['left', 'right', 'center'])
  expect(t.table.rows).toEqual([['a', '1', 'link'], ['b | c', '22', '']])
  const m = b[2]
  expect(m?.kind === 'mermaid' && m.code).toBe('graph LR\nA --> B')
})

test('pulls out h1-h3 and GitHub callouts, handles CRLF, leaves h4 and fenced # alone', () => {
  const src = '# Top\r\n## Sub ##\r\n#### Deep\r\n> [!WARNING]\r\n> Be **careful**\r\n> twice\r\nafter\r\n```\r\n# not a heading\r\n```'
  const b = blocks(src)
  expect(b.slice(0, 2)).toEqual([
    { kind: 'heading', level: 1, text: 'Top' },
    { kind: 'heading', level: 2, text: 'Sub' },
  ])
  expect(b[2]).toEqual({ kind: 'md', text: '#### Deep' })
  expect(b[3]).toEqual({ kind: 'callout', type: 'warning', text: 'Be **careful**\ntwice' })
  expect(b.at(-1)).toEqual({ kind: 'code', lang: '', code: '# not a heading' })
})

test('fits columns: natural when room, shrinks wide ones, cards when hopeless', () => {
  const t = { head: ['id', 'description'], align: ['left', 'left'] as const, rows: [['1', 'x'.repeat(80)]] }
  const table = { ...t, align: [...t.align] }
  expect(fit(table, 200)).toEqual([2, 80])
  expect(fit(table, 40)).toEqual([4, 30])
  const wide = { head: Array(12).fill('col'), align: Array(12).fill('left'), rows: [] }
  expect(fit(wide, 40)).toBe(null)
})

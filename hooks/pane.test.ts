import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const DOC = [
  '# Guide',
  'Intro with **bold**.',
  '## Install',
  '> [!TIP]',
  '> Use the CLI.',
  '## Tables',
  '| A | B |',
  '|---|--:|',
  '| one | 1 |',
  '| two | 2 |',
  '## Diagram',
  '```mermaid',
  'graph LR',
  'A --> B',
  '```',
  '## Code',
  '```ts',
  'const x = 1 // hi',
  '```',
  '```cobol',
  'DISPLAY "HI".',
  '```',
].join('\n')

const ran = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as never,
})

test('the pane draws a valid docs page: header, callout, table, diagram, code', async ($, on) => {
  const clock = mock.clock(on)
  let text = DOC
  let at = 1
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('fs.read', () => ({ value: text }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: at, isLink: false } as never }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('process.run', () => ran('A ──► B'))
  await $.command.run({
    command: 'preview',
    args: 'C:/repo/docs/guide.md',
    origin: { kind: 'composer' } as never,
    presentation: { isFullscreen: true, columns: 160 } as never,
  })

  const ui = await $.ui.mount({
    plugin: 'file-preview',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'file-preview',
    props: { title: 'guide.md', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 } as never, view: {} },
  })
  for (const t of ['Guide', '✓ Tip', 'one', '◆ graph', 'A ──► B', 'guide.md', 'ts', 'cobol']) {
    expect([t, (await ui.find({ type: 'Text', text: t })) !== undefined]).toEqual([t, true])
  }
  expect((await ui.find({ type: 'Code', text: /const x = 1/ }))?.props.language).toBe('ts')
  expect(await ui.find({ type: 'Text', text: 'ON THIS PAGE' })).toBeUndefined()

  // Edited on disk: the watcher reloads it within one period.
  text = '# Changed'
  at = 2
  await clock.advance(1600)
  expect(await ui.find({ type: 'Text', text: 'Changed' })).toBeDefined()

  // The refresh button reloads by hand.
  text = '# Refreshed'
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: 'Refreshed' })).toBeDefined()
  await ui.unmount()
})

const mountPane = ($: Engine, rows = 80) =>
  $.ui.mount({
    plugin: 'file-preview',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'file-preview',
    props: { title: 'x', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: rows } as never, view: {} },
  })

const open = ($: Engine, args: string) =>
  $.command.run({ command: 'preview', args, origin: { kind: 'composer' } as never, presentation: { isFullscreen: true, columns: 160 } as never })

test('a JSON file is drawn numbered by the built-in highlighter, with its shape in the header', async ($, on) => {
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('fs.read', () => ({ value: '{\n  "name": "x",\n  "n": 2\n}\n' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as never }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  await open($, 'C:/repo/package.json')
  const ui = await mountPane($)
  const code = await ui.find({ type: 'Code' })
  expect(code?.props).toEqual({ source: '{\n  "name": "x",\n  "n": 2\n}', language: 'json', startLine: 1 })
  expect(await ui.find({ type: 'Text', text: /object, 2 keys/ })).toBeDefined()
  await ui.unmount()
})

test('invalid JSON says why; a huge file is cut inside the tree bounds', async ($, on) => {
  const big = `[\n${Array.from({ length: 5000 }, (_, i) => `  {"id": ${i}, "label": "item number ${i}"},`).join('\n')}\n`
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('fs.read', () => ({ value: big }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as never }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  await open($, 'C:/repo/data.json')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: /✖ invalid JSON/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Showing the first \d+ of 5001 lines/ })).toBeDefined()
  await ui.unmount()
})

test('YAML counts documents and top-level keys', async ($, on) => {
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('fs.read', () => ({ value: 'name: ci\non:\n  push: {}\n---\njobs: {}\n' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as never }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  await open($, '.github/ci.yml')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: /2 documents  ·  3 top-level keys/ })).toBeDefined()
  await ui.unmount()
})

const AL_DOC = '# AL\n```al\ncodeunit 1 "X" { }\n```\n'

test('a configured highlighter colours its language; others keep the built-in one', { options: { highlighters: ['al: node "C:/tools/al highlight.mjs"'] } }, async ($, on) => {
  const seen: string[][] = []
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('fs.read', () => ({ value: AL_DOC }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as never }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('process.run', (_$, e) => {
    seen.push([...e.argv])
    return ran(JSON.stringify([['codeunit', 'keyword.type'], [' 1 ', null], ['"X"', 'type.definition'], [' { }', null]]))
  })
  await open($, 'C:/repo/al.md')
  const ui = await mountPane($)
  expect(seen).toEqual([['node', 'C:/tools/al highlight.mjs']])
  expect((await ui.find({ type: 'Text', text: /^codeunit$/ }))?.props.color).toBe('#ff7b72')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.unmount()
})

test('a highlighter that fails, or answers spans that do not match, falls back to Code', { options: { highlighters: ['al: node broken.mjs'] } }, async ($, on) => {
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('fs.read', () => ({ value: AL_DOC }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as never }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('process.run', () => ran('[["something else", null]]'))
  await open($, 'C:/repo/al.md')
  const ui = await mountPane($)
  expect((await ui.find({ type: 'Code' }))?.props).toEqual({ source: 'codeunit 1 "X" { }', language: 'al' })
  await ui.unmount()
})

import { expect, mock, test } from 'claude-code/testing'

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

test('the pane draws a valid docs page: header, callout, table, diagram, highlighted code', async ($, on) => {
  const clock = mock.clock(on)
  let text = DOC
  let at = 1
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('fs.read', () => ({ value: text }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: at, isLink: false } as never }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('process.run', (_$, e) =>
    e.argv[0] === 'mermaid-ascii'
      ? ran('A ──► B')
      : e.argv.at(-1) === 'typescript'
        ? ran(JSON.stringify([['const', 'keyword'], [' x = ', null], ['1', 'number'], [' ', null], ['// hi', 'comment'], ['\n', null]]))
        : ran('null'),
  )
  await $.command.run({
    command: 'md-preview',
    args: 'C:/repo/docs/guide.md',
    origin: { kind: 'composer' } as never,
    presentation: { isFullscreen: true, columns: 160 } as never,
  })

  const ui = await $.ui.mount({
    plugin: 'md-preview',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'md-preview',
    props: { title: 'guide.md', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 } as never, view: {} },
  })
  for (const t of ['Guide', '✓ Tip', 'one', '◆ graph', 'A ──► B', 'guide.md', 'ts · tree-sitter', 'const', '// hi', 'cobol']) {
    expect([t, (await ui.find({ type: 'Text', text: t })) !== undefined]).toEqual([t, true])
  }
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

import { expect, test } from 'claude-code/testing'

import { linkify, toPath } from './linkify'

const CWD = String.raw`C:\repo`

test('links code spans, markdown links and bare paths', () => {
  const r = linkify('See `docs/a.md:12`, [guide](README.md) and ' + String.raw`C:\x\b.md here.`, CWD)
  expect(r.links).toEqual(['file:///C:/repo/docs/a.md', 'file:///C:/repo/README.md', 'file:///C:/x/b.md'])
  expect(r.text).toContain('[`docs/a.md:12`](file:///C:/repo/docs/a.md)')
})

test('links JSON and YAML too, longest extension first, sentence-final dots allowed', () => {
  const r = linkify('Edit `app.jsonc`, package.json and .github/ci.yml or config.yaml.', CWD)
  expect(r.links).toEqual([
    'file:///C:/repo/app.jsonc',
    'file:///C:/repo/package.json',
    'file:///C:/repo/.github/ci.yml',
    'file:///C:/repo/config.yaml',
  ])
})

test('links any file with an extension, relative or absolute, dotted names whole', () => {
  const r = linkify('Edit `hooks/register.tsx:157`, vite.config.ts and ' + String.raw`C:\x\a.cs.`, CWD)
  expect(r.links).toEqual(['file:///C:/repo/hooks/register.tsx', 'file:///C:/repo/vite.config.ts', 'file:///C:/x/a.cs'])
  expect(r.text).toContain('[`hooks/register.tsx:157`](file:///C:/repo/hooks/register.tsx)')
})

test('leaves fences, urls and numbers alone', () => {
  const src = 'v1.2 and https://e.com/a.md\n```\nfoo.md\n```\n'
  expect(linkify(src, CWD).links).toEqual([])
})

test('keeps only the files it is told exist', () => {
  const r = linkify('`a.md` and `b.md`', CWD, new Set(['file:///C:/repo/b.md']))
  expect(r.links).toEqual(['file:///C:/repo/b.md'])
  expect(r.text).toBe('`a.md` and [`b.md`](file:///C:/repo/b.md)')
})

test('round-trips paths with spaces', () => {
  const [url] = linkify('`my notes.md`', String.raw`C:\a b`).links
  expect(toPath(url ?? '')).toBe('C:/a b/my notes.md')
})

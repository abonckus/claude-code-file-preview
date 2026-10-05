import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parse, render } from './changelog.mjs'

test('parses type, scope, breaking marks; anything else is "other"', () => {
  assert.deepEqual(parse('feat(search): fuzzy matching'), { type: 'feat', scope: 'search', desc: 'fuzzy matching', breaking: false })
  assert.equal(parse('fix!: drop the old setting').breaking, true)
  assert.equal(parse('refactor: x', 'BREAKING CHANGE: the noun is gone').breaking, true)
  assert.deepEqual(parse('Add a thing'), { type: 'other', scope: null, desc: 'Add a thing', breaking: false })
})

test('groups by type in a fixed order, breaking first, unknown last, with links', () => {
  const notes = render(
    [
      { sha: 'a'.repeat(40), subject: 'fix: footer follows jumps', body: '' },
      { sha: 'b'.repeat(40), subject: 'feat(search)!: Esc closes search', body: '' },
      { sha: 'c'.repeat(40), subject: 'Rename the plugin', body: '' },
      { sha: 'd'.repeat(40), subject: 'ci: add release workflow', body: '' },
    ],
    'https://github.com/o/r',
  )
  const titles = [...notes.matchAll(/^## (.+)$/gm)].map(m => m[1])
  assert.deepEqual(titles, ['Breaking changes', 'Features', 'Bug fixes', 'Build and CI', 'Other changes'])
  assert.match(notes, /- \*\*search:\*\* Esc closes search \(\[bbbbbbb\]\(https:\/\/github\.com\/o\/r\/commit\/b{40}\)\)/)
  assert.match(notes, /## Other changes\n\n- Rename the plugin/)
})

test('no commits renders a single line', () => {
  assert.equal(render([], ''), 'No changes.\n')
})

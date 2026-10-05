// Release notes from the commits between two refs, grouped by Conventional Commit type.
// usage: node scripts/changelog.mjs [<from>] <to>   (no <from>: every commit up to <to>)
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Section titles in the order they print; a type not listed goes under "Other changes".
export const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Bug fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
  ['test', 'Tests'],
  ['build', 'Build and CI'],
  ['ci', 'Build and CI'],
  ['chore', 'Maintenance'],
]

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<desc>.+)$/i

// One commit, as `git log` gives it, to { type, scope, desc, breaking }.
export const parse = (subject, body = '') => {
  const m = HEADER.exec(subject.trim())
  const breaking = Boolean(m?.groups.bang) || /^BREAKING[ -]CHANGE:/m.test(body)
  if (!m) return { type: 'other', scope: null, desc: subject.trim(), breaking }
  return { type: m.groups.type.toLowerCase(), scope: m.groups.scope ?? null, desc: m.groups.desc.trim(), breaking }
}

// Commits ({ sha, subject, body }) to the markdown of the release notes.
export const render = (commits, repoUrl) => {
  const line = c => {
    const { scope, desc } = parse(c.subject, c.body)
    const link = repoUrl ? `[${c.sha.slice(0, 7)}](${repoUrl}/commit/${c.sha})` : c.sha.slice(0, 7)
    return `- ${scope ? `**${scope}:** ` : ''}${desc} (${link})`
  }
  const known = new Set(SECTIONS.map(([type]) => type))
  const groups = new Map()
  const add = (title, c) => groups.set(title, [...(groups.get(title) ?? []), line(c)])
  for (const c of commits) if (parse(c.subject, c.body).breaking) add('Breaking changes', c)
  for (const [type, title] of SECTIONS) for (const c of commits) if (parse(c.subject, c.body).type === type) add(title, c)
  for (const c of commits) if (!known.has(parse(c.subject, c.body).type)) add('Other changes', c)
  if (groups.size === 0) return 'No changes.\n'
  return [...groups].map(([title, lines]) => `## ${title}\n\n${lines.join('\n')}\n`).join('\n')
}

const log = (from, to) => {
  const out = execFileSync('git', ['log', '--no-merges', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', from ? `${from}..${to}` : to], {
    encoding: 'utf8',
  })
  return out
    .split('\x1e')
    .map(r => r.trim())
    .filter(Boolean)
    .map(r => {
      const [sha = '', subject = '', body = ''] = r.split('\x1f')
      return { sha, subject, body }
    })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [a, b] = process.argv.slice(2)
  const [from, to] = b === undefined ? ['', a ?? 'HEAD'] : [a, b]
  const repo = process.env.GITHUB_REPOSITORY
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
  process.stdout.write(render(log(from, to), repo ? `${server}/${repo}` : ''))
}

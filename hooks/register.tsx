import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Doc } from '../types'
import { linkify, toPath } from './linkify'
import { blocks, chunk, clean, fit, GAP } from './blocks'
import type { Align, Block, Callout, Table } from './blocks'

const PANE = 'file-preview'
const MAX = 10000 // Markdown element cap, per prose block
const FILE_MAX = 1_000_000 // read cap; what is drawn is cut further below
const MD_MAX = 60_000 // markdown drawn, kept well inside the engine's 100,000-character tree bound
const DATA_BUDGET = 70_000 // JSON/YAML source characters drawn
const PAD = 2 // side gutter, like a docs page
const READ_MAX = 110 // reading width cap, columns
const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const satisfies Record<Align, string>
const CALLOUTS = {
  note: { color: 'blue', icon: 'ℹ', label: 'Note' },
  tip: { color: 'green', icon: '✓', label: 'Tip' },
  important: { color: 'magenta', icon: '★', label: 'Important' },
  warning: { color: 'yellow', icon: '▲', label: 'Warning' },
  caution: { color: 'red', icon: '✖', label: 'Caution' },
} as const satisfies Record<Callout, { color: string; icon: string; label: string }>
const isAbs =(p: string) => /^([A-Za-z]:)?[\\/]/.test(p)
const doc = atom({ plugin: 'file-preview', key: 'doc' } as const, { path: '', text: '', mtime: 0 } as Doc)
const WATCH_MS = 1500

// ponytail: module cache, lost on reload; fine, a redraw re-renders
// Successes only: a failure is retried on the next draw and says why.
const diagrams = new Map<string, string>()
const renderMermaid = async ($: EngineInterface, code: string, width: number): Promise<{ art: string } | { error: string }> => {
  const id = `${width}\n${code}`
  const hit = diagrams.get(id)
  if (hit) return { art: hit }
  try {
    const run = await $.process.run(['mermaid-ascii', '-f', '-', '--max-width', String(width)], {
      stdin: code,
      timeoutMs: 10_000,
    })
    const art = run.stdout.replace(/\s+$/, '')
    if (run.exitCode !== 0 || !art) {
      return { error: `exit ${run.exitCode}: ${run.stderr.trim().split('\n')[0] || 'no output'}` }
    }
    diagrams.set(id, art)
    return { art }
  } catch (err) {
    return { error: String(err) }
  }
}

// Header facts for a data file: its shape, or why it does not parse.
const describeJson = (text: string, lang: string): string[] => {
  if (lang === 'jsonc') return ['JSON with comments']
  try {
    const value: unknown = JSON.parse(text)
    if (Array.isArray(value)) return [`array of ${value.length}`]
    if (value && typeof value === 'object') return [`object, ${Object.keys(value).length} keys`]
    return [typeof value]
  } catch (err) {
    return [`✖ invalid JSON: ${err instanceof Error ? err.message : String(err)}`]
  }
}
const describeYaml = (text: string): string[] => {
  const docs = text.split(/^---\s*$/m).filter(d => d.trim()).length
  const keys = text.match(/^[^\s#\-][^:#]*:(\s|$)/gm)?.length ?? 0
  return [docs > 1 ? `${docs} documents` : '', `${keys} top-level keys`]
}

const mtime = ($: EngineInterface, path: string) => $.fs.stat(path).then(s => s.mtimeMs, () => 0)

const load = async ($: EngineInterface, path: string) => {
  let text: string
  try {
    text = await $.fs.read(path)
  } catch (err) {
    text = `_Could not read file:_ ${String(err)}`
  }
  if (text.length > FILE_MAX) text = `${text.slice(0, FILE_MAX)}\n\n_…truncated_`
  await update($, doc, () => ({ path, text, mtime: 0 }))
  const at = await mtime($, path)
  await update($, doc, d => ({ ...d, mtime: at }))
}

// ponytail: polls mtime, no fs watch in the API; one watcher, for the file on show
let watcher: { cancel: () => void } | undefined
const watch = ($: EngineInterface) => {
  watcher?.cancel()
  watcher = $.clock.every(WATCH_MS, () => {
    void (async () => {
      const d = await read($, doc)
      if (!d.path || !d.mtime) return
      const at = await mtime($, d.path)
      if (at && at !== d.mtime) {
        await load($, d.path)
        $.ui.toast(`${d.path.split(/[\\/]/).pop()} changed on disk; preview reloaded`)
      }
    })()
  })
}

const show = async ($: EngineInterface, path: string) => {
  await load($, path)
  await $.ui.open({ id: PANE, title: path.split(/[\\/]/).pop() })
  watch($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'preview', description: 'Preview a markdown, JSON or YAML file in a side pane: /preview <path>' })
    return next(e)
  })

  on('command.run', { command: 'preview' }, async ($, e) => {
    const arg = e.args.trim()
    if (!arg) return { text: 'Usage: /preview <file.md | .json | .yaml>' }
    const path = isAbs(arg) ? arg : `${await $.session.cwd()}/${arg}`
    await show($, path)
    return { text: `Previewing ${arg}` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      watcher?.cancel()
      watcher = undefined
    }
    return next(e)
  })

  // Rewrites replies that mention previewable files so a click on the link opens the pane.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const cwd = await $.session.cwd()
    const found = linkify(e.props.text, cwd).links
    if (found.length === 0) return next(e)
    const exists = await Promise.all(
      found.map(url => $.fs.stat(toPath(url)).then(s => s.kind === 'file', () => false)),
    )
    const { text, links } = linkify(e.props.text, cwd, new Set(found.filter((_, i) => exists[i])))
    if (links.length === 0 || text.length > MAX) return next(e)
    const { Markdown } = $.ui.resolve(e)
    return (
      <Markdown
        key="md"
        text={text}
        pressableLinks={links}
        onLinkPress={link => void show($, toPath(link.href))}
      />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown, Code, Button } = $.ui.resolve(e)
    const { path, text } = await read($, doc)
    const cols = e.props.bodyColumns
    const width = Math.min(Math.max(20, cols - 2 * PAD), READ_MAX)
    const frame = { borderStyle: 'round', borderDimColor: true, paddingX: 1, flexDirection: 'column' } as const

    const table = (t: Table) => {
      const widths = fit(t, width)
      if (!widths) {
        // Too many columns for the pane: one card per row, `header: value` lines.
        return t.rows.map(row => (
          <Box {...frame}>
            {t.head.map((h, j) => (
              <Box flexDirection="row">
                <Box flexShrink={0}>
                  <Text bold color="cyan">{`${h}: `}</Text>
                </Box>
                <Text wrap="wrap">{row[j] ?? ''}</Text>
              </Box>
            ))}
          </Box>
        ))
      }
      const line = (cells: string[], isHead: boolean) => (
        <Box flexDirection="row" columnGap={GAP}>
          {cells.map((c, j) => (
            <Box width={widths[j]} flexShrink={0} justifyContent={JUSTIFY[t.align[j] ?? 'left']}>
              <Text wrap="wrap" bold={isHead} color={isHead ? 'cyan' : undefined}>{c}</Text>
            </Box>
          ))}
        </Box>
      )
      const rule = '─'.repeat(widths.reduce((a, b) => a + b, 0) + GAP * (widths.length - 1))
      return (
        <Box {...frame}>
          {line(t.head, true)}
          <Text dimColor>{rule}</Text>
          {t.rows.flatMap((r, i) => (i === 0 ? [line(r, false)] : [<Text dimColor>{rule.replaceAll('─', '┈')}</Text>, line(r, false)]))}
        </Box>
      )
    }

    const mermaid = async (code: string) => {
      const drawn = await renderMermaid($, code, width - 4)
      if ('error' in drawn) {
        return (
          <Box flexDirection="column">
            <Markdown text={`\`\`\`mermaid\n${code}\n\`\`\``} />
            <Text dimColor wrap="wrap">{`mermaid-ascii could not draw this (${drawn.error}); showing the source.`}</Text>
          </Box>
        )
      }
      const art = drawn.art
      const type = code.trim().split(/\s/)[0] ?? 'diagram'
      return (
        <Box {...frame} borderColor="magenta">
          <Text color="magenta" bold>{`◆ ${type}`}</Text>
          {art.split('\n').map(l => (
            <Text wrap="truncate-end">{l || ' '}</Text>
          ))}
        </Box>
      )
    }

    // Claude Code's own highlighter: every language it knows, nothing to install.
    const code = (lang: string, source: string) => (
      <Box {...frame}>
        {lang ? <Text dimColor>{lang}</Text> : null}
        {chunk(clean(source), MAX, MAX * 3).map(p => (
          <Code source={p.source || ' '} language={lang || undefined} />
        ))}
      </Box>
    )

    // GitHub style: h1/h2 bold with a quiet rule beneath, h3 bold alone.
    const heading = (level: 1 | 2 | 3, title: string) =>
      level === 3 ? (
        <Text bold>{title}</Text>
      ) : (
        <Box flexDirection="column" marginTop={level === 2 ? 1 : 0}>
          <Text bold color={level === 1 ? 'whiteBright' : undefined}>{title}</Text>
          <Text dimColor>{'─'.repeat(Math.max(1, width))}</Text>
        </Box>
      )

    const callout = (type: Callout, body: string) => {
      const { color, icon, label } = CALLOUTS[type]
      return (
        <Box borderStyle="round" borderColor={color} paddingX={1} flexDirection="column">
          <Text bold color={color}>{`${icon} ${label}`}</Text>
          <Markdown text={body.slice(0, MAX) || ' '} />
        </Box>
      )
    }

    // A markdown file: the docs page.
    const page = async () => {
      const md = text.length > MD_MAX ? `${text.slice(0, MD_MAX)}\n\n_…truncated_` : text
      const all = blocks(md || '_Nothing to preview._')
      const parts = await Promise.all(
        all.map(b =>
          b.kind === 'md'
            ? <Markdown text={b.text.slice(0, MAX)} />
            : b.kind === 'heading'
              ? heading(b.level, b.text)
              : b.kind === 'callout'
                ? callout(b.type, b.text)
                : b.kind === 'table'
                  ? table(b.table)
                  : b.kind === 'code'
                    ? code(b.lang, b.code)
                    : mermaid(b.code),
        ),
      )
      const words = text.split(/\s+/).filter(Boolean).length
      const count = (kind: Block['kind']) => all.filter(b => b.kind === kind).length
      const stats = [
        `${text.split('\n').length} lines`,
        `${words} words`,
        `~${Math.max(1, Math.round(words / 220))} min read`,
        count('table') && `${count('table')} tables`,
        count('mermaid') && `${count('mermaid')} diagrams`,
      ]
      return { stats, body: parts.flat() }
    }

    // A JSON or YAML file: the whole source, highlighted and numbered, cut where the
    // drawing would pass the engine's tree bounds.
    const dataFile = async (kind: 'json' | 'yaml', lang: string) => {
      const src = clean(text).replace(/\n$/, '')
      const total = src.split('\n').length
      const parts = chunk(src, MAX, DATA_BUDGET)
      const last = parts.at(-1)
      const shown = last ? last.startLine - 1 + last.source.split('\n').length : 0
      const body = [
        <Box {...frame}>
          <Text dimColor>{lang}</Text>
          {parts.map(p => (
            <Code source={p.source || ' '} language={lang === 'jsonc' ? 'json' : lang} startLine={p.startLine} />
          ))}
        </Box>,
        shown < total ? (
          <Text dimColor>{`Showing the first ${shown} of ${total} lines; open the file in an editor for the rest.`}</Text>
        ) : null,
      ]
      return { stats: [`${total} lines`, `${(text.length / 1024).toFixed(1)} KB`, ...(kind === 'json' ? describeJson(text, lang) : describeYaml(text))], body }
    }

    const kind = /\.jsonc?$/i.test(path) ? 'json' : /\.ya?ml$/i.test(path) ? 'yaml' : 'md'
    const { stats: parts, body } =
      kind === 'md' ? await page() : await dataFile(kind, /\.jsonc$/i.test(path) ? 'jsonc' : kind)
    const stats = parts.filter(Boolean).join('  ·  ')
    const crumbs = path.split(/[\\/]/).filter(Boolean)
    const name = crumbs.pop() ?? path

    return (
      <Box flexDirection="column" paddingX={PAD}>
        <Box flexDirection="row" flexWrap="wrap">
          <Text dimColor wrap="truncate-start">{`${crumbs.slice(-3).join(' / ')} / `}</Text>
          <Text bold color="cyan">{name}</Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between" width={width}>
          <Text dimColor>{stats}</Text>
          <Button
            key="refresh"
            label="↻ Refresh"
            hotkey="r"
            onPress={async () => {
              await load($, path)
              $.ui.toast('Preview refreshed')
            }}
          />
        </Box>
        <Text dimColor>{'─'.repeat(Math.max(1, width))}</Text>
        <Box flexDirection="column" rowGap={1} marginTop={1} width={width}>
          {body}
        </Box>
      </Box>
    )
  })
}

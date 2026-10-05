import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Doc, Find, View } from '../types'
import { linkify, toPath } from './linkify'
import { blocks, chunk, clean, fit, GAP, plain } from './blocks'
import type { Align, Block, Callout, Table } from './blocks'
import { lines, parse, spansOf } from './highlighters'
import type { Span } from './highlighters'
import { search } from './search'

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
const find = atom({ plugin: 'file-preview', key: 'find' } as const, { open: false, query: '' } as Find)
// The pane's scroll offset, recorded by the ui.scroll hook so the footer can follow it.
const view = atom({ plugin: 'file-preview', key: 'view' } as const, { offset: undefined } as View)
const WATCH_MS = 1500

// A block's searchable lines, as plain text.
const blockLines = (b: Block): string[] =>
  (b.kind === 'table'
    ? [b.table.head, ...b.table.rows].map(r => r.join(' | '))
    : (b.kind === 'code' || b.kind === 'mermaid' ? b.code : b.text).split('\n').map(plain)
  )
    .map(l => l.trim())
    .filter(Boolean)

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

// The `highlighters` setting, read at load (a change reloads the module).
let highlighters = new Map<string, string[]>()
const CODE_BUDGET = 40_000 // serialized characters of one coloured block; past it, Code draws it

// Successes only, by command and source: a failing highlighter is tried again on the next draw.
const highlighted = new Map<string, Span[]>()
const external = async ($: EngineInterface, cmd: string[], source: string): Promise<Span[] | null> => {
  const id = `${cmd.join('\0')}\n${source}`
  const hit = highlighted.get(id)
  if (hit) return hit
  const run = await $.process.run(cmd, { stdin: source, timeoutMs: 15_000 }).catch(() => null)
  const spans = run?.exitCode === 0 ? spansOf(run.stdout, source) : null
  if (spans) highlighted.set(id, spans)
  return spans
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

export const register: Register = (on, options) => {
  highlighters = parse(Array.isArray(options.highlighters) ? options.highlighters : [])

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

  // Lets the engine scroll as usual, then records where to, so the pane redraws its
  // footer on the window's new last rows.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (!moved.deny) await update($, view, () => ({ offset: e.offset }))
    return moved
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
    const els = $.ui.resolve(e)
    const { Box, Text, Markdown, Code, Button } = els
    const Input = 'Input' in els ? els.Input : null // mobile draws no fields: no search there
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
            {t.head.map((name, j) => (
              <Box flexDirection="row">
                <Box flexShrink={0}>
                  <Text bold color="cyan">{`${name}: `}</Text>
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
    // A highlighter from the `highlighters` setting for this language, else Claude
    // Code's own: every language it knows, nothing to install.
    const code = async (lang: string, source: string) => {
      const src = clean(source)
      const cmd = highlighters.get(lang.toLowerCase())
      const spans = cmd && src.length <= MAX ? await external($, cmd, src) : null
      const rows = spans
        ? lines(spans).map(segs => (
            <Text wrap="wrap">
              {segs.length ? segs.map(s => (s.color || s.italic ? <Text color={s.color} italic={s.italic}>{s.text}</Text> : s.text)) : ' '}
            </Text>
          ))
        : null
      return (
        <Box {...frame}>
          {lang ? <Text dimColor>{lang}</Text> : null}
          {rows && JSON.stringify(rows).length <= CODE_BUDGET
            ? rows
            : chunk(src, MAX, MAX * 3).map(p => <Code source={p.source || ' '} language={lang || undefined} />)}
        </Box>
      )
    }

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
      const entries = all.flatMap((b, i) => blockLines(b).map(line => ({ block: i, text: line })))
      return { stats, body: parts.map((p, i) => <Box key={`b:${i}`} flexDirection="column">{p}</Box>), entries }
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
          {parts.map((p, i) => (
            <Box key={`b:${i}`} flexDirection="column">
              <Code source={p.source || ' '} language={lang === 'jsonc' ? 'json' : lang} startLine={p.startLine} />
            </Box>
          ))}
        </Box>,
        shown < total ? (
          <Text dimColor>{`Showing the first ${shown} of ${total} lines; open the file in an editor for the rest.`}</Text>
        ) : null,
      ]
      const entries = parts.flatMap((p, i) =>
        p.source.split('\n').map((line, j) => ({ block: i, text: `${p.startLine + j}: ${line.trim()}` })),
      )
      return { stats: [`${total} lines`, `${(text.length / 1024).toFixed(1)} KB`, ...(kind === 'json' ? describeJson(text, lang) : describeYaml(text))], body, entries }
    }

    const kind = /\.jsonc?$/i.test(path) ? 'json' : /\.ya?ml$/i.test(path) ? 'yaml' : 'md'
    const { stats: parts, body, entries } =
      kind === 'md' ? await page() : await dataFile(kind, /\.jsonc$/i.test(path) ? 'jsonc' : kind)
    const stats = parts.filter(Boolean).join('  ·  ')
    const crumbs = path.split(/[\\/]/).filter(Boolean)
    const name = crumbs.pop() ?? path

    // Search: the query lives in state, so typing redraws the hits.
    const { open: isSearching, query } = await read($, find)
    const hits = isSearching ? search(query, entries) : []
    // A refused scroll or focus (the pane not holding the keys) is not an error worth a throw.
    const jump = (block: number) => $.ui.scroll({ to: { key: `b:${block}` }, in: PANE, block: 'start' }).catch(() => {})
    // The sticky footer: absolutely placed on the window's last rows, following the
    // scroll (the ui.scroll hook records the offset). Every row is one terminal row,
    // so its height is known: a rule, the search rows while searching, the buttons.
    const searching = isSearching && Input !== null
    const footerRows = 2 + (searching ? 2 + hits.length : 0)
    const { offset: stored } = await read($, view)
    const offset = stored ?? e.props.scroll.offset
    const bodyRows = Math.max(footerRows + 1, e.props.scroll.bodyRows)
    const blank = ' '.repeat(Math.max(1, width))
    const clip = (t: string) => (t.length > width ? `${t.slice(0, width - 1)}…` : t)
    const footer = (
      <Box key="footer" position="absolute" top={offset + bodyRows - footerRows} left={PAD} width={width} flexDirection="column">
        {/* paints over the page beneath before the footer's own rows */}
        <Box position="absolute" top={0} left={0} flexDirection="column">
          {Array.from({ length: footerRows }, () => <Text>{blank}</Text>)}
        </Box>
        <Text dimColor>{'─'.repeat(Math.max(1, width))}</Text>
        {searching && Input ? (
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Box flexGrow={1}>
                <Input
                  key="search"
                  autoFocus
                  placeholder="Fuzzy search…"
                  value={query}
                  onInput={(value: string) => void update($, find, f => ({ ...f, query: value }))}
                  onSubmit={(value: string) => {
                    const [first] = search(value, entries, 1)
                    if (first) void jump(first.block)
                  }}
                />
              </Box>
            </Box>
            <Text dimColor wrap="truncate-end">{query ? `${hits.length === 8 ? '8+' : hits.length} matches; Enter jumps to the first` : 'Type to search; Enter jumps to the best match'}</Text>
            {hits.map((hit, k) => (
              <Button key={`hit:${k}`} plain label={clip(hit.text)} onPress={() => jump(hit.block)} />
            ))}
          </Box>
        ) : null}
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" columnGap={1}>
            <Button key="top" label="↑ Top" hotkey="u" onPress={() => $.ui.scroll({ to: 'start', in: PANE }).catch(() => {})} />
            {Input && !searching ? (
              <Button
                key="find"
                label="⌕ Search"
                hotkey="s"
                onPress={async () => {
                  await update($, find, f => ({ ...f, open: true }))
                  await $.ui.focus({ requestId: PANE, key: 'search' }).catch(() => {})
                }}
              />
            ) : null}
            {searching ? <Button key="close-search" label="✕ Close" hotkey="q" onPress={() => update($, find, () => ({ open: false, query: '' }))} /> : null}
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
          <Text dimColor wrap="truncate-start">{searching ? 'Esc leaves the field · q close' : 'u top · s search · r refresh'}</Text>
        </Box>
      </Box>
    )

    return (
      // minHeight keeps the tree at least a window tall, so the footer is never below its end
      <Box flexDirection="column" paddingX={PAD} paddingBottom={footerRows} minHeight={bodyRows}>
        <Box flexDirection="row" flexWrap="wrap">
          <Text dimColor wrap="truncate-start">{`${crumbs.slice(-3).join(' / ')} / `}</Text>
          <Text bold color="cyan">{name}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">{stats}</Text>
        <Text dimColor>{'─'.repeat(Math.max(1, width))}</Text>
        <Box flexDirection="column" rowGap={1} marginTop={1} width={width}>
          {body}
        </Box>
        {footer}
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Doc } from '../types'
import { linkify, toPath } from './linkify'
import { blocks, fit, GAP } from './blocks'
import { LANGS, lines } from './highlight'
import type { Span } from './highlight'
import type { Align, Block, Callout, Table } from './blocks'

const PANE = 'md-preview'
const MAX = 10000 // Markdown element cap, per prose block
const FILE_MAX = 200_000
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
const doc = atom({ plugin: 'md-preview', key: 'doc' } as const, { path: '', text: '', mtime: 0 } as Doc)
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

const codes = new Map<string, Span[] | null>()
const highlight = async ($: EngineInterface, lang: string, code: string): Promise<Span[] | null> => {
  const id = `${lang}\n${code}`
  if (!codes.has(id)) {
    const run = await $.process
      .run(['nvim', '--headless', '--clean', '-l', `${$.plugin.root}/hooks/highlight.lua`, LANGS[lang] ?? lang], {
        stdin: code,
        timeoutMs: 10_000,
      })
      .catch(() => null)
    let spans: Span[] | null = null
    try {
      spans = run?.exitCode === 0 ? (JSON.parse(run.stdout) as Span[] | null) : null
    } catch {}
    codes.set(id, spans)
  }
  return codes.get(id) ?? null
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
    await $.command.register({ name: 'md-preview', description: 'Preview a markdown file in a side pane: /md-preview <path>' })
    return next(e)
  })

  on('command.run', { command: 'md-preview' }, async ($, e) => {
    const arg = e.args.trim()
    if (!arg) return { text: 'Usage: /md-preview <path.md>' }
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

  // Rewrites replies that mention .md files so a click on the link opens the pane.
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

    const code = async (lang: string, source: string) => {
      const spans = lang ? await highlight($, lang, source) : null
      if (!spans) {
        // No tree-sitter parser for it: the engine's own highlighter.
        return (
          <Box {...frame}>
            {lang ? <Text dimColor>{lang}</Text> : null}
            <Code source={source.slice(0, MAX) || ' '} language={lang || undefined} />
          </Box>
        )
      }
      return (
        <Box {...frame}>
          <Text dimColor>{`${lang} · tree-sitter`}</Text>
          {lines(spans).map(segs => (
            <Text wrap="wrap">
              {segs.length ? segs.map(s => <Text color={s.color} italic={s.italic}>{s.text}</Text>) : ' '}
            </Text>
          ))}
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

    const all = blocks(text || '_Nothing to preview._')
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
    ].filter(Boolean).join('  ·  ')
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
          {parts.flat()}
        </Box>
      </Box>
    )
  })
}

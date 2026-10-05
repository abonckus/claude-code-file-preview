// Splits markdown into the blocks the pane draws itself (headings, callouts, tables,
// mermaid) and prose left to Markdown, and fits a table's columns to a width.
export type Align = 'left' | 'center' | 'right'
export type Table = { head: string[]; align: Align[]; rows: string[][] }
export type Callout = 'note' | 'tip' | 'important' | 'warning' | 'caution'
export type Block =
  | { kind: 'md'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'callout'; type: Callout; text: string }
  | { kind: 'table'; table: Table }
  | { kind: 'mermaid'; code: string }
  | { kind: 'code'; lang: string; code: string }

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/
const CALLOUT = /^>\s*\[!(note|tip|important|warning|caution)\]\s*$/i

const SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const FENCE = /^\s*(```|~~~)/

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map(c => plain(c.trim().replaceAll('\\|', '|')))

// Inline markdown to plain text: a grid cell is drawn as one Text.
export const plain = (s: string): string =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\w*])[*_](.+?)[*_](?![\w*])/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')

export const blocks = (text: string): Block[] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let prose: string[] = []
  const flush = () => {
    if (prose.join('').trim()) out.push({ kind: 'md', text: prose.join('\n') })
    prose = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = /^\s*(```|~~~)\s*([\w+#.-]*)/.exec(line)
    if (fence) {
      const code: string[] = []
      for (i++; i < lines.length && !FENCE.test(lines[i] ?? ''); i++) code.push(lines[i] ?? '')
      flush()
      const lang = (fence[2] ?? '').toLowerCase()
      out.push(lang === 'mermaid' ? { kind: 'mermaid', code: code.join('\n') } : { kind: 'code', lang, code: code.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      out.push({ kind: 'heading', level: (heading[1] ?? '#').length as 1 | 2 | 3, text: plain(heading[2] ?? '') })
      continue
    }
    const callout = CALLOUT.exec(line)
    if (callout) {
      const body: string[] = []
      for (i++; i < lines.length && (lines[i] ?? '').startsWith('>'); i++) body.push((lines[i] ?? '').replace(/^>\s?/, ''))
      i--
      flush()
      out.push({ kind: 'callout', type: (callout[1] ?? 'note').toLowerCase() as Callout, text: body.join('\n') })
      continue
    }
    const next = lines[i + 1] ?? ''
    if (!line.includes('|') || !SEP.test(next)) {
      prose.push(line)
      continue
    }
    const head = cells(line)
    const align = cells(next).map((c, j): Align => {
      const raw = next.trim().replace(/^\|/, '').split('|')[j]?.trim() ?? c
      return raw.startsWith(':') && raw.endsWith(':') ? 'center' : raw.endsWith(':') ? 'right' : 'left'
    })
    const rows: string[][] = []
    for (i += 2; i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim(); i++) {
      const row = cells(lines[i] ?? '')
      rows.push(head.map((_, j) => row[j] ?? ''))
    }
    i--
    flush()
    out.push({ kind: 'table', table: { head, align: head.map((_, j) => align[j] ?? 'left'), rows } })
  }
  flush()
  return out
}

export const GAP = 2
const FRAME = 4 // border + paddingX on each side
const MIN = 4

// Column widths that fit `columns`, or null when even MIN per column does not fit (draw cards).
export const fit = (t: Table, columns: number): number[] | null => {
  const natural = t.head.map((h, j) => Math.max(h.length, ...t.rows.map(r => (r[j] ?? '').length), 1))
  let room = columns - FRAME - GAP * (natural.length - 1)
  if (natural.reduce((a, b) => a + b, 0) <= room) return natural
  if (room < MIN * natural.length) return null
  // ponytail: water-fill, narrow columns keep their width and the rest share what is left
  const widths = [...natural]
  const order = natural.map((w, j) => [w, j] as const).sort((a, b) => a[0] - b[0])
  order.forEach(([w, j], k) => {
    const share = Math.floor(room / (order.length - k))
    widths[j] = Math.max(MIN, Math.min(w, share))
    room -= widths[j] ?? 0
  })
  return widths
}

// A Code element's source: no control characters but tab and newline.
export const clean = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

// Splits source into runs of whole lines, each at most `max` characters (a longer
// line is cut), numbered from where it starts, until `budget` characters are used.
export const chunk = (src: string, max: number, budget: number): { source: string; startLine: number }[] => {
  const rows = src.split('\n')
  const out: { source: string; startLine: number }[] = []
  let used = 0
  for (let start = 0; start < rows.length && used < budget; ) {
    let end = start
    let len = 0
    while (end < rows.length && len + Math.min((rows[end] ?? '').length, max - 1) + 1 <= max) {
      len += Math.min((rows[end] ?? '').length, max - 1) + 1
      end++
    }
    out.push({ source: rows.slice(start, end).map(r => r.slice(0, max - 1)).join('\n'), startLine: start + 1 })
    used += len
    start = end
  }
  return out
}

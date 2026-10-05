// External highlighters from the `highlighters` setting: one entry per command,
// `<lang>[, <lang>…]: <command> [args…]`. A command reads source on stdin and
// writes a JSON array of [text, capture | null] spans (tree-sitter capture names).
export type Span = [text: string, capture: string | null]
export type Styled = { text: string; color?: string; italic?: boolean }

// Splits a command line into argv: whitespace separates, double quotes group.
export const argv = (line: string): string[] => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2] ?? '')

// Language (lower case) to argv; an entry without a colon or a command is skipped.
export const parse = (entries: readonly string[]): Map<string, string[]> => {
  const out = new Map<string, string[]>()
  for (const entry of entries) {
    const at = entry.indexOf(':')
    const cmd = at > 0 ? argv(entry.slice(at + 1)) : []
    if (!cmd.length) continue
    for (const lang of entry.slice(0, at).split(',')) if (lang.trim()) out.set(lang.trim().toLowerCase(), cmd)
  }
  return out
}

// Capture names to colours (GitHub dark).
const THEME: Record<string, Omit<Styled, 'text'>> = {
  keyword: { color: '#ff7b72' },
  operator: { color: '#ff7b72' },
  function: { color: '#d2a8ff' },
  method: { color: '#d2a8ff' },
  type: { color: '#ffa657' },
  module: { color: '#ffa657' },
  string: { color: '#a5d6ff' },
  number: { color: '#79c0ff' },
  boolean: { color: '#79c0ff' },
  constant: { color: '#79c0ff' },
  property: { color: '#79c0ff' },
  attribute: { color: '#7ee787' },
  tag: { color: '#7ee787' },
  label: { color: '#7ee787' },
  'variable.builtin': { color: '#ffa657' },
  'variable.parameter': { color: '#ffa657' },
  comment: { color: '#8b949e', italic: true },
}

// `keyword.control.conditional` tries itself, then `keyword.control`, then `keyword`.
export const style = (capture: string | null): Omit<Styled, 'text'> => {
  for (let name = capture ?? ''; name; name = name.slice(0, Math.max(0, name.lastIndexOf('.')))) {
    const hit = THEME[name]
    if (hit) return hit
  }
  return {}
}

export const lines = (spans: readonly Span[]): Styled[][] => {
  const out: Styled[][] = [[]]
  for (const [text, capture] of spans) {
    text.split('\n').forEach((piece, i) => {
      if (i > 0) out.push([])
      if (piece) out[out.length - 1]?.push({ text: piece, ...style(capture) })
    })
  }
  if (out.length > 1 && out[out.length - 1]?.length === 0) out.pop()
  return out
}

// What a highlighter wrote, if it is spans that join back into the source.
export const spansOf = (stdout: string, source: string): Span[] | null => {
  try {
    const spans: unknown = JSON.parse(stdout)
    if (!Array.isArray(spans)) return null
    const ok = spans.every(s => Array.isArray(s) && typeof s[0] === 'string' && (s[1] === null || typeof s[1] === 'string'))
    return ok && (spans as Span[]).map(s => s[0]).join('') === source ? (spans as Span[]) : null
  } catch {
    return null
  }
}

// Tree-sitter capture names to colours (GitHub dark), and spans split into lines.
export type Span = [text: string, capture: string | null]
export type Styled = { text: string; color?: string; italic?: boolean }

const THEME: Record<string, Omit<Styled, 'text'>> = {
  keyword: { color: '#ff7b72' },
  operator: { color: '#ff7b72' },
  conditional: { color: '#ff7b72' },
  repeat: { color: '#ff7b72' },
  include: { color: '#ff7b72' },
  function: { color: '#d2a8ff' },
  method: { color: '#d2a8ff' },
  constructor: { color: '#ffa657' },
  type: { color: '#ffa657' },
  module: { color: '#ffa657' },
  string: { color: '#a5d6ff' },
  character: { color: '#a5d6ff' },
  number: { color: '#79c0ff' },
  float: { color: '#79c0ff' },
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

// Fence names to tree-sitter language names, where they differ.
export const LANGS: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  jsonc: 'json',
  md: 'markdown',
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

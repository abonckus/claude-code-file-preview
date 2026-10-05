// Fuzzy search over the pane's lines: the query's characters must appear in order
// (case-insensitive); consecutive runs and word starts score higher, gaps cost.
export type Entry = { block: number; text: string }
export type Hit = Entry & { score: number }

const isWordStart = (s: string, i: number) => i === 0 || /[^A-Za-z0-9]/.test(s[i - 1] ?? '') || (/[a-z]/.test(s[i - 1] ?? '') && /[A-Z]/.test(s[i] ?? ''))

// The best score of `query` in `text`, or null when it does not match.
export const score = (query: string, text: string): number | null => {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return null
  const t = text.toLowerCase()
  // ponytail: greedy left-to-right match, then a contiguous-substring bonus; an
  // optimal (DP) alignment if rankings ever look wrong
  let pos = -1
  let total = 0
  let run = 0
  for (const ch of q) {
    const at = t.indexOf(ch, pos + 1)
    if (at < 0) return null
    run = at === pos + 1 ? run + 1 : 0
    total += 1 + run * 2 + (isWordStart(text, at) ? 3 : 0) - Math.min(at - pos - 1, 5) * 0.2
    pos = at
  }
  if (t.includes(q)) total += q.length * 2
  return total
}

// The best `limit` hits, one per line, best first; ties keep document order.
export const search = (query: string, entries: readonly Entry[], limit = 8): Hit[] =>
  entries
    .flatMap((e, i) => {
      const s = score(query, e.text)
      return s === null ? [] : [{ ...e, score: s, i }]
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map(({ i: _, ...hit }) => hit)

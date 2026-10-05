// Turns file references in reply text into file: links, leaving fenced code alone.
// Any `name.ext` matches; the caller keeps only files that exist. Previewable ones
// (markdown, JSON, YAML) open the pane, the rest open the way the surface opens links.
export const PREVIEWABLE = /\.(?:markdown|md|jsonc|json|yaml|yml)$/i
// ponytail: extensionless files (Makefile, LICENSE) are not matched, or every bare word would be a candidate
const FILE = String.raw`(?:[A-Za-z]:[\\/]|[.~]?[\\/])?[\w.\-\\/ ]*[\w\-]\.[A-Za-z][A-Za-z0-9]*`
const TOKEN = new RegExp(
  String.raw`\[([^\]]*)\]\((${FILE})(?:#[^)]*)?\)` + // [label](path.md)
    String.raw`|\x60(${FILE})(:\d+)?\x60` + //            `path.md:12`
    String.raw`|(?<![\w\\/.\[(\x60:])(${FILE.replace(' ', '')})(:\d+)?(?![\w])`, // bare path.md
  'gi',
)

const BS = String.fromCharCode(92) // backslash

export const toUrl =(path: string, cwd: string): string => {
  const p = path.split(BS).join('/')
  const abs = /^([A-Za-z]:)?\//.test(p) ? p : `${cwd.split(BS).join('/').replace(/\/$/, '')}/${p.replace(/^\.\//, '')}`
  return encodeURI(`file://${abs.startsWith('/') ? '' : '/'}${abs}`)
}

export const toPath = (href: string): string => {
  const p = decodeURIComponent(href.replace(/^file:\/\//, ''))
  return /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p
}

// `keep` limits the links to those urls (files known to exist); absent, every match links.
export const linkify = (text: string, cwd: string, keep?: Set<string>): { text: string; links: string[] } => {
  const links: string[] = []
  const link = (match: string, label: string, path: string) => {
    const url = toUrl(path, cwd)
    if (keep && !keep.has(url)) return match
    links.push(url)
    return `[${label}](${url})`
  }
  const out = text
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(TOKEN, (m, label, linkPath, codePath, codeLine, barePath, bareLine) =>
            linkPath
              ? link(m, label, linkPath)
              : codePath
                ? link(m, `\`${codePath}${codeLine ?? ''}\``, codePath)
                : link(m, `${barePath}${bareLine ?? ''}`, barePath),
          ),
    )
    .join('')
  return { text: out, links }
}

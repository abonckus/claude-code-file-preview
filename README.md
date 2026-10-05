# file-preview

A [Claude Code](https://claude.com/claude-code) mod that previews markdown, JSON and YAML files in a side pane. Markdown is drawn like a docs page.

Mention a `.md`, `.json` or `.yaml` file in a conversation and Claude's reply turns it into a link. Click it and the file opens beside the transcript.

## Features

- **Clickable file links.** References to `.md`, `.markdown`, `.json`, `.jsonc`, `.yaml` and `.yml` files in Claude's replies (markdown links, `` `code spans` `` and bare paths) become links when the file exists. A plain click opens the preview.
- **Docs-page layout.** A breadcrumb and stats header, headings with rules under them, a capped reading width and spacing between blocks.
- **Tables.** Columns are fitted to the pane width, long cells wrap inside their column, and a dotted rule separates rows. A table too wide for the pane is shown as one card per row.
- **GitHub callouts.** `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` are drawn as coloured boxes.
- **Mermaid diagrams.** Drawn as box-drawing text by [mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii). Diagram types it does not support show their source, with the reason.
- **JSON and YAML files.** Shown as numbered, highlighted source. The header gives the file's shape (`object, 12 keys`, `array of 340`, or `✖ invalid JSON:` and the parser's message; documents and top-level keys for YAML). A file too long to draw is cut cleanly, with a note.
- **Syntax highlighting.** Code blocks and data files use Claude Code's own highlighter, so any language that highlighter knows is coloured to match your theme, with nothing to install. A language it does not know is drawn plain.
- **Live reload.** The file is checked every 1.5 s and reloaded when it changes, with a toast to say so. There is also a **↻ Refresh** button.
- **Search.** **⌕ Search** opens a fuzzy search over the file: type a few letters in order (`crlim` finds *Credit Limit*), the best matches list under the field, Enter jumps to the first, and each match is a button that scrolls to it.
- **↑ Top** scrolls back to the start.
- **Sticky footer.** The buttons (and the search field while searching) stay on the pane's bottom rows as you scroll.
- **`/preview <path>`** opens any file by hand.

## Requirements

- Claude Code with mod (function hook) support
- Optional: [`mermaid-ascii`](https://github.com/AlexanderGrooff/mermaid-ascii) on your `PATH`, for diagrams
  ```sh
  go install github.com/AlexanderGrooff/mermaid-ascii@latest
  ```

## Install

Clone the repository and start Claude Code with it as a plugin folder:

```sh
git clone https://github.com/abonckus/claude-code-file-preview
claude --plugin-dir ./claude-code-file-preview
```

To load it in every session, add the folder to `CLAUDE_CODE_PLUGIN_DIRS`.

Then ask Claude about a markdown file, or run `/preview examples/sample.md` (also `examples/sample.json` and `examples/sample.yaml`).

## Keys

While the pane has the keyboard (click it, or `ctrl+x tab` from the prompt):

| Key | Does |
|:--|:--|
| `u` | Scroll to the top |
| `s` | Open search |
| `r` | Refresh |
| `up` / `down`, `pageup` / `pagedown`, `home` / `end` | Scroll (Claude Code's own pane keys) |

A pane button's hotkey must be one letter or digit, so search cannot be `/`.

## External highlighters

Claude Code's highlighter does not know every language. For one it does not, point file-preview at any command that can highlight it, with the `highlighters` option in `~/.claude/settings.json`, under `pluginConfigs` and the plugin's id (`file-preview`, or `file-preview@inline` for a plugin loaded from a folder; set both if unsure):

```json
"pluginConfigs": {
  "file-preview": {
    "options": {
      "highlighters": ["al: node \"/path/to/claude-code-al-syntax/highlighter/highlight.mjs\""]
    }
  }
}
```

Each entry is `<language>[, <language>…]: <command> [args…]`, the language being the code fence's name; double quotes group a path with spaces. For each code block in that language, the command is run with the code on stdin and must write a JSON array of `[text, capture]` spans to stdout, `capture` being a tree-sitter highlight name such as `keyword.control` or `comment.line`, or `null`. The spans must join back into the code. Anything else (a non-zero exit, other output) and the block is drawn by Claude Code's highlighter instead.

[al-syntax](https://github.com/abonckus/claude-code-al-syntax) ships such a command for AL, built on tree-sitter.

## Limitations

- **Clicks need the fullscreen layout.** A plain click only reaches the mod in Claude Code's fullscreen terminal layout. Elsewhere, or with ctrl- or alt-click, links open the usual way, so use `/preview` there.
- **The reply bullet is lost.** Replies that mention a previewable file are redrawn by the mod and lose their leading bullet.
- **Size caps.** Replies over 10,000 characters are left alone. Each block of plain text in the pane is capped at 10,000 characters and a markdown file at 60,000, which keeps the drawing inside Claude Code's 100,000-character limit for a pane. JSON and YAML files are cut by line when they would pass that limit.
- **Plain table cells.** Bold, code and links inside a table cell are drawn as plain text.
- **Boxed callouts.** Callouts get a full border, because a terminal box cannot have a border on one side only.

## Development

```sh
claude plugin validate .
claude plugin test .
```

The pure logic lives in `hooks/blocks.ts` (markdown splitting, table fitting, code chunking), `hooks/linkify.ts` (file links), `hooks/highlighters.ts` (the highlighter setting and capture colours) and `hooks/search.ts` (fuzzy search), each with its own `*.test.ts`. `hooks/pane.test.ts` mounts the pane and checks the drawn tree for markdown, JSON and YAML files, the file watcher and the refresh button.

## License

[MIT](LICENSE)

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
- **Live reload.** The file is checked every 1.5 s and reloaded when it changes, with a toast to say so. There is also a **↻ Refresh** button (`r` while the pane has focus).
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

The pure logic lives in `hooks/blocks.ts` (markdown splitting, table fitting, code chunking) and `hooks/linkify.ts` (file links), each with its own `*.test.ts`. `hooks/pane.test.ts` mounts the pane and checks the drawn tree for markdown, JSON and YAML files, the file watcher and the refresh button.

## License

[MIT](LICENSE)

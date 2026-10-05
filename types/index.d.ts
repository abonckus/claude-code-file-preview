export type Doc = { path: string; text: string; mtime: number }

declare module 'claude-code' {
  interface PluginState {
    'file-preview': { doc: Doc }
  }
}

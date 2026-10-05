export type Doc = { path: string; text: string; mtime: number }

declare module 'claude-code' {
  interface PluginState {
    'md-preview': { doc: Doc }
  }
}

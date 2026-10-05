export type Doc = { path: string; text: string; mtime: number }
export type Find = { open: boolean; query: string }

declare module 'claude-code' {
  interface PluginState {
    'file-preview': { doc: Doc; find: Find }
  }
}

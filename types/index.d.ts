export type Doc = { path: string; text: string; mtime: number }
export type Find = { open: boolean; query: string }
export type View = { tick: number }
export type Mark = { block: number | null }

declare module 'claude-code' {
  interface PluginState {
    'file-preview': { doc: Doc; find: Find; view: View; mark: Mark }
  }
}

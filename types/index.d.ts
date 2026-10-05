export type Doc = { path: string; text: string; mtime: number }
export type Find = { open: boolean; query: string }
export type View = { offset: number | undefined }

declare module 'claude-code' {
  interface PluginState {
    'file-preview': { doc: Doc; find: Find; view: View }
  }
}

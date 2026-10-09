export type FileState = 'read' | 'modified' | 'created' | 'committed'

/** `path` is the spelling to show; the record's key is the normalized form. */
export type Touch = { state: FileState; at: number; ops: number; path: string }

declare module 'claude-code' {
  interface PluginState {
    'file-tree': {
      /** The session's working directory, '/'-separated. */
      root: string
      /** Files Claude touched this session, by normalized absolute path. */
      touched: Record<string, Touch>
      /** Folders the person opened (true) or closed (false); absent follows the auto rule. */
      expanded: Record<string, boolean>
      /** Show only folders that lead to touched files. */
      touchedOnly: boolean
    }
  }
}

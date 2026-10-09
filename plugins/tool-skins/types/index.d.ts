/** A skin's name, a key of THEMES in hooks/register.tsx. */
export type SkinName = string

declare module 'claude-code' {
  interface PluginState {
    'tool-skins': {
      /** The active skin; null draws the engine's own rows. */
      skin: SkinName | null
    }
  }
}

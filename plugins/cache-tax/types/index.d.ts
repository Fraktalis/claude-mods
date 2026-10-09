/** The main loop's last request: what the next one re-sends, and when the cache was last refreshed. */
export type LastRequest = { at: number; ctx: number; model: string }

declare module 'claude-code' {
  interface PluginState {
    'cache-tax': {
      last: LastRequest | null
      /** A cold-cache warning shown for this prompt: Enter again before `until` sends it. */
      confirm: { until: number } | null
      keepwarm: boolean
      /** Pings sent since the person last typed. */
      pings: number
      /** The main loop is mid-turn. */
      isBusy: boolean
    }
  }
}

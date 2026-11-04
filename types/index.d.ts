declare module 'claude-code' {
  interface PluginState {
    'waiting-on-me': {
      // true while this session sits in the waiting section
      isWaiting: boolean
      // section the session came from ("sessions" for Ungrouped)
      origin: string
    }
  }
}
export type WaitingOnMeSection = "Waiting on you"

export interface ReconciledSession {
  state: string
  generation: number
  streamId: string
  configSnapshot: unknown
  streamingSubtitle: unknown
  [key: string]: unknown
}

export function reconcileSessionWithCapture<T extends ReconciledSession>(session: T, liveGeneration: number | undefined): T {
  if (typeof liveGeneration !== 'number' || session.state === 'stopping') return session
  // Keep the same object when nothing changed so GET_SESSION and tab switches
  // do not rewrite session storage on every read.
  if (session.state === 'running' && session.generation === liveGeneration) return session

  return {
    ...session,
    state: 'running',
    generation: liveGeneration,
  }
}

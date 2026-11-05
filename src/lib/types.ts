/**
 * Shared types used across lib, app, and extension.
 * Single source of truth for data structures that cross boundaries.
 */

export interface SubtitleLine {
  id: string
  at: number
  /** End timestamp (seconds relative to session start). */
  endedAt: number
  source: string
  target: string
  speaker: string
  latency: number
}

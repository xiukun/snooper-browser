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

/* ===== Notes ===== */

export interface NoteEntry {
  id: string
  type: 'subtitle' | 'image' | 'svg' | 'screenshot' | 'text' | 'summary'
  /** Source timestamp (epoch ms). */
  at: number
  /** Original text (for subtitle type). */
  source?: string
  /** Translation (for subtitle type). */
  target?: string
  /** Image URL or data URL (for image/screenshot types). */
  imageUrl?: string
  /** SVG markup (for svg type). */
  svg?: string
  /** Custom text content. */
  text?: string
  /** Speaker label. */
  speaker?: string
  /** Associated language codes. */
  sourceLang?: string
  targetLang?: string
}

export interface NoteDocument {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Ordered list of entries. */
  entries: NoteEntry[]
  /** Source session metadata. */
  sessionInfo?: {
    source: 'translate' | 'vision' | 'manual'
    mediaName?: string
    duration?: number
  }
}

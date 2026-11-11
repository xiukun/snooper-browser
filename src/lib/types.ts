import type { SourceRef } from './knowledge-types'

/**
 * Shared types used across lib, app, and extension.
 * Single source of truth for data structures that cross boundaries.
 */

export interface SubtitleLine {
  id: string
  sourceRef?: SourceRef
  at: number
  /** End timestamp (seconds relative to session start). */
  endedAt: number
  /** Seconds into the page's video (ADR-033); null/absent when unavailable. */
  videoTime?: number | null
  source: string
  target: string
  speaker: string
  latency: number
}

/* ===== Notes ===== */

export interface NoteEntry {
  id: string
  sourceRef?: SourceRef
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
  /** Seconds into the page's video when this was captured (ADR-035); null/absent when unavailable. */
  videoTime?: number | null
  /** Page URL the entry was captured on; enables `?t=` deep links in exports. */
  videoUrl?: string
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

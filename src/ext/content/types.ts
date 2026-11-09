/** Shared content-script session shapes. */

import type { NoteDocument, SubtitleLine } from '../../lib/types'
import { renderMarkdownLite } from './markdown'

/**
 * The content surface renders whatever the background sends: committed lines
 * are full SubtitleLines, but a session adopted mid-stream can carry partial
 * objects. Export paths only read the optional-safe fields, so the local
 * entry shape is a lenient SubtitleLine.
 */
export type SubtitleEntry = Partial<SubtitleLine> & { id?: string }

export interface StreamingSubtitle {
  at?: number
  source?: string
  partialTarget?: string
  latency?: number
}

export interface ChatMessage {
  role: string
  content: string
  images?: string[]
}

export interface SessionState {
  state: string
  sourceLang: string
  targetLang: string
  subtitles: SubtitleEntry[]
  messages: ChatMessage[]
  streamingSubtitle?: StreamingSubtitle | null
  audioSilent?: boolean
  notes: NoteDocument[]
  activeNoteId: string | null
  isDemoMode: boolean
}

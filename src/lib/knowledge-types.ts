/** Stable references shared by local course retrieval, persistence and exports. */
export type EntryRef =
  | { kind: 'transcript'; recordId: string; lineId: string }
  | { kind: 'note'; noteId: string; entryId: string }

export interface SourceRef {
  key: string
  url: string
  title: string
  confidence: 'exact' | 'legacy' | 'unknown'
}

export type SaveState =
  | { status: 'saved' }
  | { status: 'pending' }
  | { status: 'error'; message: string }

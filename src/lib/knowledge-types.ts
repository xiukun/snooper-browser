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

/** Safe saved-body projection: never carries image data or provider settings. */
export interface LibraryEntry {
  ref: EntryRef
  sourceRef: SourceRef
  sourceEpoch?: string
  title: string
  at: number
  videoTime: number | null
  source: string
  target: string
  text: string
  type: string
}
export type HighlightRange = [number, number]
export interface LibraryHit extends LibraryEntry {
  favorite: boolean
  highlights: { source: HighlightRange[]; target: HighlightRange[]; text: HighlightRange[] }
}
export interface FavoriteEntry { ref: EntryRef; createdAt: number }
export interface DeleteSelection {
  transcriptIds?: string[]
  noteIds?: string[]
  noteEntries?: { noteId: string; entryId: string }[]
}
export type DeleteTarget =
  | { kind: 'transcript'; recordId: string }
  | { kind: 'note'; noteId: string; entryIds: string[]; wholeDocument: boolean }
export interface DeleteSkipped { kind: 'transcript' | 'note'; id: string; reason: string }
export interface DeleteResult {
  operationId: string
  completed: DeleteTarget[]
  pending: { target: DeleteTarget; error: string }[]
  skipped: DeleteSkipped[]
}
export interface LibraryScope {
  kind: 'transcript' | 'note'
  id: string
  title: string
  count: number
}
export interface LibrarySearchResult {
  hits: LibraryHit[]
  cursor: string | null
  complete: boolean
  scanned: number
  errors: { kind: 'transcript' | 'note'; id: string; message: string }[]
  changed: boolean
  scopes: LibraryScope[]
}

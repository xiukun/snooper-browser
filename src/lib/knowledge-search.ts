import type { EntryRef, HighlightRange, LibraryHit, SourceRef } from './knowledge-types'

/** ASCII-only folding leaves UTF-16 positions identical to the original text. */
function fold(text: string): string { return text.replace(/[A-Z]/g, c => c.toLowerCase()) }
export function matchRanges(text: string, query: string): HighlightRange[] {
  const needle = fold(query.trim())
  if (!needle) return []
  const haystack = fold(text)
  const ranges: HighlightRange[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    ranges.push([at, at + needle.length])
    from = at + needle.length
  }
  return ranges
}
export function matchesQuery(entry: { source?: string; target?: string; text?: string }, query: string): boolean {
  return !!query.trim() && [entry.source, entry.target, entry.text].some(value => value && fold(value).includes(fold(query.trim())))
}
export function refKey(ref: EntryRef): string {
  return ref.kind === 'transcript' ? JSON.stringify(['transcript', ref.recordId, ref.lineId]) : JSON.stringify(['note', ref.noteId, ref.entryId])
}
export function groupHits<T extends { sourceRef: SourceRef }>(hits: T[]): { source: SourceRef; hits: T[] }[] {
  const groups = new Map<string, { source: SourceRef; hits: T[] }>()
  for (const hit of hits) {
    let group = groups.get(hit.sourceRef.key)
    if (!group) { group = { source: hit.sourceRef, hits: [] }; groups.set(hit.sourceRef.key, group) }
    group.hits.push(hit)
  }
  return [...groups.values()]
}
export function highlightEntry(entry: Omit<LibraryHit, 'highlights'>, query: string): LibraryHit {
  return { ...entry, highlights: { source: matchRanges(entry.source, query), target: matchRanges(entry.target, query), text: matchRanges(entry.text, query) } }
}

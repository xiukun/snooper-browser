/** Notes are written only by the serialized background operation queue. */
import type { NoteDocument, NoteEntry } from '../../lib/types'
export const NOTES_STORAGE_KEY = 'snooper.notes.v1'
interface NotesResponse {
  notes: NoteDocument[]
  legacyAcknowledged?: boolean
}
let retainedLegacySnapshot: string | null = null
async function requestResult(type: string, fields: Record<string, unknown> = {}): Promise<NotesResponse> {
  const result = await chrome.runtime.sendMessage({ target: 'background', type, ...fields })
  if (!result?.ok || !Array.isArray(result.notes)) throw new Error(result?.error || '笔记保存服务不可用，请重试或导出')
  return result
}
async function request(type: string, fields: Record<string, unknown> = {}): Promise<NoteDocument[]> {
  return (await requestResult(type, fields)).notes
}
export function hasRetainedLegacyNotes(): boolean { return retainedLegacySnapshot !== null }
export function readRetainedLegacyNotes(): string | null {
  try { return localStorage.getItem(NOTES_STORAGE_KEY) ?? retainedLegacySnapshot }
  catch { return retainedLegacySnapshot }
}
export function exportRetainedLegacyNotes(): void {
  const raw = readRetainedLegacyNotes()
  if (!raw) return
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'snooper-legacy-notes.json'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
export async function loadNotes(): Promise<NoteDocument[]> {
  let legacy: NoteDocument[] | undefined
  let submitted: string | null = null
  try {
    submitted = localStorage.getItem(NOTES_STORAGE_KEY)
    if (submitted) legacy = JSON.parse(submitted)
  } catch { /* Keep unreadable legacy originals available for rescue export. */ }
  retainedLegacySnapshot = submitted
  const result = await requestResult('NOTES_LIST', { legacy })
  try {
    const current = localStorage.getItem(NOTES_STORAGE_KEY)
    // Success alone is not migration acknowledgement. Also never remove a
    // newer page snapshot written while the background request was pending.
    if (submitted && current === submitted && result.legacyAcknowledged === true) {
      localStorage.removeItem(NOTES_STORAGE_KEY)
      retainedLegacySnapshot = null
    } else {
      retainedLegacySnapshot = current
      if (current === submitted && Array.isArray(legacy) && legacy.length === 0) retainedLegacySnapshot = null
    }
  } catch { /* Original remains; surface its rescue export. */ }
  return result.notes
}
export function addNoteEntry(note: NoteDocument, entry: NoteEntry): Promise<NoteDocument[]> {
  return request('NOTES_ADD_ENTRY', { input: { noteId: note.id, title: note.title, createdAt: note.createdAt, sessionInfo: note.sessionInfo, entry } })
}
export function deleteNoteEntry(noteId: string, entryId: string): Promise<NoteDocument[]> {
  return request('NOTES_DELETE_ENTRY', { noteId, entryId })
}
export function deleteNoteDocuments(ids: string[]): Promise<NoteDocument[]> {
  return request('NOTES_DELETE_DOCUMENTS', { ids })
}
export function createNoteDocument(title: string, source: NoteDocument['sessionInfo']): NoteDocument {
  const now = Date.now()
  return { id: `note_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`, title, createdAt: now, updatedAt: now, entries: [], sessionInfo: source }
}

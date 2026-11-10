/** Notes are written only by the serialized background operation queue. */
import type { NoteDocument, NoteEntry } from '../../lib/types'
export const NOTES_STORAGE_KEY = 'snooper.notes.v1'
async function request(type: string, fields: Record<string, unknown> = {}): Promise<NoteDocument[]> {
  const result = await chrome.runtime.sendMessage({ target: 'background', type, ...fields })
  if (!result?.ok || !Array.isArray(result.notes)) throw new Error(result?.error || '笔记保存服务不可用，请重试或导出')
  return result.notes
}
export async function loadNotes(): Promise<NoteDocument[]> {
  let legacy: NoteDocument[] | undefined
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY)
    if (raw) legacy = JSON.parse(raw)
  } catch { /* Unreadable page mirror is not the authoritative store. */ }
  const notes = await request('NOTES_LIST', { legacy })
  // A rejected migration leaves the page's original untouched.
  try { localStorage.removeItem(NOTES_STORAGE_KEY) } catch { /* Shared marker prevents resurrection. */ }
  return notes
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

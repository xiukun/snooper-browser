/** Single writer for notes. Callers submit entry operations, never snapshots. */
import type { NoteDocument, NoteEntry } from '../../lib/types'

export const NOTES_STORAGE_KEY = 'snooper.notes.v1'
const INITIALIZED_KEY = 'snooper.notes.initialized.v1'
const MIGRATION_KEY = 'snooper.notes.migration.v1'
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => {}).then(operation)
  queue = run.catch(() => {})
  return run
}
function validDocuments(value: unknown): NoteDocument[] {
  if (!Array.isArray(value)) return []
  return value.filter((note): note is NoteDocument => !!note && typeof note.id === 'string' && Array.isArray(note.entries))
}
async function read(legacy?: NoteDocument[]): Promise<NoteDocument[]> {
  const got = await chrome.storage.local.get([NOTES_STORAGE_KEY, INITIALIZED_KEY, MIGRATION_KEY])
  if (got[INITIALIZED_KEY]) {
    if (got[MIGRATION_KEY]) await chrome.storage.local.remove(MIGRATION_KEY)
    return validDocuments(got[NOTES_STORAGE_KEY])
  }
  // A present empty shared array is authoritative. Never resurrect a page's
  // old localStorage mirror after the user deletes documents.
  const notes = Array.isArray(got[NOTES_STORAGE_KEY])
    ? validDocuments(got[NOTES_STORAGE_KEY])
    : validDocuments(got[MIGRATION_KEY] ?? legacy)
  if (notes.length) await chrome.storage.local.set({ [MIGRATION_KEY]: notes })
  await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes, [INITIALIZED_KEY]: true })
  if (notes.length) await chrome.storage.local.remove(MIGRATION_KEY)
  return notes
}
/** Optional legacy snapshot is accepted only during the one-time initialization. */
export function listNotes(legacy?: NoteDocument[]): Promise<NoteDocument[]> {
  return serial(() => read(legacy))
}
export interface AddNoteEntryInput {
  noteId: string
  entry: NoteEntry
  title?: string
  createdAt?: number
  sessionInfo?: NoteDocument['sessionInfo']
}
export function addNoteEntry(input: AddNoteEntryInput): Promise<NoteDocument[]> {
  return serial(async () => {
    if (!input || typeof input.noteId !== 'string' || !input.noteId || typeof input.entry?.id !== 'string' || !input.entry.id) throw new Error('笔记缺少稳定 ID')
    const entry = input.entry
    if (!['subtitle', 'image', 'svg', 'screenshot', 'text', 'summary'].includes(entry.type) || !Number.isFinite(entry.at)) throw new Error('笔记类型或时间无效')
    for (const field of ['source', 'target', 'text', 'imageUrl', 'svg', 'speaker', 'sourceLang', 'targetLang', 'videoUrl'] as const) {
      if (entry[field] !== undefined && typeof entry[field] !== 'string') throw new Error('笔记正文格式无效')
    }
    if (entry.videoTime != null && (!Number.isFinite(entry.videoTime) || entry.videoTime < 0)) throw new Error('笔记视频时间无效')
    const notes = await read()
    let note = notes.find(n => n.id === input.noteId)
    if (!note) {
      const now = Date.now()
      note = { id: input.noteId, title: input.title || '笔记', createdAt: input.createdAt ?? now, updatedAt: now, entries: [], sessionInfo: input.sessionInfo }
      notes.push(note)
    }
    if (note.entries.some(e => e.id === input.entry.id)) return notes
    note.entries.push(structuredClone(input.entry))
    note.updatedAt = Date.now()
    await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes })
    return notes
  })
}
export function deleteNoteEntry(noteId: string, entryId: string): Promise<NoteDocument[]> {
  return serial(async () => {
    const notes = await read()
    const note = notes.find(n => n.id === noteId)
    if (note) {
      note.entries = note.entries.filter(e => e.id !== entryId)
      note.updatedAt = Date.now()
      await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes })
    }
    return notes
  })
}
export function deleteNoteDocuments(ids: string[]): Promise<NoteDocument[]> {
  return serial(async () => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('笔记 ID 无效')
    const notes = (await read()).filter(n => !ids.includes(n.id))
    // Keep an empty authoritative array plus the migration marker.
    await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes })
    return notes
  })
}

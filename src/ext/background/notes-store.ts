import { legacySourceRef } from '../../lib/video-key'
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
  // A sidepanel/other origin with no old data must not consume the first
  // real legacy import. A stored empty array still denotes an explicit write
  // or deletion and remains authoritative.
  if (!Array.isArray(got[NOTES_STORAGE_KEY]) && notes.length === 0) return []
  if (notes.length) await chrome.storage.local.set({ [MIGRATION_KEY]: notes })
  await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes, [INITIALIZED_KEY]: true })
  if (notes.length) await chrome.storage.local.remove(MIGRATION_KEY)
  return notes
}
export interface NotesListResult {
  notes: NoteDocument[]
  /** True only when the supplied legacy document/entry bodies are present. */
  legacyAcknowledged: boolean
}
function withProvenance(notes: NoteDocument[]): NoteDocument[] {
  return notes.map(note => ({ ...note, entries: note.entries.map(entry => ({ ...entry, sourceRef: entry.sourceRef || legacySourceRef(entry.videoUrl || '', note.title, note.id) })) }))
}
function includesLegacySnapshot(notes: NoteDocument[], legacy: unknown): boolean {
  if (!Array.isArray(legacy) || legacy.length === 0 || validDocuments(legacy).length !== legacy.length) return false
  return (legacy as NoteDocument[]).every(old => {
    const saved = notes.find(note => note.id === old.id)
    if (!saved) return false
    // updatedAt may advance after an earlier import. Every other supplied
    // document field and every complete entry must still be represented.
    const sameMetadata = Object.entries(old).every(([key, value]) =>
      key === 'entries' || key === 'updatedAt' || JSON.stringify((saved as unknown as Record<string, unknown>)[key]) === JSON.stringify(value))
    return sameMetadata && old.entries.every(entry => saved.entries.some(current => JSON.stringify(current) === JSON.stringify(entry)))
  })
}
/** Legacy import is conservative once an explicit shared write/delete exists. */
export function listNotesWithMigration(legacy?: NoteDocument[]): Promise<NotesListResult> {
  return serial(async () => {
    const notes = await read(legacy)
    return { notes: withProvenance(notes), legacyAcknowledged: includesLegacySnapshot(notes, legacy) }
  })
}
/** Always returns authoritative saved data; retained page mirrors stay separate. */
export async function listNotes(legacy?: NoteDocument[]): Promise<NoteDocument[]> {
  return (await listNotesWithMigration(legacy)).notes
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
    if (note.entries.some(e => e.id === input.entry.id)) return withProvenance(notes)
    note.entries.push(structuredClone(input.entry))
    note.updatedAt = Date.now()
    await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes, [INITIALIZED_KEY]: true })
    return withProvenance(notes)
  })
}
export function deleteNoteEntry(noteId: string, entryId: string): Promise<NoteDocument[]> {
  return serial(async () => {
    const notes = await read()
    const note = notes.find(n => n.id === noteId)
    if (note) {
      note.entries = note.entries.filter(e => e.id !== entryId)
      note.updatedAt = Date.now()
    }
    await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes, [INITIALIZED_KEY]: true })
    return withProvenance(notes)
  })
}
export function deleteNoteDocuments(ids: string[]): Promise<NoteDocument[]> {
  return serial(async () => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('笔记 ID 无效')
    const notes = (await read()).filter(n => !ids.includes(n.id))
    // Keep an empty authoritative array plus the migration marker.
    await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes, [INITIALIZED_KEY]: true })
    return withProvenance(notes)
  })
}

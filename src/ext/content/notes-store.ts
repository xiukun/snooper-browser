/**
 * Note persistence shared by the in-page drawer and the side panel.
 *
 * Notes live in chrome.storage.local so both surfaces edit one store. Page
 * localStorage is kept as a legacy mirror and migrated into the shared store
 * on first read.
 */

import type { NoteDocument } from '../../lib/types'

export const NOTES_STORAGE_KEY = 'snooper.notes.v1'

export async function loadNotes(): Promise<NoteDocument[]> {
  // 1. Shared store (page + side panel)
  try {
    const got = await (chrome as any).storage.local.get(NOTES_STORAGE_KEY)
    const stored = got?.[NOTES_STORAGE_KEY]
    if (Array.isArray(stored)) return stored as NoteDocument[]
  } catch { /* ignore */ }
  // 2. Legacy page localStorage -> migrate into the shared store
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as NoteDocument[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        try {
          await (chrome as any).storage.local.set({ [NOTES_STORAGE_KEY]: parsed })
        } catch { /* ignore */ }
        return parsed
      }
    }
  } catch { /* ignore */ }
  return []
}

export async function saveNotes(notes: NoteDocument[]) {
  try {
    await (chrome as any).storage.local.set({ [NOTES_STORAGE_KEY]: notes })
  } catch { /* ignore */ }
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes))
  } catch { /* ignore */ }
}

export function createNoteDocument(title: string, source: NoteDocument['sessionInfo']): NoteDocument {
  const now = Date.now()
  return {
    id: `note_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    createdAt: now,
    updatedAt: now,
    entries: [],
    sessionInfo: source,
  }
}

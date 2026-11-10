import { addNoteEntry, deleteNoteDocuments, deleteNoteEntry, listNotesWithMigration } from '../notes-store'
import type { MessageHandlerMap } from './types'

export const notesHandlers: MessageHandlerMap = {
  NOTES_LIST: (message, { sendResponse }) => {
    listNotesWithMigration(message.legacy).then(result => sendResponse({ ok: true, ...result })).catch(err => sendResponse({ ok: false, error: String(err.message || err) }))
    return true
  },
  NOTES_ADD_ENTRY: (message, { sendResponse }) => {
    addNoteEntry(message.input).then(notes => sendResponse({ ok: true, notes })).catch(err => sendResponse({ ok: false, error: String(err.message || err) }))
    return true
  },
  NOTES_DELETE_ENTRY: (message, { sendResponse }) => {
    deleteNoteEntry(String(message.noteId || ''), String(message.entryId || '')).then(notes => sendResponse({ ok: true, notes })).catch(err => sendResponse({ ok: false, error: String(err.message || err) }))
    return true
  },
  NOTES_DELETE_DOCUMENTS: (message, { sendResponse }) => {
    deleteNoteDocuments(message.ids).then(notes => sendResponse({ ok: true, notes })).catch(err => sendResponse({ ok: false, error: String(err.message || err) }))
    return true
  },
}

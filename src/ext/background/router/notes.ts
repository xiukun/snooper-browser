import { addNoteEntry, listNotesWithMigration } from '../notes-store'
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
  NOTES_DELETE_ENTRY: (_message, { sendResponse }) => {
    sendResponse({ ok: false, code: 'CONFIRMATION_REQUIRED', error: '请先预览删除范围和受影响收藏，再确认删除' })
    return false
  },
  NOTES_DELETE_DOCUMENTS: (_message, { sendResponse }) => {
    sendResponse({ ok: false, code: 'CONFIRMATION_REQUIRED', error: '请先预览删除范围和受影响收藏，再确认删除' })
    return false
  },
}

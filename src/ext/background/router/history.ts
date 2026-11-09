/** History read/delete handlers. */

import { clearHistory, deleteHistoryEntries, readHistory } from '../history'
import type { MessageHandlerMap } from './types'

export const historyHandlers: MessageHandlerMap = {
  GET_HISTORY: (_message, { sendResponse }) => {
    readHistory().then((history) => {
      sendResponse({ ok: true, history })
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message })
    })
    return true
  },

  DELETE_HISTORY: (message, { sendResponse }) => {
    const ids = Array.isArray(message.ids)
      ? message.ids.map((id: any) => String(id))
      : [String(message.id || '')]
    deleteHistoryEntries(ids).then(() => sendResponse({ ok: true })).catch(() => {
      sendResponse({ ok: false })
    })
    return true
  },

  DELETE_ALL_HISTORY: (_message, { sendResponse }) => {
    clearHistory().then(() => sendResponse({ ok: true })).catch(() => {
      sendResponse({ ok: false })
    })
    return true
  },
}

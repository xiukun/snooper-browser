/** Transcript history read/delete handlers (ADR-031). */

import { sessions } from '../session-store'
import {
  clearTranscripts,
  deleteTranscripts,
  findLatestTranscriptIdForTab,
  getTranscriptRecord,
  listTranscripts,
  readTranscript,
} from '../transcript-store'
import type { MessageHandlerMap } from './types'

export const historyHandlers: MessageHandlerMap = {
  /** Summaries only; subtitle bodies stay on disk until requested. */
  GET_HISTORY: (_message, { sendResponse }) => {
    listTranscripts().then((history) => {
      sendResponse({ ok: true, history })
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message })
    })
    return true
  },

  /** Full body for one history record, loaded on demand by the panel. */
  GET_HISTORY_TRANSCRIPT: (message, { sendResponse }) => {
    const id = String(message.id || '')
    void Promise.all([readTranscript(id), getTranscriptRecord(id)]).then(([subtitles, record]) => {
      sendResponse({ ok: true, subtitles, record })
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message || '无法读取历史内容' })
    })
    return true
  },

  /** Full body for the active tab's current transcript (copy/export). */
  GET_TRANSCRIPT: (_message, { tabId, sendResponse }) => {
    const s = sessions.get(tabId)
    void (async () => {
      const id = s?.transcriptId || await findLatestTranscriptIdForTab(tabId)
      if (!id) {
        sendResponse({ ok: true, subtitles: [], record: null })
        return
      }
      const [subtitles, record] = await Promise.all([readTranscript(id), getTranscriptRecord(id)])
      sendResponse({ ok: true, subtitles, record })
    })().catch((err) => {
      sendResponse({ ok: false, error: err.message || '无法读取完整转写' })
    })
    return true
  },

  DELETE_HISTORY: (message, { sendResponse }) => {
    const ids = Array.isArray(message.ids)
      ? message.ids.map((id: any) => String(id))
      : [String(message.id || '')]
    deleteTranscripts(ids).then((result) => {
      sendResponse({ ok: true, ...result })
    }).catch(() => {
      sendResponse({ ok: false })
    })
    return true
  },

  DELETE_ALL_HISTORY: (_message, { sendResponse }) => {
    clearTranscripts().then((result) => {
      sendResponse({ ok: true, ...result })
    }).catch(() => {
      sendResponse({ ok: false })
    })
    return true
  },
}

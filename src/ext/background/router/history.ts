/** Transcript history read/delete handlers (ADR-031). */

import { sessions, retrySessionTranscript, finishSessionTranscript } from '../session-store'
import {
  clearTranscripts,
  deleteTranscripts,
  findLatestTranscriptIdForTab,
  getTranscriptRecord,
  listTranscripts,
  readTranscript,
  readAvailableTranscript,
  readTranscriptPage,
} from '../transcript-store'
import type { MessageHandlerMap } from './types'

export const historyHandlers: MessageHandlerMap = {
  GET_SAVE_FAILURES: (_message, { tabId, sendResponse }) => {
    if (tabId != null) { sendResponse({ ok: false, error: '请在侧栏查看全部保存状态' }); return false }
    sendResponse({ ok: true, failures: [...sessions.values()].filter(s => s.saveState?.status === 'error').map(s => ({ tabId: s.tabId, transcriptId: s.transcriptId, pendingCount: s.pendingTranscriptLines?.length || 0, saveState: s.saveState })) })
    return false
  },
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

  GET_TRANSCRIPT_PAGE: (message, { sendResponse }) => {
    readTranscriptPage(String(message.id || ''), Number(message.chunkIndex)).then(page => sendResponse({ ok: true, ...page })).catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  },
  RETRY_TRANSCRIPT: (message, { tabId, sendResponse }) => {
    const targetTab = tabId ?? Number(message.tabId)
    const s = sessions.get(targetTab)
    if (!s) { sendResponse({ ok: false, error: '没有可重试的转写' }); return false }
    void retrySessionTranscript(s).then(async () => {
      if (s.state === 'idle' || s.state === 'error') await finishSessionTranscript(s)
      sendResponse({ ok: true })
    }).catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  },
  /** Reads durable bodies and failed buffers; completeness is explicit. */
  GET_TRANSCRIPT: (message, { tabId, sendResponse }) => {
    const targetTab = tabId ?? Number(message.tabId)
    const s = sessions.get(targetTab)
    void (async () => {
      const id = s?.transcriptId || await findLatestTranscriptIdForTab(targetTab)
      const result = id ? await readAvailableTranscript(id) : { lines: [], complete: !s?.subtitles.length }
      const lines = [...result.lines]
      const seen = new Set(lines.map(l => l.id))
      for (const line of s?.pendingTranscriptLines || []) {
        if (!seen.has(line.id)) { lines.push(line); seen.add(line.id) }
      }
      lines.sort((a, b) => a.at - b.at)
      sendResponse({ ok: true, subtitles: lines, complete: result.complete, error: result.error, saveState: s?.saveState })
    })().catch((err) => {
      sendResponse({ ok: false, error: err.message || '无法读取完整转写', subtitles: s?.pendingTranscriptLines || [], complete: false })
    })
    return true
  },

  DELETE_HISTORY: (message, { sendResponse }) => {
    const ids = Array.isArray(message.ids)
      ? message.ids.map((id: any) => String(id))
      : [String(message.id || '')]
    deleteTranscripts(ids).then((result) => {
      sendResponse({ ok: true, ...result })
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message || '删除失败，请重试' })
    })
    return true
  },

  DELETE_ALL_HISTORY: (_message, { sendResponse }) => {
    clearTranscripts().then((result) => {
      sendResponse({ ok: true, ...result })
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message || '删除失败，请重试' })
    })
    return true
  },
}

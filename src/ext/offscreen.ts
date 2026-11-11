/**
 * RTTS Offscreen Document — entry and message router.
 *
 * Audio capture, WAV chunking, and STREAMING API calls live in ./offscreen/*:
 *   audio.ts   — WAV encoding + SSE reader
 *   api.ts     — transcription, translation, subtitle Q&A
 *   capture.ts — per-tab sessions, segmentation, frames, keepalive
 *
 * Streaming Architecture (ADR-008):
 *   ASR:  POST /v1/audio/transcriptions + stream=true → SSE events
 *   LLM:  POST /v1/chat/completions + stream=true → SSE delta events
 *
 * Communication:
 *   ← background: START_CAPTURE, STOP_CAPTURE, ASK_QUESTION
 *   → background: CAPTURE_SUBTITLE_STREAMING (per-delta during translation)
 *                 CAPTURE_SUBTITLE (final, completed translation)
 *                 CAPTURE_ERROR
 */

import { askQuestion } from './offscreen/api'
import {
  captureSessions,
  setCaptureSource,
  prepareCaptureSource,
  captureVideoFrame,
  checkSegment,
  startTabCapture,
  stopTabCapture,
} from './offscreen/capture'
import {
  isScreenCaptionActive,
  setScreenCaptionLang,
  startScreenCaption,
  stopScreenCaption,
} from './offscreen/screen-caption'

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  if (sender.id !== chrome.runtime.id) return false
  if (message?.target && message.target !== 'offscreen') return false

  switch (message.type) {
    case 'START_CAPTURE': {
      const { tabId, streamId, sourceLang, targetLang, config, generation, sourceEpoch, sourceRef } = message
      startTabCapture({ tabId, streamId, sourceLang, targetLang, config, generation, sourceEpoch, sourceRef })
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: err.message }))
      return true
    }

    case 'STOP_CAPTURE': {
      const tabId = message.tabId
      // The sampler reads the capture video element; it must stop before the
      // element is torn down.
      stopScreenCaption(tabId)
      stopTabCapture(tabId, message.generation, message.drain === true).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: err.message }))
      return true
    }

    case 'PREPARE_CAPTURE_SOURCE': {
      sendResponse(prepareCaptureSource(message.tabId, message.generation, message.sourceEpoch))
      return false
    }

    case 'SET_CAPTURE_SOURCE': {
      sendResponse(setCaptureSource(message.tabId, message.generation, message.previousSourceEpoch, message.sourceEpoch, message.sourceRef))
      return false
    }

    case 'GET_CAPTURE_SESSIONS': {
      const sessions: Record<string, number> = {}
      for (const [tabId, session] of captureSessions) {
        sessions[String(tabId)] = session.generation
      }
      sendResponse({
        ok: true,
        tabIds: Array.from(captureSessions.keys()),
        sessions,
        sources: Object.fromEntries([...captureSessions].map(([tabId, s]) => [String(tabId), { sourceEpoch: s.sourceEpoch, bindings: s.sourceBindings }])),
      })
      return false
    }

    case 'SET_LANG': {
      const tabId = message.tabId
      const session = captureSessions.get(tabId)
      if (session) {
        if (message.sourceLang) session.sourceLang = message.sourceLang
        if (message.targetLang) session.targetLang = message.targetLang
      }
      if (message.targetLang) setScreenCaptionLang(tabId, message.targetLang)
      sendResponse({ ok: true })
      return false
    }

    case 'START_SCREEN_CAPTION': {
      const { tabId, generation, config, targetLang } = message
      const result = startScreenCaption({ tabId, generation, config, targetLang })
      sendResponse(result)
      return false
    }

    case 'STOP_SCREEN_CAPTION': {
      stopScreenCaption(message.tabId)
      sendResponse({ ok: true })
      return false
    }

    case 'GET_SCREEN_CAPTION': {
      sendResponse({ ok: true, active: isScreenCaptionActive(message.tabId) })
      return false
    }

    case 'CAPTURE_FRAME': {
      captureVideoFrame(message.tabId)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: err.message || '帧捕获失败' }))
      return true
    }

    case 'ASK_QUESTION': {
      const { tabId, question, requestId, generation, config, context, sourceLang, targetLang } = message
      const session = captureSessions.get(tabId)
      if (!session || session.generation !== generation) {
        sendResponse({ ok: false, error: '会话已过期' })
        return false
      }
      if (session.currentAskController) session.currentAskController.abort()
      const controller = new AbortController()
      session.currentAskController = controller

      askQuestion({ question, context: context || '', config, sourceLang, targetLang, signal: controller.signal })
        .then((answer) => {
          if (controller.signal.aborted) return
          session.currentAskController = null
          sendResponse({ ok: true, answer, requestId })
        })
        .catch((err) => {
          if (err.name === 'AbortError') return
          session.currentAskController = null
          sendResponse({ ok: false, error: err.message, requestId })
        })
      return true
    }

    default:
      sendResponse({ ok: false, error: `未知消息类型: ${message.type}` })
      return false
  }
})

// Periodic segment check
setInterval(() => {
  for (const tabId of captureSessions.keys()) {
    checkSegment(tabId)
  }
}, 200)

console.log('[RTTS] Offscreen document v0.5 (TS) initialized')

/**
 * Screen-caption channel toggle (ADR-043).
 *
 * The content script may ask to turn the channel on, but only the background
 * knows the session generation, the config snapshot and whether the offscreen
 * capture is alive. The key therefore never reaches the page: it travels
 * background → offscreen → provider.
 */

import { loadConfig } from '../config'
import { sendToOffscreen } from '../offscreen'
import { getOrCreateSession, pushSession, reconcileSessionState, safeSession } from '../session-store'
import type { MessageHandlerMap } from './types'

export const screenCaptionHandlers: MessageHandlerMap = {
  START_SCREEN_CAPTION: (message, { sendResponse, tabId }) => {
    ;(async () => {
      if (typeof tabId !== 'number') {
        sendResponse({ ok: false, error: '无法确定当前标签页' })
        return
      }
      const s = await reconcileSessionState(tabId)
      if (s.state !== 'running' && s.state !== 'starting') {
        sendResponse({ ok: false, error: '请先开始录音，画面字幕会读取录制中的视频' })
        return
      }
      // A capture started before a config change must use the current key.
      const config = s.configSnapshot || (await loadConfig())
      const targetLang = message.targetLang || s.targetLang || 'zh'

      try {
        const result = await sendToOffscreen({
          type: 'START_SCREEN_CAPTION',
          tabId,
          generation: s.generation,
          config,
          targetLang,
        })
        if (!result?.ok) {
          sendResponse({ ok: false, error: result?.error || '画面字幕启动失败' })
          return
        }
        s.screenCaption = 'on'
        s.screenCaptionError = ''
        pushSession(tabId)
        sendResponse({ ok: true, session: safeSession(s) })
      } catch (err: any) {
        sendResponse({ ok: false, error: err?.message || '画面字幕启动失败' })
      }
    })()
    return true
  },

  STOP_SCREEN_CAPTION: (_message, { sendResponse, tabId }) => {
    ;(async () => {
      if (typeof tabId !== 'number') {
        sendResponse({ ok: false, error: '无法确定当前标签页' })
        return
      }
      const s = getOrCreateSession(tabId)
      try {
        await sendToOffscreen({ type: 'STOP_SCREEN_CAPTION', tabId })
      } catch {
        // The offscreen document may already be gone; the state below is still
        // the truth the toolbar should show.
      }
      s.screenCaption = 'off'
      s.screenCaptionError = ''
      pushSession(tabId)
      sendResponse({ ok: true, session: safeSession(s) })
    })()
    return true
  },

  GET_SCREEN_CAPTION: (_message, { sendResponse, tabId }) => {
    ;(async () => {
      if (typeof tabId !== 'number') {
        sendResponse({ ok: false, error: '无法确定当前标签页' })
        return
      }
      const s = await reconcileSessionState(tabId)
      sendResponse({
        ok: true,
        active: s.screenCaption === 'on',
        status: s.screenCaption,
        error: s.screenCaptionError,
      })
    })()
    return true
  },
}

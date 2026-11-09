/** Screenshot capture: visible tab first, offscreen video frame as fallback. */

import { hasOffscreenDocument, sendToOffscreen } from '../offscreen'
import type { MessageHandlerMap } from './types'

export const captureHandlers: MessageHandlerMap = {
  CAPTURE_SCREENSHOT: (_message, { tabId, sender, sendResponse }) => {
    // Try visible tab capture first. When a tab has an active audio capture
    // (tabCapture), this method throws "Cannot capture a tab with an active
    // stream." In that case we ask offscreen to grab a video frame.
    const windowId = sender.tab?.windowId
    const captureVisible = () => windowId != null
      ? chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      : chrome.tabs.captureVisibleTab({ format: 'png' })
    captureVisible().then((dataUrl) => {
      console.log('[RTTS] screenshot source=visible-tab')
      sendResponse({ ok: true, dataUrl, path: 'visible-tab' })
    }).catch(async (err) => {
      if (err.message && /active stream/i.test(err.message)) {
        // Only a running offscreen capture can supply a frame. Do not create
        // an empty offscreen document just to ask for one.
        if (!(await hasOffscreenDocument())) {
          sendResponse({ ok: false, error: '截图失败：标签页正被其他录音占用，请停止后重试' })
          return
        }
        // Fallback: ask offscreen for a frame from its capture video element
        sendToOffscreen({ type: 'CAPTURE_FRAME', tabId }).then((frame: any) => {
          if (frame && frame.dataUrl) {
            console.log('[RTTS] screenshot source=offscreen-frame')
            sendResponse({ ok: true, dataUrl: frame.dataUrl, path: 'offscreen-frame' })
          } else {
            sendResponse({
              ok: false,
              error: frame?.error || '截图失败：录制中的视频帧尚未就绪，请稍后再试',
            })
          }
        }).catch((e) => {
          sendResponse({ ok: false, error: '截图失败：' + (e.message || '') })
        })
      } else {
        sendResponse({ ok: false, error: err.message || '截图失败' })
      }
    })
    return true
  },
}

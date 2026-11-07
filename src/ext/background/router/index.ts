/**
 * Background message router.
 *
 * Validates the sender once, then dispatches by message type. Feature
 * handlers live next to their domain modules; this file only wires them.
 */

import { registerOffscreenEventRouter } from './offscreen-events'
import { captureHandlers } from './capture'
import { configHandlers } from './config'
import { historyHandlers } from './history'
import { imageHandlers } from './image'
import { obsidianHandlers } from './obsidian'
import { sessionHandlers } from './session'
import type { MessageHandlerMap } from './types'

export const backgroundHandlers: MessageHandlerMap = {
  ...configHandlers,
  ...imageHandlers,
  ...sessionHandlers,
  ...captureHandlers,
  ...obsidianHandlers,
  ...historyHandlers,
}

export function registerBackgroundRouters(): void {
  chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    // Only handle messages targeted at background
    if (message?.target !== 'background') {
      // If targeted at offscreen, ignore here
      return false
    }

    const tabId = sender.tab?.id
    const isContentScript = !!tabId
    const isSidePanel = sender.url?.startsWith(chrome.runtime.getURL('sidepanel/'))

    // For content script messages, reject if no valid tab context
    if (isContentScript && !tabId) {
      sendResponse({ ok: false, error: '无法确定标签页上下文' })
      return false
    }

    // For side panel messages, reject non-extension origins
    if (!isContentScript && !isSidePanel) {
      sendResponse({ ok: false, error: '未经授权的来源' })
      return false
    }

    const handler = backgroundHandlers[message.type]
    if (!handler) {
      sendResponse({ ok: false, error: `未知消息类型: ${message.type}` })
      return false
    }

    return handler(message, {
      tabId: tabId as number,
      sender,
      sendResponse,
    })
  })

  registerOffscreenEventRouter()
}

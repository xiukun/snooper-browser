/**
 * Tab lifecycle, action click, and install handling.
 *
 * Registration order matters: the first onRemoved listener deletes the
 * session before the second one can persist history, which is the shipped
 * behavior. Keep these listeners together so that interaction stays explicit.
 */

import { openToolbarForTab } from '../action-flow'
import { DEFAULT_CONFIG, loadConfig, saveConfig } from './config'
import { persistSessionHistory } from './history'
import { sendToOffscreen } from './offscreen'
import {
  maybeCloseOffscreen,
  persistSessions,
  pushSession,
  reconcileSessionState,
  sessions,
} from './session-store'

const CONTENT_SCRIPT_FILE = 'content.js'
const FS_BRIDGE_FILE = 'fullscreen-bridge.js'

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  })
}

function removeSession(tabId: number): void {
  sessions.delete(tabId)
  // Also tell offscreen to clean up
  sendToOffscreen({ type: 'STOP_CAPTURE', tabId }).catch(() => {})
  maybeCloseOffscreen()
}

function stopSessionForTab(tabId: number): void {
  const s = sessions.get(tabId)
  if (!s || (s.state !== 'running' && s.state !== 'starting')) return
  if (s.subtitles.length > 0) persistSessionHistory(tabId)
  sendToOffscreen({ type: 'STOP_CAPTURE', tabId, generation: s.generation }).catch(() => {})
  s.state = 'idle'
  s.streamId = ''
  s.configSnapshot = null
  s.subtitles = []
  s.streamingSubtitle = null
  s.audioSilent = false
  // Keep messages across navigation
  pushSession(tabId)
  maybeCloseOffscreen()
}

export function registerLifecycleListeners(): void {
  // Clean up on tab close
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    removeSession(tabId)
  })

  // Clean up on navigation
  chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: any) => {
    // Only a real document load (`status: 'loading'`) destroys the content
    // script and therefore invalidates the capture. SPA history.pushState URL
    // changes keep the script alive, so stopping there would end a recording
    // for no reason (e.g. Bilibili switching a player parameter).
    if (changeInfo.status === 'loading') {
      stopSessionForTab(tabId)
    }
  })

  chrome.tabs.onRemoved.addListener((tabId: number) => {
    const s = sessions.get(tabId)
    if (!s) return
    if (s.subtitles.length > 0) persistSessionHistory(tabId)
    sendToOffscreen({ type: 'STOP_CAPTURE', tabId, generation: s.generation }).catch(() => {})
    sessions.delete(tabId)
    persistSessions()
    maybeCloseOffscreen()
  })

  chrome.tabs.onActivated.addListener(async (activeInfo: any) => {
    // reconcileSessionState waits for recovery before reading the map.
    const session = await reconcileSessionState(activeInfo.tabId)
    if (session.state === 'running' || session.state === 'starting') pushSession(activeInfo.tabId)
  })

  /* ===== Action Click ===== */

  chrome.action.onClicked.addListener((tab: any) => {
    if (typeof tab.id !== 'number') return

    // Inject MAIN-world fullscreen bridge (needs MAIN to intercept requestFullscreen)
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [FS_BRIDGE_FILE],
      world: 'MAIN',
    }).catch((err: any) => {
      console.warn('[RTTS] FS bridge injection error:', err.message)
    })

    // A newly opened or restored tab may not have the content script yet.
    void openToolbarForTab(tab.id, {
      tabUrl: tab.url,
      sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
      injectContentScript,
    }).catch((err: any) => {
      console.warn('[RTTS] toolbar unavailable:', err.message)
    })

    // Open side panel for configuration
    chrome.sidePanel.open({ tabId: tab.id }).catch((err: any) => {
      console.warn('[RTTS] sidePanel.open error:', err.message)
    })
  })

  /* ===== Extension Install / Update ===== */

  chrome.runtime.onInstalled.addListener(async () => {
    // Set side panel behavior
    try {
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: false, // We handle this manually in onClicked
      })
    } catch {
      // Older Chrome versions
    }

    // Ensure default config exists
    const existing = await loadConfig()
    if (!existing || !existing.providers || existing.providers.length === 0) {
      await saveConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)))
    }
  })
}

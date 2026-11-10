/**
 * Tab lifecycle, action click, and install handling.
 *
 * Every path that destroys a capture finalizes the durable transcript
 * (ADR-031) before dropping the in-memory session. Finalization is
 * idempotent, so navigation racing a tab close is harmless.
 *
 * Explicit stop also waits (bounded) for the segment already in ASR so the
 * last line of a session is not dropped. That drain is only available on the
 * explicit STOP path, because a destroyed document cannot wait for itself.
 */

import { openToolbarForTab } from '../action-flow'
import { DEFAULT_CONFIG, loadConfig, saveConfig } from './config'
import { sendToOffscreen } from './offscreen'
import {
  maybeCloseOffscreen,
  nextGeneration,
  persistSessions,
  pushSession,
  reconcileSessionState,
  sessions,
} from './session-store'
import { finalizeSessionTranscript } from './transcript-store'
import { resetVideoClock } from './video-clock'

const CONTENT_SCRIPT_FILE = 'content.js'
const FS_BRIDGE_FILE = 'fullscreen-bridge.js'

/**
 * Close an offscreen document only after its STOP finished. Closing first
 * could abort the teardown and leave Chrome's native tab stream behind,
 * which makes the next START fail with `active stream`.
 */
function closeOffscreenAfterStop(stop: Promise<unknown>): void {
  void stop.catch(() => {}).then(() => maybeCloseOffscreen())
}

async function injectContentScript(tabId: number): Promise<void> {
  // ADR-042: a tab that was open when the extension reloaded still carries
  // the previous content script's install marker. That script's extension
  // APIs are dead, so without clearing the marker the fresh script bails out
  // and the retried message fails with "Receiving end does not exist" until
  // the user refreshes the page.
  //
  // This runs only after a send failed, i.e. no live listener answered, so
  // clearing unconditionally is safe. The in-page liveness probe remains as
  // the guard against a double injection; it is not needed here, where the
  // missed message is already proof.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: () => {
      delete (globalThis as any).__rttsContentInstalled
    },
  })
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  })
}

function removeSession(tabId: number): void {
  const s = sessions.get(tabId)
  sessions.delete(tabId)
  resetVideoClock(tabId)
  if (s) {
    const stop = sendToOffscreen({ type: 'STOP_CAPTURE', tabId, generation: s.generation }).catch(() => {})
    // Each subtitle is already on disk; finalization closes the record and
    // keeps the prefix readable. Recovery repeats this if the worker dies.
    closeOffscreenAfterStop(stop)
    void finalizeSessionTranscript(s).catch(() => {})
  } else {
    closeOffscreenAfterStop(sendToOffscreen({ type: 'STOP_CAPTURE', tabId }).catch(() => {}))
  }
  persistSessions()
}

function stopSessionForTab(tabId: number): void {
  const s = sessions.get(tabId)
  if (!s || (s.state !== 'running' && s.state !== 'starting')) return
  resetVideoClock(tabId)
  const stop = sendToOffscreen({ type: 'STOP_CAPTURE', tabId, generation: s.generation }).catch(() => {})
  s.state = 'idle'
  s.generation = nextGeneration()
  s.stoppedGeneration = undefined
  s.streamId = ''
  s.configSnapshot = null
  s.streamingSubtitle = null
  s.audioSilent = false
  // Keep messages across navigation
  pushSession(tabId)
  void finalizeSessionTranscript(s).finally(() => {
    // The next document is a different page: copy/export must not read the
    // previous page's transcript through the new tab session.
    s.transcriptId = null
    s.subtitles = []
    pushSession(tabId)
  })
  closeOffscreenAfterStop(stop)
}

export function registerLifecycleListeners(): void {
  // Clean up on tab close. One listener only: an earlier revision registered
  // two, and the first deleted the session before the second could persist it.
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

/**
 * Offscreen → background events.
 *
 * Second `onMessage` listener: only messages whose sender URL is the offscreen
 * document are accepted. It stays separate from the main router so the two
 * listeners keep their original sender validation and ordering.
 */

import { persistSessionHistory } from '../history'
import { OFFSCREEN_PATH } from '../offscreen'
import {
  maybeCloseOffscreen,
  pushSession,
  pushStreamingUpdate,
  sessions,
} from '../session-store'

export function registerOffscreenEventRouter(): void {
  chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    // Only process messages FROM offscreen
    if (sender.url !== chrome.runtime.getURL(OFFSCREEN_PATH)) {
      return false
    }

    switch (message.type) {
      case 'CAPTURE_AUDIO_STATE': {
        // Offscreen tells us when the tab goes quiet (paused video, muted, or a
        // silent stretch). The UI uses this to say "no audio" instead of looking
        // like it is translating something invisible.
        const s = sessions.get(message.tabId)
        if (s && s.generation === message.generation) {
          const next = !!message.silent
          if (s.audioSilent !== next) {
            s.audioSilent = next
            pushSession(message.tabId)
          }
        }
        sendResponse({ ok: true })
        return false
      }

      case 'CAPTURE_KEEPALIVE': {
        // Receiving this message resets the MV3 service-worker idle timer, which
        // is what keeps the background alive through long silent stretches.
        const s = sessions.get(message.tabId)
        // Only finish an in-flight start. Reviving any non-running state would
        // resurrect a session the user already stopped.
        if (s && s.state === 'starting' && s.generation === message.generation) {
          s.state = 'running'
          pushSession(message.tabId)
        }
        sendResponse({ ok: true })
        return false
      }

      case 'CAPTURE_ENDED': {
        // The captured audio track ended (tab audio stopped, close button in
        // Chrome's sharing bar, device change...). Reflect reality instead of
        // leaving the toolbar stuck on "recording".
        const s = sessions.get(message.tabId)
        if (s && s.generation === message.generation && (s.state === 'running' || s.state === 'starting')) {
          s.state = 'idle'
          s.streamId = ''
          s.configSnapshot = null
          s.streamingSubtitle = null
          s.audioSilent = false
          if (s.subtitles.length > 0) persistSessionHistory(message.tabId)
          pushSession(message.tabId)
          maybeCloseOffscreen()
        }
        sendResponse({ ok: true })
        return false
      }

      case 'CAPTURE_SUBTITLE_STREAMING': {
        const s = sessions.get(message.tabId)
        if (!s || s.generation !== message.generation) {
          // Stale streaming update — ignore
          return false
        }
        // A session that is no longer running must not keep painting subtitles.
        // Previously a stray tab-lifecycle stop left the offscreen capture
        // alive, so subtitles kept streaming into a "stopped" toolbar.
        if (s.state !== 'running' && s.state !== 'starting') {
          return false
        }

        // Empty content means an explicit clear (e.g. the segment errored).
        // Only apply it if it targets the currently streaming segment, so a
        // failed older segment can't clobber a newer segment still streaming.
        if (!message.source && !message.partialTarget) {
          if (!s.streamingSubtitle || s.streamingSubtitle.at === message.at) {
            s.streamingSubtitle = null
          }
        } else {
          // Update the streaming subtitle in-place (not pushed to subtitles[] yet)
          s.streamingSubtitle = {
            at: message.at || Date.now(),
            source: message.source || '',
            partialTarget: message.partialTarget || '',
            latency: message.latency || 0,
          }
        }

        // Forward to content script via lightweight message
        pushStreamingUpdate(message.tabId)
        return false
      }

      case 'CAPTURE_SUBTITLE': {
        const s = sessions.get(message.tabId)
        if (!s || s.generation !== message.generation) {
          // Stale result – ignore
          return false
        }

        // Clear streaming state only if the final subtitle belongs to the
        // currently streaming segment. If a NEWER segment is already streaming
        // (overlapping in-flight segments), leave it visible so it never
        // "disappears for a second" while waiting for its own final.
        if (s.streamingSubtitle && s.streamingSubtitle.at === (message.at || Date.now())) {
          s.streamingSubtitle = null
        }

        s.subtitles.push({
          id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          at: message.at || Date.now(),
          endedAt: message.endedAt || null,
          source: message.source || '',
          target: message.target || '',
          latency: message.latency || 0,
        })

        // Keep subtitle history bounded
        if (s.subtitles.length > 200) {
          s.subtitles = s.subtitles.slice(-150)
        }

        pushSession(message.tabId)
        return false
      }

      case 'CAPTURE_ERROR': {
        const s = sessions.get(message.tabId)
        if (!s || s.generation !== message.generation) return false

        s.state = 'error'
        s.streamingSubtitle = null
        pushStreamingUpdate(message.tabId)
        pushSession(message.tabId)
        return false
      }

      case 'ASK_RESULT': {
        // This is handled in the main message router via the async response
        return false
      }
    }

    return false
  })
}

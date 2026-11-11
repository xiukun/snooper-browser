import { drainSource, findSourceSession, failSourceBinding } from '../source-sessions'
/**
 * Offscreen → background events.
 *
 * Second `onMessage` listener: only messages whose sender URL is the offscreen
 * document are accepted. It stays separate from the main router so the two
 * listeners keep their original sender validation and ordering.
 */

import { OFFSCREEN_PATH } from '../offscreen'
import {
  LIVE_SUBTITLE_WINDOW,
  waitForRecovery,
  saveSessionSubtitle,
  finishSessionTranscript,
  maybeCloseOffscreen,
  pushSession,
  pushStreamingUpdate,
  sessions,
  type SubtitleEntry,
} from '../session-store'
import { resolveVideoTimeAt } from '../video-clock'
import { insertByStart } from '../../../lib/subtitle-order'
import { shouldYieldAudio } from '../../../lib/screen-caption'

/**
 * The last line of an explicit stop arrives after the background has already
 * moved on to the next generation. It belongs to this session only while the
 * teardown is in progress.
 */
function isStoppingGeneration(
  s: { state: string; stoppedGeneration?: number },
  generation: number,
): boolean {
  return s.state === 'stopping' && s.stoppedGeneration === generation
}

export function registerOffscreenEventRouter(): void {
  chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    // Only process messages FROM offscreen
    if (sender.url !== chrome.runtime.getURL(OFFSCREEN_PATH)) {
      return false
    }

    void waitForRecovery().then(() => {
      if (handleEvent(message, sendResponse) !== true) sendResponse({ ok: true })
    }).catch(error => sendResponse({ ok: false, error: error.message }))
    return true
  })
}

function handleEvent(message: any, sendResponse: any): boolean {
  switch (message.type) {
    case 'CAPTURE_SOURCE_DRAINED': {
      const s = sessions.get(message.tabId)
      if (!s || (s.generation !== message.generation && !isStoppingGeneration(s, message.generation))) return false
      void drainSource(s, message.sourceEpoch).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }))
      return true
    }
    case 'CAPTURE_AUDIO_STATE': {
      // Offscreen tells us when the tab goes quiet (paused video, muted, or a
      // silent stretch). The UI uses this to say "no audio" instead of looking
      // like it is translating something invisible.
      const s = sessions.get(message.tabId)
      if (s && s.generation === message.generation && (!s.sourceEpoch || s.sourceEpoch === message.sourceEpoch)) {
        const next = !!message.silent
        if (s.audioSilent !== next) {
          s.audioSilent = next
          pushSession(message.tabId)
        }
      }
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
        s.screenCaption = 'off'
        s.screenCaptionError = ''
        // The track ended outside the STOP path. Finalize the full record
        // so a crashed or externally-ended capture still reaches history.
        if (s.transcriptId || s.subtitles.length > 0) {
          void finishSessionTranscript(s).catch(() => {})
        }
        pushSession(message.tabId)
        maybeCloseOffscreen()
      }
      return false
    }

    case 'CAPTURE_SUBTITLE_STREAMING': {
      const s = sessions.get(message.tabId)
      if (!s || s.generation !== message.generation || (s.sourceEpoch && s.sourceEpoch !== message.sourceEpoch)) {
        // Stale streaming update — ignore
        return false
      }
      // A session that is no longer running must not keep painting subtitles.
      // Previously a stray tab-lifecycle stop left the offscreen capture
      // alive, so subtitles kept streaming into a "stopped" toolbar.
      if (s.state !== 'running' && s.state !== 'starting') {
        return false
      }
      // ADR-043: a fresh screen line owns the overlay; do not paint a
      // partial speech line on top of it.
      if (shouldYieldAudio(s.lastScreenAt, Date.now())) {
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
      const active = sessions.get(message.tabId)
      if (active && active.state !== 'running' && active.state !== 'starting' && active.state !== 'stopping') return false
      const s = active ? findSourceSession(active, message.sourceEpoch) : undefined
      if (active && !s && active.generation === message.generation) { void failSourceBinding(active); return false }
      if (!s || (s.generation !== message.generation && !isStoppingGeneration(active!, message.generation))) {
        // Stale result – ignore unless it is the final line of the capture
        // the user just stopped (ADR-031 tail drain).
        return false
      }
      if (s.state !== 'running' && s.state !== 'starting' && s.state !== 'stopping') return false
      // ADR-043: burned-in subtitles win while they are fresh. The audio
      // line is dropped, not queued: a delayed duplicate adds nothing.
      if (s === active && shouldYieldAudio(s.lastScreenAt, Date.now())) {
        return false
      }
      const tail = s !== active || active.generation !== message.generation
      // The segment's start, not its arrival: mapping arrival time would
      // shift every line by the ASR/translation latency (ADR-033).
      const at = message.at || Date.now()

      // Clear streaming state only if the final subtitle belongs to the
      // currently streaming segment. If a NEWER segment is already streaming
      // (overlapping in-flight segments), leave it visible so it never
      // "disappears for a second" while waiting for its own final.
      if (s.streamingSubtitle && s.streamingSubtitle.at === at) {
        s.streamingSubtitle = null
      }

      const entry: SubtitleEntry = {
        id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        at,
        endedAt: message.endedAt || null,
        videoTime: resolveVideoTimeAt(message.tabId, at, s.sourceEpoch),
        sourceRef: s.sourceRef,
        source: message.source || '',
        target: message.target || '',
        latency: message.latency || 0,
      }
      // ADR-038: in-flight segments may complete out of order. Insert by
      // segment start so the overlay and export read chronologically.
      insertByStart(s.subtitles, entry)

      // Keep the live window bounded for rendering. The full session is
      // appended to transcript-store and is never truncated.
      if (s.subtitles.length > LIVE_SUBTITLE_WINDOW) {
        s.subtitles = s.subtitles.slice(-LIVE_SUBTITLE_WINDOW)
      }

      saveSessionSubtitle(s, entry)

      // A tail line is not pushed: the panel already shows the stopped
      // state and must not flash back to "recording" for its last row.
      if (!tail) pushSession(message.tabId)
      return false
    }

    case 'CAPTURE_SCREEN_SUBTITLE': {
      const active = sessions.get(message.tabId)
      if (active && active.state !== 'running' && active.state !== 'starting' && active.state !== 'stopping') return false
      const s = active ? findSourceSession(active, message.sourceEpoch) : undefined
      if (active && !s && active.generation === message.generation) { void failSourceBinding(active); return false }
      if (!s || s.generation !== message.generation) return false
      if (s.state !== 'running' && s.state !== 'starting') return false

      // Any screen result — including "no text" and a repeat of the same
      // line — refreshes the yield window: the strip is still on screen.
      s.lastScreenAt = Date.now()
      s.streamingSubtitle = null
      if (!message.source || message.duplicate) {
        if (s === active) pushStreamingUpdate(message.tabId)
        return false
      }

      const at = message.at || Date.now()
      const entry: SubtitleEntry = {
        id: `scr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        at,
        endedAt: null,
        videoTime: resolveVideoTimeAt(message.tabId, at, s.sourceEpoch),
        sourceRef: s.sourceRef,
        source: message.source || '',
        target: message.target || '',
        latency: message.latency || 0,
        kind: 'screen',
      }
      insertByStart(s.subtitles, entry)
      if (s.subtitles.length > LIVE_SUBTITLE_WINDOW) {
        s.subtitles = s.subtitles.slice(-LIVE_SUBTITLE_WINDOW)
      }
      saveSessionSubtitle(s, entry)
      if (s === active) pushSession(message.tabId)
      return false
    }

    case 'CAPTURE_SCREEN_STATUS': {
      const s = sessions.get(message.tabId)
      if (!s || s.generation !== message.generation) return false
      s.screenCaption = message.status === 'active'
        ? 'on'
        : message.status === 'error'
          ? 'error'
          : 'off'
      s.screenCaptionError = message.error || ''
      pushSession(message.tabId)
      return false
    }

    case 'CAPTURE_ERROR': {
      const s = sessions.get(message.tabId)
      if (!s || s.generation !== message.generation || (message.sourceEpoch && s.sourceEpoch !== message.sourceEpoch)) return false

      s.state = 'error'
      s.streamingSubtitle = null
      // The capture is over; keep whatever was recorded before the error.
      if (s.transcriptId || s.subtitles.length > 0) {
        void finishSessionTranscript(s).catch(() => {})
      }
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
}

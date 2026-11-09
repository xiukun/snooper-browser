/**
 * Recover sessions after a service-worker restart.
 *
 * The offscreen document outlives the worker, so recovery asks it which
 * captures are still alive instead of assuming they are gone. Treating a live
 * capture as gone left the toolbar saying "stopped" and blocked the next START
 * with "active stream".
 */

import { hasOffscreenDocument } from './offscreen'
import {
  pushSession,
  SESSION_RECOVERY_KEY,
  sessions,
  type SessionState,
} from './session-store'

export async function recoverSessions(): Promise<void> {
  try {
    const result = await chrome.storage.session.get(SESSION_RECOVERY_KEY)
    if (!result[SESSION_RECOVERY_KEY]) return

    const recovered = JSON.parse(result[SESSION_RECOVERY_KEY])

    let liveGenerations: Record<string, number> = {}
    if (await hasOffscreenDocument()) {
      try {
        const live: any = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'GET_CAPTURE_SESSIONS',
        })
        if (live?.ok && live.sessions && typeof live.sessions === 'object') {
          liveGenerations = live.sessions
        }
      } catch {
        // Offscreen may be mid-shutdown; treat as no live captures.
      }
    }

    for (const [tabIdStr, stored] of Object.entries(recovered)) {
      const tabId = Number(tabIdStr)
      const s = stored as SessionState
      const liveGeneration = liveGenerations[String(tabId)]

      if (typeof liveGeneration === 'number') {
        // Capture survived: keep the session running so STOP still reaches it
        // and the content script shows the correct recording state.
        s.state = 'running'
        s.generation = liveGeneration
        s.streamId = ''
      } else if (s.state === 'running' || s.state === 'starting' || s.state === 'stopping') {
        s.state = 'idle'
        s.streamId = ''
        s.configSnapshot = null
        s.streamingSubtitle = null
      }
      sessions.set(tabId, s)
      pushSession(tabId)
    }
  } catch {
    // ignore
  }
}

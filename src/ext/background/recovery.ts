/**
 * Recover sessions after a service-worker restart.
 *
 * The offscreen document outlives the worker, so recovery asks it which
 * captures are still alive instead of assuming they are gone. Treating a live
 * capture as gone left the toolbar saying "stopped" and blocked the next START
 * with "active stream".
 *
 * Transcript recovery runs unconditionally (ADR-031): a `recording` record
 * with no live capture is finalized so a browser crash still leaves the
 * persisted prefix in history.
 */

import { hasOffscreenDocument } from './offscreen'
import {
  pushSession,
  SESSION_RECOVERY_KEY,
  sessions,
  type SessionState,
} from './session-store'
import { recoverTranscripts } from './transcript-store'

async function readLiveGenerations(): Promise<Record<string, number>> {
  if (!(await hasOffscreenDocument())) return {}
  try {
    const live: any = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'GET_CAPTURE_SESSIONS',
    })
    if (live?.ok && live.sessions && typeof live.sessions === 'object') {
      return live.sessions
    }
  } catch {
    // Offscreen may be mid-shutdown; treat as no live captures.
  }
  return {}
}

export async function recoverSessions(): Promise<void> {
  try {
    const liveGenerations = await readLiveGenerations()
    // Finalize orphaned recordings even when the session snapshot is gone.
    const liveTranscripts = await recoverTranscripts(liveGenerations)

    const result = await chrome.storage.session.get(SESSION_RECOVERY_KEY)
    if (!result[SESSION_RECOVERY_KEY]) return

    const recovered = JSON.parse(result[SESSION_RECOVERY_KEY])

    for (const [tabIdStr, stored] of Object.entries(recovered)) {
      const tabId = Number(tabIdStr)
      const s = stored as SessionState
      const liveGeneration = liveGenerations[String(tabId)]
      const liveTranscriptId = liveTranscripts.get(tabId) || null

      if (typeof liveGeneration === 'number') {
        // Capture survived: keep the session running so STOP still reaches it
        // and the content script shows the correct recording state.
        s.state = 'running'
        s.generation = liveGeneration
        s.stoppedGeneration = undefined
        s.streamId = ''
        s.transcriptId = liveTranscriptId
      } else if (s.state === 'running' || s.state === 'starting' || s.state === 'stopping') {
        // A `stopping` session without a live capture was mid-teardown when
        // the worker died: the record is already finalized by
        // recoverTranscripts, so only the session state needs repairing.
        s.state = 'idle'
        s.stoppedGeneration = undefined
        s.streamId = ''
        s.configSnapshot = null
        s.streamingSubtitle = null
        s.transcriptId = null
      } else if (liveTranscriptId) {
        s.transcriptId = liveTranscriptId
      }
      sessions.set(tabId, s)
      pushSession(tabId)
    }
  } catch {
    // ignore
  }
}

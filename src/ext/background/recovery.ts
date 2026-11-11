import { recoverLibraryDeletions, reconcileDeletedTranscriptOwners } from './library-store'
import { drainSource, failSourceBinding } from './source-sessions'
import { getTranscriptRecord } from './transcript-store'
import { allSourceSessions, validateSessionTranscriptOwnership } from './session-store'
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
  createSession,
  markTranscriptSaveError,
  SESSION_RECOVERY_KEY,
  sessions,
  type SessionState,
} from './session-store'
import { recoverTranscripts } from './transcript-store'

async function readLiveCapture(): Promise<{ sessions: Record<string, number>; sources?: Record<string, { sourceEpoch?: string; bindings?: Record<string, { sourceRef?: { key: string }; pending: number }> }> }> {
  if (!(await hasOffscreenDocument())) return { sessions: {} }
  try {
    const live: any = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'GET_CAPTURE_SESSIONS',
    })
    if (live?.ok && live.sessions && typeof live.sessions === 'object') {
      return live
    }
  } catch {
    // Offscreen may be mid-shutdown; treat as no live captures.
  }
  return { sessions: {} }
}

export async function recoverSessions(): Promise<void> {
  // Keep failed authorized operations visible; session rescue must still run.
  await recoverLibraryDeletions().catch(error => console.warn('[RTTS] library deletion recovery pending:', error))
  try {
    const live = await readLiveCapture()
    const liveGenerations = live.sessions
    const result = await chrome.storage.session.get(SESSION_RECOVERY_KEY)
    const recovered = result[SESSION_RECOVERY_KEY] ? JSON.parse(result[SESSION_RECOVERY_KEY]) : {}
    const recoveryGenerations = { ...liveGenerations }
    for (const [tab, stored] of Object.entries(recovered)) {
      const s = stored as SessionState
      // Older snapshots used stoppedGeneration for this intent. Keep it
      // independently of the presentation state restored from live capture.
      if (s.transcriptFinalizationPending) s.pendingCaptureStopGeneration ??= s.stoppedGeneration
      // Failed rows in the recovery snapshot must be replayed BEFORE closing
      // their recording; otherwise retry would look like a late append.
      if (s.pendingCaptureStopGeneration !== undefined || allSourceSessions(s).some(epoch => epoch.pendingTranscriptLines?.length)) recoveryGenerations[tab] = s.pendingCaptureStopGeneration ?? s.stoppedGeneration ?? s.generation
    }
    let recoveryError: unknown
    const liveTranscripts = await recoverTranscripts(recoveryGenerations, Object.values(recovered).flatMap(stored => {
      const s = stored as SessionState
      return allSourceSessions(s).flatMap(epoch => (s.pendingCaptureStopGeneration !== undefined || epoch.pendingTranscriptLines?.length) && epoch.transcriptId ? [epoch.transcriptId] : [])
    })).catch(error => { recoveryError = error; return new Map<number, string>() })

    // Any strict deletion reconciliation snapshot must include every owner,
    // including tabs not yet visited by the validation loop below.
    for (const [tab, stored] of Object.entries(recovered)) sessions.set(Number(tab), stored as SessionState)
    for (const [tabIdStr, stored] of Object.entries(recovered)) {
      const tabId = Number(tabIdStr)
      const s = stored as SessionState
      const liveGeneration = liveGenerations[String(tabId)]
      const liveTranscriptId = liveTranscripts.get(tabId) || null

      if (typeof liveGeneration === 'number') {
        if (s.transcriptFinalizationPending) s.pendingCaptureStopGeneration ??= liveGeneration
        // Capture survived: keep the session running so STOP still reaches it
        // and the content script shows the correct recording state.
        s.state = 'running'
        s.generation = liveGeneration
        s.stoppedGeneration = undefined
        s.streamId = ''
        if (!s.sourceEpoch) s.transcriptId = liveTranscriptId || s.transcriptId
      } else if (s.state === 'running' || s.state === 'starting' || s.state === 'stopping') {
        // A `stopping` session without a live capture was mid-teardown when
        // the worker died: the record is already finalized by
        // recoverTranscripts, so only the session state needs repairing.
        s.state = 'idle'
        s.stoppedGeneration = undefined
        s.streamId = ''
        s.configSnapshot = null
        s.streamingSubtitle = null
        if (!s.sourceEpoch && !recoveryError && !s.pendingTranscriptLines?.length) s.transcriptId = null
      } else if (!s.sourceEpoch && liveTranscriptId) {
        s.transcriptId = liveTranscriptId
      }
      s.pendingTranscriptLines ||= []
      s.saveState ||= { status: 'saved' }
      sessions.set(tabId, s)
      await reconcileDeletedTranscriptOwners(s).catch(error => markTranscriptSaveError(s, error))
      if (recoveryError) markTranscriptSaveError(s, recoveryError)
      else if (s.pendingCaptureStopGeneration !== undefined) markTranscriptSaveError(s, '上次停止采集未确认')
      else if (allSourceSessions(s).some(epoch => epoch.pendingTranscriptLines?.length)) markTranscriptSaveError(s, '上次保存中断')
      // The tab-level map is only a legacy fallback. Scoped owners retain and
      // validate their own IDs, including stopped captures with several queues.
      for (const owner of allSourceSessions(s)) {
        await validateSessionTranscriptOwnership(owner).catch(error => markTranscriptSaveError(owner, error))
      }
      if (typeof liveGeneration === 'number' && !s.sourceEpoch) await failSourceBinding(s)
      if (typeof liveGeneration === 'number' && s.sourceEpoch) {
        const provenance = live.sources?.[tabIdStr]
        let valid = provenance?.sourceEpoch === s.sourceEpoch && s.generation === liveGeneration
        for (const [epoch, binding] of Object.entries(provenance?.bindings || {})) {
          const owner = allSourceSessions(s).find(item => item.sourceEpoch === epoch)
          const record = owner?.transcriptId ? await getTranscriptRecord(owner.transcriptId) : null
          if (!owner || !record || record.sourceEpoch !== epoch || record.generation !== liveGeneration || record.sourceRef?.key !== binding.sourceRef?.key || owner.sourceRef?.key !== binding.sourceRef?.key || ((binding.pending > 0 || epoch === s.sourceEpoch) && record.status !== 'recording')) valid = false
        }
        if (!provenance?.bindings?.[s.sourceEpoch]) valid = false
        if (!valid) await failSourceBinding(s)
        else if (s.pendingCaptureStopGeneration === undefined) {
          for (const epoch of s.retiringSources || []) {
            if (epoch.sourceEpoch && provenance?.bindings?.[epoch.sourceEpoch]?.pending === 0) await drainSource(s, epoch.sourceEpoch).catch(error => markTranscriptSaveError(epoch, error))
          }
        }
      }
      pushSession(tabId)
    }
    // A surviving capture without a durable owner is not permission to guess a lesson.
    for (const tab of Object.keys(liveGenerations)) {
      if (sessions.has(Number(tab))) continue
      const orphan = createSession(Number(tab))
      orphan.generation = liveGenerations[tab]!
      await failSourceBinding(orphan)
    }
  } catch (error) {
    console.warn('[RTTS] session recovery failed:', error)
  }
}

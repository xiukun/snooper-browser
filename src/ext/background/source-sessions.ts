import { resetSourceVideoClock } from './video-clock'
/** Lesson epochs share a capture stream, but never a transcript or save queue. */
import type { SourceRef } from '../../lib/knowledge-types'
import { sourceRefForUrl, videoKeyForUrl } from '../../lib/video-key'
import { runKeyedTask } from '../../lib/keyed-task'
import { ensureTranscript } from './transcript-store'
import { sendToOffscreen } from './offscreen'
import { allSourceSessions, finishSessionTranscript, markTranscriptSaveError, persistSessionsStrict, pushSession, sessions, type SessionState } from './session-store'

const transitions = new Map<number, Promise<unknown>>()

export function bindInitialSource(s: SessionState, url: string, title: string): void {
  s.sourceEpoch = crypto.randomUUID()
  s.sourceIdentity = videoKeyForUrl(url)
  s.sourceRef = sourceRefForUrl(url, title, s.sourceEpoch)
  s.retiringSources = []
}

export function findSourceSession(s: SessionState, epoch: unknown): SessionState | undefined {
  // Historical records remain readable; live writes always require provenance.
  if (typeof epoch !== 'string') return undefined
  return allSourceSessions(s).find(item => item.sourceEpoch === epoch && !item.sourceDrained)
}

export async function failSourceBinding(s: SessionState): Promise<void> {
  s.state = 'error'
  s.streamingSubtitle = null
  markTranscriptSaveError(s, '课节来源无法核验，已停止采集。请重新开始录音')
  await sendToOffscreen({ type: 'STOP_CAPTURE', tabId: s.tabId, generation: s.generation }).catch(() => {})
}

/** Snapshot the new binding before offscreen can start requests for it. */
export function transitionSource(tabId: number, source: SourceRef): Promise<SessionState | undefined> {
  return runKeyedTask(transitions, tabId, 'queue', async () => {
    const previous = sessions.get(tabId)
    if (!previous || previous.state !== 'running') return previous
    const identity = videoKeyForUrl(source.url)
    if (previous.sourceIdentity === identity) return previous
    if (!previous.sourceEpoch || !previous.sourceRef) {
      await failSourceBinding(previous)
      throw new Error('缺少旧课节绑定，请重新开始录音')
    }
    const generation = previous.generation
    const previousSourceEpoch = previous.sourceEpoch
    const sourceEpoch = crypto.randomUUID()
    const ownsTransition = (owner: SessionState, epoch: string): boolean =>
      sessions.get(tabId) === owner && owner.state === 'running' && owner.generation === generation && owner.sourceEpoch === epoch
    const next: SessionState = {
      ...previous,
      sourceEpoch,
      sourceIdentity: identity,
      sourceRef: sourceRefForUrl(source.url, source.title, sourceEpoch),
      sourceDrained: false,
      retiringSources: [...(previous.retiringSources || []), previous],
      transcriptId: null,
      subtitles: [],
      pendingTranscriptLines: [],
      streamingSubtitle: null,
      saveState: { status: 'saved' },
      lastScreenAt: 0,
      messages: [],
      agentSessionId: null,
      chatSourceRef: undefined,
      pendingAskRequestId: null,
    }
    // Cancel any old answer publication into this tab after navigation.
    previous.pendingAskRequestId = null
    let installed = false
    try {
      const paused = await sendToOffscreen({ type: 'PREPARE_CAPTURE_SOURCE', tabId, generation, sourceEpoch: previousSourceEpoch })
      if (!ownsTransition(previous, previousSourceEpoch)) return sessions.get(tabId)
      if (!paused?.ok) throw new Error(paused?.error || '无法暂停课节边界采集')
      await ensureTranscript(next)
      if (!ownsTransition(previous, previousSourceEpoch)) {
        await finishSessionTranscript({ ...next, retiringSources: [] })
        return sessions.get(tabId)
      }
      previous.retiringSources = []
      sessions.set(tabId, next)
      installed = true
      await persistSessionsStrict()
      if (!ownsTransition(next, sourceEpoch)) return sessions.get(tabId)
      const reply = await sendToOffscreen({ type: 'SET_CAPTURE_SOURCE', tabId, generation, previousSourceEpoch, sourceEpoch, sourceRef: next.sourceRef })
      if (!ownsTransition(next, sourceEpoch)) return sessions.get(tabId)
      if (!reply?.ok) throw new Error(reply?.error || '课节切换未确认')
      pushSession(tabId)
      return next
    } catch (error) {
      // STOP/supersession owns its final state, even if a pending write or
      // offscreen response fails after cancellation.
      if (!ownsTransition(installed ? next : previous, installed ? sourceEpoch : previousSourceEpoch)) return sessions.get(tabId)
      // Both bindings remain rescueable; never resume on an uncertain source.
      sessions.set(tabId, next)
      markTranscriptSaveError(next, error)
      await failSourceBinding(next)
      throw error
    }
  })
}

/** The offscreen counter reaches zero only after its last final event is delivered. */
export async function drainSource(s: SessionState, sourceEpoch: unknown): Promise<void> {
  const retired = (s.retiringSources || []).find(item => item.sourceEpoch === sourceEpoch)
  if (!retired) return
  retired.sourceDrained = true
  await finishSessionTranscript(retired)
  // Keep failed buffers until explicit retry; durable epochs need no live display window.
  if (retired.sourceEpoch) resetSourceVideoClock(s.tabId, retired.sourceEpoch)
  retired.subtitles = []
  retired.messages = []
  retired.configSnapshot = null
  retired.streamId = ''
  await persistSessionsStrict()
  pushSession(s.tabId)
}

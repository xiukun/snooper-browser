import type { SaveState, SourceRef } from '../../lib/knowledge-types'
import { appendTranscriptLine, ensureTranscript, finalizeSessionTranscript, flushTranscript, getTranscriptRecord, readTranscript } from './transcript-store'
import { sendToOffscreen } from './offscreen'
/**
 * Background session store.
 *
 * One SessionState per tab. All reads wait for service-worker recovery, so a
 * restart cannot expose a transient idle session while storage is hydrating.
 */

import type { AppConfig } from '../../lib/providers'
import { reconcileSessionWithCapture } from '../session-state'
import { closeOffscreenDocument, getLiveCaptureGeneration } from './offscreen'

export const SESSION_RECOVERY_KEY = 'snooper.extension.sessions.v1'

/**
 * The live subtitle array is a display window, not a storage boundary.
 * The full session lives in transcript-store (ADR-031).
 */
export const LIVE_SUBTITLE_WINDOW = 200

export interface SubtitleEntry {
  id: string
  sourceRef?: SourceRef
  at: number
  endedAt: number | null
  /** Video-timeline position (seconds) for `at`, or null when no page video. */
  videoTime: number | null
  source: string
  target: string
  latency: number
  /** ADR-043: burned-in screen text, not speech. */
  kind?: 'screen'
}

export interface MessageEntry {
  role: string
  content: string
  images?: string[]
}

export interface StreamingSubtitle {
  at: number
  source: string
  partialTarget: string
  latency: number
}

export interface SessionState {
  sourceEpoch?: string
  sourceRef?: SourceRef
  sourceIdentity?: string
  sourceDrained?: boolean
  retiringSources?: SessionState[]
  tabId: number
  state: 'idle' | 'starting' | 'running' | 'stopping' | 'error'
  sourceLang: string
  targetLang: string
  generation: number
  /**
   * Generation that is being torn down. A final subtitle for it is still
   * accepted while `state === 'stopping'` (ADR-031 tail drain).
   */
  stoppedGeneration?: number
  createdAt: number
  configSnapshot: AppConfig | null
  subtitles: SubtitleEntry[]
  messages: MessageEntry[]
  streamId: string
  pendingAskRequestId: string | null
  /** Active companion session for this tab's video (ADR-030). */
  chatSourceRef?: SourceRef
  agentSessionId: string | null
  /** Full transcript record for this capture (ADR-031). */
  transcriptId: string | null
  streamingSubtitle: StreamingSubtitle | null
  /** True when the capture is alive but no audio above the gate is arriving. */
  audioSilent: boolean
  /** ADR-043: wall-clock time of the last screen-caption line (0 = never). */
  lastScreenAt: number
  /** ADR-043: the user has the screen-caption channel on for this session. */
  screenCaption: 'off' | 'on' | 'error'
  screenCaptionError: string
  saveState: SaveState
  pendingTranscriptLines: SubtitleEntry[]
  /** Completion requested, but its durable record still needs finalization. */
  transcriptFinalizationPending?: boolean
  /** Durable teardown intent; only STOP acknowledgement clears this generation. */
  pendingCaptureStopGeneration?: number
}

export interface SafeSession {
  sourceEpoch?: string
  sourceRef?: SourceRef
  state: SessionState['state']
  sourceLang: string
  targetLang: string
  subtitles: SubtitleEntry[]
  messages: MessageEntry[]
  chatSourceRef?: SourceRef
  agentSessionId: string | null
  transcriptId: string | null
  streamingSubtitle: StreamingSubtitle | null
  audioSilent: boolean
  screenCaption: 'off' | 'on' | 'error'
  screenCaptionError: string
  saveState: SaveState
  pendingTranscriptCount: number
  /** Current displayed source only; aggregate saveState also includes retired sources. */
  currentTranscriptSaveState: SaveState
}

export const sessions = new Map<number, SessionState>()

// All session reads and writes wait for service-worker recovery. Without this
// barrier, a tab can ask for GET_SESSION while recoverSessions() is still
// hydrating and temporarily receive a fresh idle session.
let recoveryReady: Promise<void> = Promise.resolve()

export function waitForRecovery(): Promise<void> { return recoveryReady }

export function setRecoveryReady(promise: Promise<void>): void {
  recoveryReady = promise
}

// Seed with the clock so a restarted service worker never reuses a
// generation that a still-alive offscreen session already holds.
let generationCounter = Date.now()

export function nextGeneration(): number {
  return ++generationCounter
}

export function createSession(tabId: number): SessionState {
  const s: SessionState = {
    tabId,
    state: 'idle',
    sourceLang: 'auto',
    targetLang: 'zh',
    generation: 0,
    createdAt: Date.now(),
    configSnapshot: null,
    subtitles: [],
    messages: [],
    streamId: '',
    pendingAskRequestId: null,
    agentSessionId: null,
    transcriptId: null,
    streamingSubtitle: null,
    audioSilent: false,
    lastScreenAt: 0,
    screenCaption: 'off',
    screenCaptionError: '',
    saveState: { status: 'saved' },
    pendingTranscriptLines: [],
  }
  sessions.set(tabId, s)
  return s
}

export function getOrCreateSession(tabId: number): SessionState {
  let s = sessions.get(tabId)
  if (!s) {
    s = createSession(tabId)
  }
  return s
}

export async function reconcileSessionState(tabId: number): Promise<SessionState> {
  await recoveryReady
  const session = getOrCreateSession(tabId)
  const liveGeneration = await getLiveCaptureGeneration(tabId)
  if (session.transcriptFinalizationPending && session.pendingCaptureStopGeneration === undefined && typeof liveGeneration === 'number') {
    session.pendingCaptureStopGeneration = liveGeneration
    persistSessionsThrottled()
  }
  const reconciled = reconcileSessionWithCapture(session, liveGeneration as number | undefined)
  if (reconciled !== session) {
    Object.assign(session, reconciled)
    persistSessionsThrottled()
  }
  return session
}

export function safeSession(s: SessionState): SafeSession {
  return {
    sourceEpoch: s.sourceEpoch,
    sourceRef: s.sourceRef,
    state: s.state,
    sourceLang: s.sourceLang,
    targetLang: s.targetLang,
    subtitles: s.subtitles,
    messages: s.messages,
    chatSourceRef: s.chatSourceRef,
    agentSessionId: s.agentSessionId ?? null,
    transcriptId: s.transcriptId ?? null,
    streamingSubtitle: s.streamingSubtitle,
    audioSilent: s.audioSilent,
    screenCaption: s.screenCaption,
    screenCaptionError: s.screenCaptionError,
    saveState: allSourceSessions(s).find(epoch => epoch.saveState?.status === 'error')?.saveState || s.saveState || { status: 'saved' },
    currentTranscriptSaveState: s.saveState || { status: 'pending' },
    pendingTranscriptCount: allSourceSessions(s).reduce((sum, epoch) => sum + (epoch.pendingTranscriptLines?.length || 0), 0),
  }
}

export function hasActiveSession(): boolean {
  for (const s of sessions.values()) {
    // `stopping` still owns the offscreen document: closing it mid-teardown
    // can abort the tail drain and leave the native tab stream behind.
    if (s.state === 'running' || s.state === 'starting' || s.state === 'stopping') return true
  }
  return false
}

export function maybeCloseOffscreen(): void {
  if (hasActiveSession()) return
  closeOffscreenDocument().catch(() => {})
}

/* ===== Push to content script ===== */

export function pushSession(tabId: number): void {
  const s = sessions.get(tabId)
  if (!s) return

  chrome.tabs.sendMessage(tabId, {
    type: 'SESSION_UPDATE',
    session: safeSession(s),
  }).catch(() => {
    // Tab may have been closed or content script not loaded
  })

  persistSessionsThrottled()
}

/**
 * Send a lightweight streaming update to the content script.
 * This is separate from pushSession to avoid re-rendering all subtitles
 * on every SSE delta.
 */
export function pushStreamingUpdate(tabId: number): void {
  const s = sessions.get(tabId)
  if (!s) return

  chrome.tabs.sendMessage(tabId, {
    type: 'STREAMING_UPDATE',
    streamingSubtitle: s.streamingSubtitle, // null clears the streaming state
  }).catch(() => {
    // Tab may be closed; best-effort
  })
}

/* ===== Recovery snapshot ===== */

// Streaming updates fire often; keep the recovery snapshot fresh without
// writing to chrome.storage.session on every delta.
let lastPersistAt = 0
let snapshotWrite: Promise<void> = Promise.resolve()

export function persistSessionsThrottled(): void {
  const now = Date.now()
  if (now - lastPersistAt < 3000) return
  lastPersistAt = now
  persistSessions()
}

// Periodically persist sessions for recovery
export function persistSessions(): void {
  void persistSessionsStrict().catch(() => {})
}

export function persistSessionsStrict(): Promise<void> {
  const obj: Record<string, any> = {}
  for (const [tabId, s] of sessions.entries()) {
    obj[String(tabId)] = {
      sourceEpoch: s.sourceEpoch,
      sourceRef: s.sourceRef,
      sourceIdentity: s.sourceIdentity,
      retiringSources: s.retiringSources?.map(epoch => ({ ...epoch, retiringSources: undefined, configSnapshot: null, streamId: '' })),
      tabId: s.tabId,
      state: s.state,
      sourceLang: s.sourceLang,
      targetLang: s.targetLang,
      generation: s.generation,
      stoppedGeneration: s.stoppedGeneration,
      subtitles: s.subtitles,
      messages: s.messages,
      chatSourceRef: s.chatSourceRef,
      agentSessionId: s.agentSessionId ?? null,
      transcriptId: s.transcriptId ?? null,
      audioSilent: false,
      saveState: s.saveState,
      pendingTranscriptLines: s.pendingTranscriptLines,
      transcriptFinalizationPending: s.transcriptFinalizationPending,
      pendingCaptureStopGeneration: s.pendingCaptureStopGeneration,
    }
  }
  const encoded = JSON.stringify(obj)
  const write = snapshotWrite.catch(() => {}).then(() => chrome.storage.session.set({ [SESSION_RECOVERY_KEY]: encoded }))
  snapshotWrite = write
  return write
}

/** Capture stops with room for the offscreen pipeline's bounded tail. */
export const MAX_UNSAVED_SESSION_LINES = 180
const saveAttempts = new WeakMap<SessionState, Promise<void>>()
const finishAttempts = new WeakMap<SessionState, Promise<boolean>>()
const captureStops = new Map<number, { owner: SessionState; generation: number; promise: Promise<void> }>()
export function markTranscriptSaveError(s: SessionState, error: unknown): void {
  s.saveState = { status: 'error', message: `有内容未保存：${error instanceof Error ? error.message : String(error)}。请重试或导出，勿关闭页面` }
  pushSession(s.tabId)
  persistSessions()
}
export function allSourceSessions(s: SessionState): SessionState[] { return [...(s.retiringSources || []), s] }

/** Persisted with delete authorization, before the source body is removed. */
export interface DeletedTranscriptBinding {
  recordId: string
  tabId: number
  sourceEpoch: string
  sourceKey: string
}

export function detachDeletedTranscript(s: SessionState, binding: DeletedTranscriptBinding): boolean {
  let changed = false
  for (const owner of allSourceSessions(s)) {
    if (owner.transcriptId !== binding.recordId || owner.tabId !== binding.tabId || owner.sourceEpoch !== binding.sourceEpoch || owner.sourceRef?.key !== binding.sourceKey) continue
    if (owner.pendingCaptureStopGeneration !== undefined || owner.pendingTranscriptLines?.length || owner.saveState?.status !== 'saved' || saveAttempts.has(owner) || finishAttempts.has(owner)) continue
    const ended = owner.state === 'idle' || owner.state === 'error'
    if (owner === s ? !ended : !ended && !owner.sourceDrained) continue
    owner.transcriptId = null
    owner.sourceEpoch = undefined
    owner.sourceRef = undefined
    owner.sourceIdentity = undefined
    owner.subtitles = []
    owner.streamingSubtitle = null
    owner.transcriptFinalizationPending = false
    changed = true
  }
  return changed
}

export function pendingSessionStop(tabId: number): Promise<void> | undefined {
  return captureStops.get(tabId)?.promise
}

/** Explicit and bounded STOP share tail drain, ownership fencing and finalization. */
export function stopSessionCapture(s: SessionState): Promise<void> {
  const existing = captureStops.get(s.tabId)
  if (existing?.owner === s && existing.generation === s.generation) return existing.promise
  const stoppedGeneration = s.pendingCaptureStopGeneration ?? s.stoppedGeneration ?? s.generation
  s.pendingCaptureStopGeneration = stoppedGeneration
  s.state = 'stopping'
  s.stoppedGeneration = stoppedGeneration
  s.generation = nextGeneration()
  const generation = s.generation
  const ownsStop = (): boolean => sessions.get(s.tabId) === s && s.generation === generation
  s.transcriptFinalizationPending = true
  pushSession(s.tabId)
  const run = (async () => {
    try {
      const reply = await sendToOffscreen({ type: 'STOP_CAPTURE', tabId: s.tabId, generation: stoppedGeneration, drain: true })
      if (!ownsStop()) return
      if (!reply?.ok) throw new Error(reply?.error || '停止采集未确认，请重试')
      for (const owner of allSourceSessions(s)) {
        if (owner.pendingCaptureStopGeneration === stoppedGeneration) owner.pendingCaptureStopGeneration = undefined
      }
      s.state = 'idle'
      s.stoppedGeneration = undefined
      s.streamId = ''
      s.configSnapshot = null
      s.streamingSubtitle = null
      s.audioSilent = false
      await finishSavedTranscript(s)
    } catch (error) {
      if (!ownsStop()) return
      if (s.state === 'stopping') s.state = 'error'
      markTranscriptSaveError(s, error)
      throw error
    } finally {
      if (ownsStop()) {
        pushSession(s.tabId)
        persistSessions()
        if (s.state === 'idle') maybeCloseOffscreen()
      }
    }
  })()
  const attempt = { owner: s, generation, promise: run }
  captureStops.set(s.tabId, attempt)
  void run.finally(() => { if (captureStops.get(s.tabId) === attempt) captureStops.delete(s.tabId) }).catch(() => {})
  return run
}

/** A stopped generation changes, but its immutable epoch still owns exactly one record. */
export async function validateSessionTranscriptOwnership(s: SessionState): Promise<void> {
  if (!s.sourceEpoch || !s.transcriptId) return
  // Finalization may have removed an empty record. It has no body to reassign.
  if (!s.pendingTranscriptLines?.length && !s.subtitles?.length) return
  const record = await getTranscriptRecord(s.transcriptId)
  if (!record || record.tabId !== s.tabId || record.sourceEpoch !== s.sourceEpoch || !s.sourceRef || record.sourceRef?.key !== s.sourceRef.key) {
    throw new Error('转写课节绑定无法核验，未保存内容已保留，请导出后重新开始')
  }
  if (record.status === 'completed' && s.pendingTranscriptLines?.length) {
    const savedIds = new Set((await readTranscript(record.id)).map(line => line.id))
    if (s.pendingTranscriptLines.some(line => !savedIds.has(line.id))) {
      throw new Error('转写记录已结束但仍有未保存内容，请导出后重新开始')
    }
  }
}

export async function retrySessionTranscript(s: SessionState): Promise<void> {
  const stopping = captureStops.get(s.tabId)
  if (stopping?.owner === s && stopping.generation === s.generation) return stopping.promise
  if (s.pendingCaptureStopGeneration !== undefined) return stopSessionCapture(s)
  if (s.transcriptFinalizationPending) {
    await finishSessionTranscript(s)
    return
  }
  for (const epoch of s.retiringSources || []) {
    await retryOneTranscript(epoch)
    if (epoch.sourceDrained) await finalizeSessionTranscript(epoch).catch(error => { markTranscriptSaveError(epoch, error); throw error })
  }
  await retryOneTranscript(s)
}

function retryOneTranscript(s: SessionState): Promise<void> {
  const existing = saveAttempts.get(s)
  if (existing) return existing
  const run = (async () => {
    s.pendingTranscriptLines ||= []
    if (!s.transcriptId && !s.pendingTranscriptLines.length && !s.subtitles.length) return
    await validateSessionTranscriptOwnership(s)
    const id = await ensureTranscript(s)
    do {
      while (s.pendingTranscriptLines.length) {
        await appendTranscriptLine(id, s.pendingTranscriptLines[0]!)
        s.pendingTranscriptLines.shift()
      }
      await flushTranscript(id)
      // A row arriving during the awaited flush joins this same save attempt.
      // Drain it before publishing saved; no subsequent event is required.
    } while (s.pendingTranscriptLines.length)
    if (s.pendingCaptureStopGeneration === undefined) s.saveState = { status: 'saved' }
    pushSession(s.tabId)
    persistSessions()
  })().catch(error => { markTranscriptSaveError(s, error); throw error })
  saveAttempts.set(s, run)
  void run.finally(() => { if (saveAttempts.get(s) === run) saveAttempts.delete(s) }).catch(() => {})
  return run
}
export function saveSessionSubtitle(s: SessionState, entry: SubtitleEntry): void {
  s.pendingTranscriptLines ||= []
  if (!s.pendingTranscriptLines.some(line => line.id === entry.id)) s.pendingTranscriptLines.push(entry)
  if (s.saveState?.status !== 'error') s.saveState = { status: 'pending' }
  // Stop accepting NEW capture at the boundary, while retaining the bounded
  // already-produced tail. Never evict the oldest failed line.
  const owner = sessions.get(s.tabId) || s
  if (allSourceSessions(owner).reduce((sum, epoch) => sum + epoch.pendingTranscriptLines.length, 0) >= MAX_UNSAVED_SESSION_LINES && (owner.state === 'running' || owner.state === 'starting')) {
    markTranscriptSaveError(owner, '未保存缓存已满，已停止新采集')
    void stopSessionCapture(owner).catch(() => {})
  }
  void retryOneTranscript(s).catch(() => {})
}
export function finishSessionTranscript(s: SessionState): Promise<boolean> {
  const stopping = captureStops.get(s.tabId)
  if (stopping?.owner === s && stopping.generation === s.generation) return stopping.promise.then(() => !!s.transcriptId)
  if (s.pendingCaptureStopGeneration !== undefined) return stopSessionCapture(s).then(() => !!s.transcriptId)
  return finishSavedTranscript(s)
}

function finishSavedTranscript(s: SessionState): Promise<boolean> {
  const existing = finishAttempts.get(s)
  if (existing) return existing
  const generation = s.generation
  const transcriptId = s.transcriptId
  const unchanged = (): boolean => s.generation === generation && (!transcriptId || s.transcriptId === transcriptId)
  const run = (async () => {
    try {
      for (const epoch of s.retiringSources || []) {
        if (s.state === 'idle' || s.state === 'error' || epoch.sourceDrained) {
          epoch.sourceDrained = true
          await finishSessionTranscript(epoch)
          if (!unchanged()) return false
        }
      }
      // Await even an empty queue: its last flush may still be in flight. Use
      // the primitive save attempt here, never the public retry/STOP barrier.
      if (saveAttempts.has(s) || s.pendingTranscriptLines?.length) await retryOneTranscript(s)
      if (!unchanged()) return false
      await validateSessionTranscriptOwnership(s)
      if (!unchanged()) return false
      // The storage helper can await record creation/finalization. Give it a
      // stable owner so an obsolete continuation cannot rebind a newer one.
      const finalizing = { ...s }
      const finalizingId = s.transcriptId
      const kept = await finalizeSessionTranscript(finalizing)
      if (s.generation !== generation || s.transcriptId !== finalizingId) return false
      s.transcriptId = finalizing.transcriptId
      s.saveState = { status: 'saved' }
      s.transcriptFinalizationPending = false
      return kept
    } catch (error) {
      if (!unchanged()) return false
      s.transcriptFinalizationPending = true
      markTranscriptSaveError(s, error)
      throw error
    }
  })()
  finishAttempts.set(s, run)
  void run.finally(() => { if (finishAttempts.get(s) === run) finishAttempts.delete(s) }).catch(() => {})
  return run
}

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
export function markTranscriptSaveError(s: SessionState, error: unknown): void {
  s.saveState = { status: 'error', message: `有内容未保存：${error instanceof Error ? error.message : String(error)}。请重试或导出，勿关闭页面` }
  pushSession(s.tabId)
  persistSessions()
}
export function allSourceSessions(s: SessionState): SessionState[] { return [...(s.retiringSources || []), s] }

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
    s.saveState = { status: 'saved' }
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
    owner.state = 'stopping'
    owner.stoppedGeneration = owner.generation
    markTranscriptSaveError(owner, '未保存缓存已满，已停止新采集')
    void sendToOffscreen({ type: 'STOP_CAPTURE', tabId: s.tabId, generation: s.generation, drain: true })
      .catch(error => markTranscriptSaveError(s, error))
      .finally(() => { owner.state = 'idle'; owner.stoppedGeneration = undefined; pushSession(s.tabId); maybeCloseOffscreen() })
  }
  void retryOneTranscript(s).catch(() => {})
}
export async function finishSessionTranscript(s: SessionState): Promise<boolean> {
  try {
    for (const epoch of s.retiringSources || []) {
      if (s.state === 'idle' || s.state === 'error' || epoch.sourceDrained) {
        epoch.sourceDrained = true
        await finishSessionTranscript(epoch)
      }
    }
    if (s.pendingTranscriptLines?.length) await retrySessionTranscript(s)
    const kept = await finalizeSessionTranscript(s)
    s.saveState = { status: 'saved' }
    return kept
  } catch (error) {
    markTranscriptSaveError(s, error)
    throw error
  }
}

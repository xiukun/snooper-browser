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
  at: number
  endedAt: number | null
  source: string
  target: string
  latency: number
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
  agentSessionId: string | null
  /** Full transcript record for this capture (ADR-031). */
  transcriptId: string | null
  streamingSubtitle: StreamingSubtitle | null
  /** True when the capture is alive but no audio above the gate is arriving. */
  audioSilent: boolean
}

export interface SafeSession {
  state: SessionState['state']
  sourceLang: string
  targetLang: string
  subtitles: SubtitleEntry[]
  messages: MessageEntry[]
  agentSessionId: string | null
  transcriptId: string | null
  streamingSubtitle: StreamingSubtitle | null
  audioSilent: boolean
}

export const sessions = new Map<number, SessionState>()

// All session reads and writes wait for service-worker recovery. Without this
// barrier, a tab can ask for GET_SESSION while recoverSessions() is still
// hydrating and temporarily receive a fresh idle session.
let recoveryReady: Promise<void> = Promise.resolve()

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
    state: s.state,
    sourceLang: s.sourceLang,
    targetLang: s.targetLang,
    subtitles: s.subtitles,
    messages: s.messages,
    agentSessionId: s.agentSessionId ?? null,
    transcriptId: s.transcriptId ?? null,
    streamingSubtitle: s.streamingSubtitle,
    audioSilent: s.audioSilent,
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

export function persistSessionsThrottled(): void {
  const now = Date.now()
  if (now - lastPersistAt < 3000) return
  lastPersistAt = now
  persistSessions()
}

// Periodically persist sessions for recovery
export function persistSessions(): void {
  const obj: Record<string, any> = {}
  for (const [tabId, s] of sessions.entries()) {
    obj[String(tabId)] = {
      tabId: s.tabId,
      state: s.state,
      sourceLang: s.sourceLang,
      targetLang: s.targetLang,
      generation: s.generation,
      subtitles: s.subtitles,
      messages: s.messages,
      agentSessionId: s.agentSessionId ?? null,
      transcriptId: s.transcriptId ?? null,
      audioSilent: false,
    }
  }
  try {
    chrome.storage.session.set({ [SESSION_RECOVERY_KEY]: JSON.stringify(obj) })
  } catch {
    // session storage may be full
  }
}

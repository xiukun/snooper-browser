/**
 * RTTS Background Service Worker (MV3) — entry.
 *
 * Responsibilities:
 * 1. Session management – one independent session per tabId
 * 2. Message routing – content script ↔ background ↔ offscreen ↔ side panel
 * 3. Content script injection on action click
 * 4. Offscreen document lifecycle (single document, multi-session)
 * 5. Config persistence in chrome.storage.local (TRUSTED_CONTEXTS)
 * 6. Generation counter to reject stale results after stop / navigation / restart
 *
 * Implementation lives in ./background/*:
 *   config.ts        — DEFAULT_CONFIG, load/save + validation
 *   offscreen.ts     — document lifecycle and orphan recovery
 *   session-store.ts — per-tab state, recovery snapshot, pushes
 *   transcript-store.ts — durable chunked transcripts (ADR-031)
 *   llm.ts           — chat + vision Q&A
 *   obsidian.ts      — vault export/upload/test
 *   recovery.ts      — service-worker restart hydration
 *   lifecycle.ts     — tab/action/install listeners
 *   router/*         — grouped message handlers
 */

import { registerLifecycleListeners } from './background/lifecycle'
import { recoverSessions } from './background/recovery'
import { registerBackgroundRouters } from './background/router'
import { persistSessions, setRecoveryReady } from './background/session-store'

registerBackgroundRouters()
registerLifecycleListeners()

// Recover on startup. Message handlers wait for this promise before reading
// sessions, so a service-worker restart cannot publish a transient idle state.
setRecoveryReady(recoverSessions())

// Persist every 30 seconds
setInterval(persistSessions, 30000)

// Session changes persist through pushSession() itself (throttled), so a
// service-worker suspension never loses the recovery snapshot.

console.log('[RTTS] Background service worker (TS) initialized')

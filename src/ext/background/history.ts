/**
 * Session history in chrome.storage.local.
 *
 * A record is written when a capture stops or the tab navigates. History is
 * deliberately bounded and best-effort: losing one write must never block the
 * capture lifecycle.
 */

import { sessions } from './session-store'
import type { SubtitleEntry } from './session-store'

export const HISTORY_KEY = 'snooper.extension.history.v1'
const MAX_HISTORY = 100
/** Bounded per record so one marathon session cannot bloat storage writes. */
const MAX_SUBTITLES_PER_RECORD = 500

export interface HistoryEntry {
  id: string
  pageTitle: string
  url: string
  startedAt: number
  endedAt: number
  sourceLang: string
  targetLang: string
  subtitleCount: number
  subtitles?: Array<Pick<SubtitleEntry, 'at' | 'endedAt' | 'source' | 'target' | 'latency'>>
}

export async function persistSessionHistory(tabId: number): Promise<void> {
  const s = sessions.get(tabId)
  if (!s || !s.subtitles || s.subtitles.length === 0) return
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    const entry: HistoryEntry = {
      id: `h_${Date.now().toString(36)}_${tabId}`,
      pageTitle: tab?.title || '',
      url: tab?.url || '',
      startedAt: s.createdAt || Date.now(),
      endedAt: Date.now(),
      sourceLang: s.sourceLang || 'auto',
      targetLang: s.targetLang || 'zh',
      subtitleCount: s.subtitles.length,
      subtitles: s.subtitles.slice(-MAX_SUBTITLES_PER_RECORD).map(({ at, endedAt, source, target, latency }) => ({
        at,
        endedAt,
        source,
        target,
        latency,
      })),
    }
    const got = await chrome.storage.local.get(HISTORY_KEY)
    const history: HistoryEntry[] = Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : []
    history.unshift(entry)
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY
    await chrome.storage.local.set({ [HISTORY_KEY]: history })
  } catch { /* best-effort */ }
}

export async function readHistory(): Promise<HistoryEntry[]> {
  try {
    const got = await chrome.storage.local.get(HISTORY_KEY)
    return Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : []
  } catch { return [] }
}

export async function deleteHistoryEntries(ids: string[]): Promise<void> {
  try {
    const got = await chrome.storage.local.get(HISTORY_KEY)
    let history: HistoryEntry[] = Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : []
    const remove = new Set(ids)
    history = history.filter((h) => !remove.has(h.id))
    await chrome.storage.local.set({ [HISTORY_KEY]: history })
  } catch { /* ignore */ }
}

export async function clearHistory(): Promise<void> {
  try {
    await chrome.storage.local.set({ [HISTORY_KEY]: [] })
  } catch { /* ignore */ }
}

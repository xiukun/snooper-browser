/**
 * Per-tab video clock timeline (ADR-033).
 *
 * The content script posts `VIDEO_CLOCK` samples while a capture is active.
 * Subtitles are stamped with the wall clock at segment start by the offscreen
 * document, so the resolver can map that instant onto the page's playback
 * position. The buffer is intentionally in-memory: every line is annotated
 * within seconds of its segment starting, and a restarted worker re-anchors on
 * the next 1 Hz sample.
 */

import {
  resolveVideoTimeAt as resolveFromSamples,
  type VideoClockSample,
} from '../../lib/video-clock'

/** Five minutes at 1 Hz. Segments are at most 4 s and queue depth is 3. */
const MAX_SAMPLES = 300

const timelines = new Map<string, VideoClockSample[]>()

export function resetVideoClock(tabId: number): void {
  for (const key of timelines.keys()) if (key.startsWith(`${tabId}:`)) timelines.delete(key)
}

export function resetSourceVideoClock(tabId: number, sourceEpoch: string): void {
  timelines.delete(`${tabId}:${sourceEpoch}`)
}

/** Records are appended in wall-clock order; an equal timestamp replaces. */
export function recordVideoClock(tabId: number, sample: VideoClockSample, sourceEpoch = ''): void {
  const key = `${tabId}:${sourceEpoch}`
  const list = timelines.get(key)
  if (!list) {
    timelines.set(key, [sample])
    return
  }
  const last = list[list.length - 1]
  if (last && sample.at < last.at) return
  if (last && sample.at === last.at) list[list.length - 1] = sample
  else list.push(sample)
  if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES)
}

/** Seconds into the page's video for a wall-clock instant, or null. */
export function resolveVideoTimeAt(tabId: number, at: number, sourceEpoch = ''): number | null {
  const list = timelines.get(`${tabId}:${sourceEpoch}`)
  if (!list || list.length === 0) return null
  return resolveFromSamples(list, at)
}

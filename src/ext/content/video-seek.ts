/**
 * Click-to-seek (ADR-034).
 *
 * A subtitle's `videoTime` (ADR-033) is the study anchor; this module turns a
 * click on that anchor into a real seek. The target element is re-resolved on
 * every click — a page may swap its player between recording and the click —
 * and playback pauses while scrubbing so the user can read in place.
 */

import { findBestVideoCandidate } from '../screenshot'

/** Start slightly before the line so its first words are still audible. */
export const SEEK_LEAD_SECONDS = 0.25

export type SeekResult =
  | { ok: true; time: number }
  | { ok: false; reason: 'no-video' | 'no-progress' }

/**
 * ADR-037 (F5): a seek changes the mapping between wall clock and playback
 * position, so the next 1 Hz sample would otherwise interpolate across the
 * jump. content.ts registers the video clock here and gets a forced sample
 * after every successful seek.
 */
let afterSeekHook: (() => void) | null = null

export function onAfterSeek(hook: (() => void) | null): void {
  afterSeekHook = hook
}

export function seekTo(seconds: number): SeekResult {
  let video: HTMLVideoElement | null = null
  try {
    video = findBestVideoCandidate()?.video ?? null
  } catch {
    // A hostile page can make layout queries throw.
    video = null
  }
  if (!video) return { ok: false, reason: 'no-video' }

  const target = Math.max(0, (Number.isFinite(seconds) ? seconds : 0) - SEEK_LEAD_SECONDS)
  const before = video.currentTime
  try {
    // `fastSeek` snaps to a keyframe and can land seconds away; study
    // re-orientation needs the precise position.
    video.currentTime = target
  } catch {
    return { ok: false, reason: 'no-progress' }
  }
  if (Math.abs(video.currentTime - before) < 1e-6 && Math.abs(target - before) > 1e-6) {
    return { ok: false, reason: 'no-progress' }
  }
  video.pause()
  afterSeekHook?.()
  return { ok: true, time: video.currentTime }
}

/**
 * Video-timeline clock (ADR-033).
 *
 * Only the page knows `video.currentTime`; the offscreen capture knows when an
 * ASR segment started (`Date.now()`). Both contexts share the browser clock,
 * so a sampled (wall clock → playback position) timeline can be interpolated
 * for each subtitle without inventing precision.
 *
 * Pure functions live here so the resolver is testable without Chrome.
 */

export interface VideoClockSample {
  /** Wall clock when the page was sampled (epoch ms). */
  at: number
  /** `video.currentTime` at that moment, in seconds. */
  videoTime: number
  /** Playback was paused at sampling time. */
  paused: boolean
  /** Playback rate at sampling time, clamped to (0, 16]. */
  rate: number
}

export interface ResolveVideoTimeOptions {
  /** Extrapolation limit before/after the sampled range. */
  maxDistanceMs?: number
  /** A bracket wider than this is not interpolated (lost samples). */
  maxBracketMs?: number
  /** Minimum absolute disagreement treated as a seek / episode switch. */
  maxDriftSeconds?: number
}

const DEFAULT_MAX_DISTANCE_MS = 30_000
const DEFAULT_MAX_BRACKET_MS = 60_000
const DEFAULT_MAX_DRIFT_SECONDS = 2
const MAX_RATE = 16

/** Keep only sane samples: finite, non-negative, rate in (0, 16]. */
export function sanitizeVideoClockSample(raw: any): VideoClockSample | null {
  if (!raw || typeof raw !== 'object') return null
  const at = Number(raw.at)
  const videoTime = Number(raw.videoTime)
  const rate = Number(raw.rate)
  if (!Number.isFinite(at) || at <= 0) return null
  if (!Number.isFinite(videoTime) || videoTime < 0) return null
  return {
    at,
    videoTime,
    paused: raw.paused === true,
    rate: Number.isFinite(rate) && rate > 0 ? Math.min(rate, MAX_RATE) : 1,
  }
}

function roundSeconds(value: number): number {
  return Math.max(0, Math.round(value * 1000) / 1000)
}

/**
 * Map a wall-clock instant onto the video timeline.
 *
 * `samples` may arrive unsorted; the resolver sorts a copy. Returns `null`
 * when there is no sample close enough to make an honest claim.
 */
export function resolveVideoTimeAt(
  samples: readonly VideoClockSample[],
  at: number,
  options: ResolveVideoTimeOptions = {},
): number | null {
  if (!Array.isArray(samples) || samples.length === 0) return null
  if (!Number.isFinite(at) || at <= 0) return null

  const maxDistanceMs = options.maxDistanceMs ?? DEFAULT_MAX_DISTANCE_MS
  const maxBracketMs = options.maxBracketMs ?? DEFAULT_MAX_BRACKET_MS
  const maxDriftSeconds = options.maxDriftSeconds ?? DEFAULT_MAX_DRIFT_SECONDS

  const sorted = samples
    .filter((sample) => Number.isFinite(sample.at) && Number.isFinite(sample.videoTime))
    .slice()
    .sort((a, b) => a.at - b.at)
  if (sorted.length === 0) return null

  const extrapolate = (sample: VideoClockSample, deltaMs: number): number => {
    if (sample.paused) return sample.videoTime
    return sample.videoTime + (deltaMs / 1000) * sample.rate
  }

  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!

  if (at <= first.at) {
    const gap = first.at - at
    if (gap > maxDistanceMs) return null
    return roundSeconds(extrapolate(first, -gap))
  }
  if (at >= last.at) {
    const gap = at - last.at
    if (gap > maxDistanceMs) return null
    return roundSeconds(extrapolate(last, gap))
  }

  // First sample whose `at` is >= the requested instant.
  let lo = 0
  let hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]!.at < at) lo = mid + 1
    else hi = mid
  }
  const next = sorted[lo]!
  const prev = sorted[lo - 1]!
  const wallMs = next.at - prev.at

  if (wallMs <= 0) return roundSeconds(next.videoTime)
  if (wallMs > maxBracketMs) {
    const usePrev = at - prev.at <= next.at - at
    return roundSeconds(usePrev ? prev.videoTime : next.videoTime)
  }

  const expectedDelta = (wallMs / 1000) * ((prev.rate + next.rate) / 2)
  const actualDelta = next.videoTime - prev.videoTime
  const drift = Math.abs(actualDelta - expectedDelta)
  if (drift > Math.max(maxDriftSeconds, expectedDelta * 0.25)) {
    // A seek or episode switch happened inside this bracket. Interpolating
    // would fabricate a position that was never on screen.
    const usePrev = at - prev.at <= next.at - at
    return roundSeconds(usePrev ? prev.videoTime : next.videoTime)
  }

  const progress = (at - prev.at) / wallMs
  return roundSeconds(prev.videoTime + actualDelta * progress)
}

/** `mm:ss`, or `h:mm:ss` past an hour. Matches the digest's offset style. */
export function formatVideoTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mmss = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

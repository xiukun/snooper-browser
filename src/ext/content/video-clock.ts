/**
 * Content-side video clock (ADR-033).
 *
 * The offscreen capture stamps each ASR segment with the wall clock, but only
 * the page can read `video.currentTime`. Sampling the page every second — plus
 * media events — gives the background enough anchors to interpolate real video
 * time for every subtitle.
 *
 * Sampling only runs while the session is starting, running, or stopping. The
 * element is cached so a normal page is not walked every second; a SPA player
 * swap is picked up because `play` events are observed at the document level.
 */

import type { VideoClockSample } from '../../lib/video-clock'
import { findBestVideoCandidate } from '../screenshot'

export interface VideoClockDeps {
  /** Send one sample to the background. Failures are the caller's problem. */
  send: (sample: VideoClockSample) => void
  /** True while the capture session is starting, running, or stopping. */
  isActive: () => boolean
}

const SAMPLE_INTERVAL_MS = 1000
const EVENT_MIN_GAP_MS = 500
const RESOLVE_RETRY_MS = 10_000
const MEDIA_EVENTS = ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata', 'emptied'] as const

export function createVideoClock(deps: VideoClockDeps) {
  let timer: number | null = null
  let video: HTMLVideoElement | null = null
  let lastSentAt = 0
  let nextResolveAt = 0

  function resolveVideo(force = false): HTMLVideoElement | null {
    if (video && video.isConnected) return video
    video = null
    const now = Date.now()
    if (!force && now < nextResolveAt) return null
    nextResolveAt = now + RESOLVE_RETRY_MS
    try {
      video = findBestVideoCandidate()?.video ?? null
    } catch {
      // A hostile page can make layout queries throw.
      video = null
    }
    return video
  }

  function sample(force = false): void {
    if (!deps.isActive()) return
    const el = resolveVideo(force)
    if (!el) return
    const time = el.currentTime
    if (!Number.isFinite(time) || time < 0) return
    const now = Date.now()
    deps.send({
      at: now,
      videoTime: time,
      paused: el.paused === true,
      rate: Number.isFinite(el.playbackRate) && el.playbackRate > 0 ? el.playbackRate : 1,
    })
    lastSentAt = now
  }

  function onMediaEvent(event: Event): void {
    if (!deps.isActive()) return
    const target = event.target as HTMLVideoElement | null
    // A new player (ad, episode switch) may have taken over. Re-resolve
    // instead of trusting the event target: a tiny auto-playing ad must not
    // displace the main video.
    if (target && target.tagName === 'VIDEO' && event.type === 'play' && target !== video) {
      video = null
      nextResolveAt = 0
    }
    if (Date.now() - lastSentAt < EVENT_MIN_GAP_MS) return
    sample()
  }

  function start(): void {
    if (timer !== null) {
      sample()
      return
    }
    sample(true)
    timer = window.setInterval(() => sample(), SAMPLE_INTERVAL_MS)
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  /** Start or stop according to the session state; safe to call often. */
  function sync(): void {
    if (deps.isActive()) start()
    else stop()
  }

  // Media events do not bubble, but a capture-phase listener on the document
  // still sees them from any player in this document.
  for (const type of MEDIA_EVENTS) {
    document.addEventListener(type, onMediaEvent, true)
  }

  return { sync, start, stop, sample }
}

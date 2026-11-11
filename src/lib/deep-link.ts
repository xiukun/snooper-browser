/**
 * Video deep links (ADR-035).
 *
 * Turns a stored page URL plus a video-timeline anchor into a URL that opens
 * the video at that moment. Only sites with a documented seek parameter are
 * supported; everything else returns `null` so callers render plain text
 * instead of a link that pretends to seek. Pure functions only.
 */

import { youtubeId, bilibiliKey, bilibiliPart } from './video-key'

function floorSeconds(seconds: number): number {
  return Math.max(0, Math.floor(seconds))
}

/**
 * `https://www.bilibili.com/video/BV…?t=90` for Bilibili,
 * `https://www.youtube.com/watch?v=…&t=90s` for YouTube, otherwise `null`.
 * The seconds are floored — Bilibili expects whole seconds, YouTube accepts
 * the `s`-suffixed form that also disambiguates from legacy minute values.
 */
export function videoDeepLink(url: string | undefined | null, seconds: number): string | null {
  if (!url || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const t = floorSeconds(seconds)

  if (bilibiliKey(parsed)) {
    // The stored pathname already carries `/video/` or `/bangumi/play/`.
    const part = bilibiliPart(parsed)
    if (part === null) return null
    return `https://www.bilibili.com${parsed.pathname}?${parsed.searchParams.has('p') ? `p=${part}&` : ''}t=${t}`
  }

  const yt = youtubeId(parsed)
  if (yt) {
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return `https://youtu.be/${yt}?t=${t}s`
    if (parsed.pathname.startsWith('/shorts/')) return `https://www.youtube.com/shorts/${yt}?t=${t}s`
    return `https://www.youtube.com/watch?v=${yt}&t=${t}s`
  }

  return null
}

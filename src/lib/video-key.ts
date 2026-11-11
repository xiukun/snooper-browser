import type { SourceRef } from './knowledge-types'

/**
 * Stable video identity shared by the content script and the background.
 *
 * Companion sessions belong to a *video*, not to a tab or a browser run.
 * The key must therefore survive reloads, query-string churn (share/tracking
 * parameters) and navigation within the same watch page. Pure functions only:
 * the background bundles this module and `scripts/test-agent.mjs` imports it
 * without a DOM.
 */

/** Query parameters that never change which video is being watched. */
const TRACKING_PARAMS = new Set([
  't',
  'si',
  'feature',
  'index',
  'list',
  'start_radio',
  'spm_id_from',
  'vd_source',
  'share_source',
  'share_medium',
  'share_plat',
  'share_session_id',
  'share_tag',
  'timestamp',
  'unique_k',
  'from',
  'ref',
  'ref_src',
  'fbclid',
  'gclid',
])

function stripWww(host: string): string {
  return host.replace(/^www\./, '')
}

/** Extracts the YouTube video id, or null for other hosts. Exported for deep-link building (ADR-035). */
export function youtubeId(url: URL): string | null {
  const host = stripWww(url.hostname)
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id || null
  }
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null
  const direct = url.searchParams.get('v')
  if (direct) return direct
  const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)
  return match?.[1] ?? null
}

/** Extracts the Bilibili video identity (`BV…`/`av…`/path), or null. Exported for deep-link building (ADR-035). */
export function bilibiliKey(url: URL): string | null {
  const host = stripWww(url.hostname)
  if (host !== 'bilibili.com' && !host.endsWith('.bilibili.com')) return null
  const bv = url.pathname.match(/\/(BV[0-9A-Za-z]+)/)
  if (bv?.[1]) return `bilibili:${bv[1]}`
  const av = url.pathname.match(/\/av(\d+)/i)
  if (av?.[1]) return `bilibili:av${av[1]}`
  // Episode IDs prove a lesson; category/festival pages do not.
  const episode = url.pathname.match(/^\/(bangumi|cheese)\/play\/(ep\d+)(?:\/|$)/)
  if (episode) return `bilibili:${episode[1]}/play/${episode[2]}`
  return null
}

/** `youtube:<id>` | `bilibili:<BV|avN|episode>:pN` | normalized unknown page. */
export function videoKeyForUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return `page:${(rawUrl || 'unknown').slice(0, 160)}`
  }

  const yt = youtubeId(url)
  if (yt) return `youtube:${yt}`

  const bili = bilibiliKey(url)
  if (bili) {
    const part = bilibiliPart(url)
    if (part !== null) return `${bili}:p${part}`
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.has(key) || key.startsWith('utm_')) url.searchParams.delete(key)
    url.searchParams.sort()
    return `unknown:${bili}:${url.search}`
  }

  const normalized = new URL(url.toString())
  normalized.hash = ''
  for (const key of [...normalized.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key) || key.startsWith('utm_')) {
      normalized.searchParams.delete(key)
    }
  }
  // Keep the root path clean: `https://example.com/` not `https://example.com`.
  return `page:${normalized.toString()}`
}

/**
 * Remove the site chrome from `document.title`.
 *
 * Bilibili titles are `…_哔哩哔哩_bilibili`; YouTube appends ` - YouTube`.
 * The raw title remains a valid fallback when no known suffix is present.
 */
export function videoTitleFromDocumentTitle(rawTitle: string): string {
  const title = (rawTitle || '').trim()
  if (!title) return ''
  const stripped = title
    .replace(/\s*[-–—_|]\s*YouTube\s*$/i, '')
    .replace(/[_\-–—|]\s*哔哩哔哩.*$/i, '')
    .replace(/\s*[-–—|]\s*Bilibili\s*$/i, '')
    .trim()
  return (stripped || title).slice(0, 120)
}

/** Absent p means P1; malformed/duplicate p never proves a lesson. */
export function bilibiliPart(url: URL): number | null {
  if (!url.searchParams.has('p')) return 1
  const parts = url.searchParams.getAll('p')
  if (parts.length !== 1 || !/^[1-9]\d*$/.test(parts[0]!)) return null
  const n = Number(parts[0])
  return Number.isSafeInteger(n) ? n : null
}

/** Only recognized video URLs prove a lesson. Unknown records group by their own id. */
export function sourceRefForUrl(rawUrl: string, title = '', scope = 'page'): SourceRef {
  let exact = false
  try {
    const url = new URL(rawUrl)
    exact = !!youtubeId(url) || (!!bilibiliKey(url) && bilibiliPart(url) !== null)
  } catch { /* Invalid URL has no verifiable lesson. */ }
  return { key: exact ? videoKeyForUrl(rawUrl) : `unknown:${scope}`, url: rawUrl, title, confidence: exact ? 'exact' : 'unknown' }
}

/** Old URLs cannot prove that every row in the old recording used that lesson. */
export function legacySourceRef(url: string, title: string, scope: string): SourceRef {
  return { key: `legacy:${scope}`, url, title, confidence: url ? 'legacy' : 'unknown' }
}

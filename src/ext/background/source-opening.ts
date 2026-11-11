/** Shared source opener for saved rows, notes and the retrieval UI. */
import type { SourceRef } from '../../lib/knowledge-types'
import { videoDeepLink } from '../../lib/deep-link'
import { sourceRefForUrl } from '../../lib/video-key'
export type OpenSourceResult = { ok: true; action: 'seeked' | 'opened'; time?: number } | { ok: false; error: string }
export async function openSource(source: SourceRef, videoTime: unknown, tabId?: number): Promise<OpenSourceResult> {
  let url: URL
  try { url = new URL(source?.url) } catch { return { ok: false, error: '没有可打开的来源地址' } }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: '来源地址仅支持网页链接' }
  const exact = source.confidence === 'exact' && sourceRefForUrl(source.url).key === source.key
  const anchored = exact && typeof videoTime === 'number' && Number.isFinite(videoTime) && videoTime >= 0
  if (anchored && typeof tabId === 'number') {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'SEEK_VIDEO', expectedSourceKey: source.key, seconds: videoTime })
      if (response?.seek?.ok === true) return { ok: true, action: 'seeked', time: response.seek.time }
    } catch { /* Missing content/video falls back to opening the known source. */ }
  }
  await chrome.tabs.create({ url: anchored ? videoDeepLink(source.url, videoTime) || source.url : source.url })
  return { ok: true, action: 'opened' }
}

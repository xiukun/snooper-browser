import type { SourceRef } from '../../lib/knowledge-types'
export async function openSavedSource(sourceRef: SourceRef | undefined, videoTime: number | null | undefined): Promise<{ ok: boolean; action?: 'seeked' | 'opened'; error?: string }> {
  if (!sourceRef?.url) return { ok: false, error: '没有可打开的来源地址' }
  try { return await chrome.runtime.sendMessage({ target: 'background', type: 'OPEN_SOURCE', sourceRef, videoTime }) }
  catch { return { ok: false, error: '无法打开来源，请重试' } }
}

/**
 * Obsidian Local REST API bridge.
 *
 * Exports markdown notes and uploads image assets into the vault. The plugin
 * serves plain HTTP on 27123 and self-signed HTTPS on 27124; Chrome rejects
 * the self-signed cert, so HTTP is the default.
 */

import { decodeExportAsset } from '../../lib/export-assets'

export interface ObsidianConfig {
  apiPort?: number | string
  apiProtocol?: string
  apiKey?: string
  noteFolder?: string
}

export type ObsidianResult = Record<string, any> & { ok: boolean }

/**
 * Obsidian's Local REST API plugin displays the key as "Bearer <token>".
 * Users copy that whole string; sending it back with another "Bearer " prefix
 * produces "Bearer Bearer <token>" and a 401. Normalize at every entry point.
 */
export function normalizeObsidianKey(raw: unknown): string {
  return String(raw || '').trim().replace(/^Bearer\s+/i, '').trim()
}

function resolveProtocol(oc: ObsidianConfig, port: number): 'http' | 'https' {
  if (oc.apiProtocol === 'https') return 'https'
  if (oc.apiProtocol === 'http') return 'http'
  return port === 27124 ? 'https' : 'http'
}

function normalizeFolder(raw: unknown): string {
  return String(raw || 'snooper-notes').replace(/^\/+|\/+$/g, '')
}

export async function exportToObsidian(message: any): Promise<ObsidianResult> {
  const content = message.content || ''
  const title = message.title || `snooper-笔记-${Date.now()}`
  if (!content) {
    return { ok: false, error: '没有内容可导出' }
  }

  // Use config sent from content script, or fall back to defaults.
  const oc: ObsidianConfig = message.obsidianConfig || {}
  const obsidianPort = Number(oc.apiPort) || 27123
  const protocol = resolveProtocol(oc, obsidianPort)
  const obsidianApiKey = normalizeObsidianKey(oc.apiKey)
  const noteFolder = normalizeFolder(oc.noteFolder)
  const fileName = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')}.md`
  const base = `${protocol}://127.0.0.1:${obsidianPort}`
  const vaultPath = noteFolder
    ? `/vault/${noteFolder}/${encodeURIComponent(fileName)}`
    : `/vault/${encodeURIComponent(fileName)}`

  try {
    const res = await fetch(base + vaultPath, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/markdown',
        ...(obsidianApiKey ? { Authorization: `Bearer ${obsidianApiKey}` } : {}),
      },
      body: content,
    })
    if (res.ok) return { ok: true }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Obsidian 拒绝访问：API Key 不正确或未填写' }
    }
    if (res.status === 404) {
      return { ok: false, error: 'Obsidian 找不到写入路径，请检查笔记目录设置' }
    }
    return { ok: false, error: `Obsidian API 返回 ${res.status}` }
  } catch {
    const hint = protocol === 'https'
      ? 'HTTPS 27124 使用自签名证书，Chrome 会拒绝。请在 Obsidian → Local REST API 设置中开启「Enable Non-encrypted (HTTP) Server」，然后在侧栏把协议改为 HTTP、端口 27123。'
      : '请确认 Obsidian 正在运行、Local REST API 插件已启用，并开启「Enable Non-encrypted (HTTP) Server」（端口 27123）。'
    return { ok: false, error: `无法连接 Obsidian（${base}）。${hint}` }
  }
}

export async function uploadObsidianAsset(message: any): Promise<ObsidianResult> {
  // Upload a note image (data URL or remote URL) to the vault so the
  // exported markdown can embed it with ![[file]]. Obsidian does not
  // render data: URLs, which is why exported images used to be blank.
  const oc: ObsidianConfig = message.obsidianConfig || {}
  const key = normalizeObsidianKey(oc.apiKey)
  const port = Number(oc.apiPort) || 27123
  const protocol = resolveProtocol(oc, port)
  const folder = normalizeFolder(oc.noteFolder)
  const fileName = String(message.fileName || '').replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!fileName) {
    return { ok: false, error: '资产文件名为空' }
  }

  try {
    let bytes: Uint8Array
    let mime = String(message.mimeType || 'image/png')

    // Shared decoder: data URLs, raw SVG markup, and remote HTTP(S) images
    // all funnel through one code path with identical MIME rules.
    const decoded = decodeExportAsset({
      entryId: 'obsidian',
      fileName,
      mimeType: mime === 'image/svg+xml' ? 'image/svg+xml' : mime,
      dataUrl: String(message.dataUrl || ''),
      svgText: String(message.rawText || ''),
    })
    if (decoded) {
      bytes = decoded.file.bytes
      if (mime === 'image/svg+xml') mime = 'image/svg+xml'
    } else if (/^https?:\/\//i.test(String(message.dataUrl || ''))) {
      const r = await fetch(String(message.dataUrl))
      if (!r.ok) throw new Error(`下载图片失败 HTTP ${r.status}`)
      const buf = await r.arrayBuffer()
      bytes = new Uint8Array(buf)
      mime = r.headers.get('content-type') || mime
    } else {
      throw new Error('没有可上传的图片数据')
    }

    const base = `${protocol}://127.0.0.1:${port}`
    const assetPath = folder
      ? `/vault/${folder}/assets/${encodeURIComponent(fileName)}`
      : `/vault/assets/${encodeURIComponent(fileName)}`
    const res = await fetch(base + assetPath, {
      method: 'PUT',
      headers: {
        'Content-Type': mime,
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: bytes as unknown as BodyInit,
    })
    if (!res.ok) {
      return { ok: false, error: `图片上传失败 HTTP ${res.status}` }
    }
    return { ok: true, fileName }
  } catch (err: any) {
    return { ok: false, error: err.message || '图片上传失败' }
  }
}

export async function testObsidian(message: any): Promise<ObsidianResult> {
  const oc: ObsidianConfig = message.obsidianConfig || {}
  const key = normalizeObsidianKey(oc.apiKey)
  const configuredPort = Number(oc.apiPort) || 27123
  const configuredProtocol = resolveProtocol(oc, configuredPort)
  const seen = new Set<string>()
  const candidates: Array<{ protocol: 'http' | 'https'; port: number }> = []
  for (const c of [
    { protocol: configuredProtocol, port: configuredPort },
    { protocol: 'http' as const, port: 27123 },
    { protocol: 'https' as const, port: 27124 },
  ]) {
    const id = `${c.protocol}:${c.port}`
    if (!seen.has(id)) { seen.add(id); candidates.push(c) }
  }

  for (const c of candidates) {
    try {
      const res = await fetch(`${c.protocol}://127.0.0.1:${c.port}/vault/`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      })
      if (res.ok) {
        return { ok: true, protocol: c.protocol, port: c.port }
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          protocol: c.protocol,
          port: c.port,
          error: `已连上 ${c.protocol}://127.0.0.1:${c.port}，但 API Key 不正确，请在插件设置中重新复制`,
        }
      }
    } catch { /* try next */ }
  }
  return {
    ok: false,
    error: '无法连接。请确认 Obsidian 正在运行、Local REST API 插件已启用，并开启「Enable Non-encrypted (HTTP) Server」（端口 27123）',
  }
}

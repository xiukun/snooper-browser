/**
 * Obsidian export: upload note images into the vault, then write one Markdown
 * document. Images must become real vault files — Obsidian's renderer ignores
 * data URLs, which is why earlier exports lost their pictures.
 */

import type { SessionState } from './types'
import { collectNoteAssets, getSubtitleMarkdown } from './exporter'
import { loadObsidianConfig } from './obsidian-config'

export interface ObsidianExportDeps {
  button: HTMLElement
  getSession: () => SessionState
  bg: (type: string, payload?: Record<string, any>) => Promise<any>
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  flashChip: (button: HTMLElement, ms?: number) => void
  openSettings: () => Promise<void> | void
  focusObsidianKey: () => void
}

export function bindObsidianExport(deps: ObsidianExportDeps) {
  deps.button.addEventListener('click', async () => {
    // Shared config lives in chrome.storage.local so the side panel and the
    // in-page settings always agree.
    const obsidianConfig = await loadObsidianConfig()
    if (!obsidianConfig.apiKey) {
      deps.toast('请先填写 Obsidian API Key', 'err')
      await deps.openSettings()
      deps.focusObsidianKey()
      return
    }

    const session = deps.getSession()
    const assets = collectNoteAssets(session.notes, session.messages)
    const uploadedNames = new Map<string, string>()
    let uploadedCount = 0
    let failedCount = 0

    if (assets.length > 0) {
      deps.toast(`正在上传 ${assets.length} 张图片到 Obsidian…`, 'ok')
      for (const asset of assets) {
        try {
          const up: any = await deps.bg('OBSIDIAN_UPLOAD_ASSET', {
            obsidianConfig,
            fileName: asset.fileName,
            dataUrl: asset.dataUrl || '',
            rawText: asset.rawText || '',
            mimeType: asset.mimeType,
          })
          if (up.ok) {
            uploadedNames.set(asset.entryId, asset.fileName)
            uploadedCount += 1
          } else {
            failedCount += 1
          }
        } catch {
          failedCount += 1
        }
      }
    }

    const markdown = getSubtitleMarkdown(deps.getSession(), uploadedNames)
    const imageNote = uploadedCount > 0 ? `，含 ${uploadedCount} 张图片` : ''
    const failNote = failedCount > 0 ? `；${failedCount} 张图片上传失败，已用文字占位` : ''

    try {
      const res = await deps.bg('EXPORT_TO_OBSIDIAN', {
        content: markdown,
        title: `snooper-会话-${Date.now()}`,
        obsidianConfig,
      })
      if (res.ok) {
        deps.flashChip(deps.button, 2000)
        deps.toast(`已发送到 Obsidian${imageNote}${failNote}`, failedCount > 0 ? 'err' : 'ok')
      } else {
        deps.toast('Obsidian 导出失败：' + (res.error || '请确认已安装 Obsidian Local REST API 插件'), 'err')
      }
    } catch (err: any) {
      deps.toast('Obsidian 通信失败：' + (err.message || '请确认 Obsidian 正在运行'), 'err')
    }
  })
}

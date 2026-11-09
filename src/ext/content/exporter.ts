/**
 * Export payload builders.
 *
 * Pure functions that turn the live session into TXT / Markdown text; the
 * callers only trigger a download.
 */

import type { NoteDocument, SubtitleLine } from '../../lib/types'
import { LANGUAGES } from '../../lib/models'
import { formatVideoTime } from '../../lib/video-clock'
import { videoDeepLink } from '../../lib/deep-link'

export function getSubtitleText(subtitles: Array<Partial<SubtitleLine>>): string {
  return subtitles
    .map((sub) => {
      const t = sub.target || ''
      const s = sub.source ? ` [${sub.source}]` : ''
      return `${t}${s}`
    })
    .join('\n')
}

export interface NoteAssetPlan {
  entryId: string
  fileName: string
  dataUrl?: string
  rawText?: string
  mimeType: string
}

export function collectNoteAssets(
  notes: NoteDocument[],
  messages: Array<{ images?: string[] }>,
): NoteAssetPlan[] {
  const assets: NoteAssetPlan[] = []
  const stamp = Date.now()
  notes.forEach((note) => note.entries.forEach((entry) => {
    const entryId = `note:${note.id}:${entry.id}`
    if ((entry.type === 'image' || entry.type === 'screenshot') && entry.imageUrl?.startsWith('data:')) {
      const mime = /^data:([^;,]+)/.exec(entry.imageUrl)?.[1] || 'image/png'
      const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'png'
      assets.push({ entryId, fileName: `snooper-${stamp}-${assets.length + 1}.${ext}`, dataUrl: entry.imageUrl, mimeType: mime })
    } else if (entry.type === 'svg' && entry.svg) {
      assets.push({ entryId, fileName: `snooper-${stamp}-${assets.length + 1}.svg`, rawText: entry.svg, mimeType: 'image/svg+xml' })
    }
  }))
  messages.forEach((message, messageIndex) => (message.images || []).forEach((image, imageIndex) => {
    if (!image.startsWith('data:')) return
    const mime = /^data:([^;,]+)/.exec(image)?.[1] || 'image/png'
    const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'png'
    assets.push({
      entryId: `chat:${messageIndex}:${imageIndex}`,
      fileName: `snooper-${stamp}-${assets.length + 1}.${ext}`,
      dataUrl: image,
      mimeType: mime,
    })
  }))
  return assets
}

export interface MarkdownSession {
  sourceLang: string
  targetLang: string
  subtitles: Array<Partial<SubtitleLine>>
  messages: Array<{ role: string; content: string; images?: string[] }>
  notes: NoteDocument[]
  /** Page URL the session was captured on; enables `?t=` deep links (ADR-035). */
  pageUrl?: string
  /** Page title for the export header, when known. */
  pageTitle?: string
}

export function getSubtitleMarkdown(
  session: MarkdownSession,
  assetNames?: Map<string, string>,
): string {
  const label = (code: string) => {
    const lang = LANGUAGES.find((l) => l.code === code)
    return lang ? lang.label : code
  }
  const anchored = session.subtitles.some(
    (sub) => typeof sub.videoTime === 'number' && Number.isFinite(sub.videoTime),
  )
  const lines = [
    `# snooper-browser 翻译记录`,
    ``,
    ...(session.pageTitle ? [`- **页面**：${session.pageTitle}`] : []),
    `- **时间**：${new Date().toLocaleString('zh-CN')}`,
    `- **语言方向**：${label(session.sourceLang)} → ${label(session.targetLang)}`,
    `- **字幕条目**：${session.subtitles.length} 条`,
    ``,
    `---`,
    ``,
    anchored
      ? `| 视频时间 | 录制时间 | 译文 | 原文 |`
      : `| 时间 | 译文 | 原文 |`,
    anchored
      ? `| :--- | :--- | :--- | :--- |`
      : `| :--- | :--- | :--- |`,
  ]

  for (const sub of session.subtitles) {
    const wall = sub.at ? new Date(sub.at).toLocaleTimeString('zh-CN') : ''
    const t = (sub.target || '').replace(/\|/g, '\\|')
    const s = (sub.source || '').replace(/\|/g, '\\|')
    if (anchored) {
      const video = typeof sub.videoTime === 'number' && Number.isFinite(sub.videoTime)
        ? formatVideoTime(sub.videoTime)
        : ''
      // ADR-035: deep-link the timestamp when the site supports ?t= seeks.
      const link = typeof sub.videoTime === 'number' && Number.isFinite(sub.videoTime)
        ? videoDeepLink(session.pageUrl, sub.videoTime)
        : null
      const cell = link ? `[\`${video}\`](${link})` : video
      lines.push(`| ${cell} | ${wall} | ${t} | ${s} |`)
    } else {
      lines.push(`| ${wall} | ${t} | ${s} |`)
    }
  }

  if (session.messages.length > 0) {
    lines.push('', '---', '', '## 伴学对话', '')
    session.messages.forEach((message, messageIndex) => {
      lines.push(`### ${message.role === 'user' ? '提问' : '回答'}`, '', message.content || '（图片）', '')
      ;(message.images || []).forEach((image, imageIndex) => {
        const uploaded = assetNames?.get(`chat:${messageIndex}:${imageIndex}`)
        if (uploaded) lines.push(`![[${uploaded}]]`, '')
        else if (/^https?:\/\//i.test(image)) lines.push(`![伴学图片](${image})`, '')
        else lines.push('> [伴学图片未能导出：图片数据仅保存在扩展存储中]', '')
      })
    })
  }

  session.notes.forEach((note) => {
    if (note.entries.length === 0) return
    lines.push('', '---', '', `## 笔记：${note.title || '未命名笔记'}`, '')
    note.entries.forEach((entry) => {
      const label = entry.text || entry.target || '笔记'
      const isVisual = entry.type === 'image' || entry.type === 'screenshot' || entry.type === 'svg'
      if (isVisual) {
        const uploaded = assetNames?.get(`note:${note.id}:${entry.id}`)
        if (uploaded) lines.push(`![[${uploaded}]]`)
        else if (entry.imageUrl && /^https?:\/\//i.test(entry.imageUrl)) lines.push(`![${label}](${entry.imageUrl})`)
        else if (entry.svg) lines.push('```svg', entry.svg, '```')
        else lines.push(`> [图片：${label} — 图片数据仅保存在扩展存储中，未随本次导出携带]`)
        if (entry.text) lines.push('', `*${entry.text}*`)
        lines.push('')
      } else if (entry.type === 'summary') {
        // ADR-037: already-Markdown document text, never a list item.
        lines.push('', `### 学习纪要`, '', entry.text || '', '')
      } else if (entry.target) {
        lines.push(`- ${entry.target} ${entry.source ? `（${entry.source}）` : ''}`)
      } else if (entry.text) lines.push(`- ${entry.text}`)
    })
  })

  return lines.join('\n')
}

export function downloadBlob(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

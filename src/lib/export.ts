import type { SubtitleLine, NoteDocument } from './types'
import { languageLabel } from './models'

/** Formats seconds into SRT timestamp format: HH:MM:SS,mmm */
export function formatSrtTime(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = Math.floor(safe % 60)
  const millis = Math.floor((safe % 1) * 1000)

  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`
}

/** Formats seconds into WebVTT timestamp format: HH:MM:SS.mmm */
export function formatVttTime(totalSeconds: number): string {
  return formatSrtTime(totalSeconds).replace(',', '.')
}

export type ExportSubtitleMode = 'bilingual' | 'target' | 'source'


function resolveEnd(subtitles: SubtitleLine[], line: SubtitleLine, index: number): number {
  if (typeof line.endedAt === 'number') return line.endedAt
  const nextLine = subtitles[index + 1]
  if (nextLine) return line.at + Math.min(6, Math.max(2, nextLine.at - line.at))
  return line.at + 4
}

/**
 * Builds an SRT subtitle file string.
 * Each entry covers from `line.at` to `line.at + duration` (defaults to 4s or gap to next).
 */
export function buildSrt(subtitles: SubtitleLine[], mode: ExportSubtitleMode = 'bilingual'): string {
  if (!subtitles.length) return ''

  return subtitles
    .map((line, index) => {
      const start = line.at
      const end = resolveEnd(subtitles, line, index)

      let content = ''
      if (mode === 'bilingual') {
        content = `${line.target}\n${line.source}`
      } else if (mode === 'target') {
        content = line.target
      } else {
        content = line.source
      }

      return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${content}\n`
    })
    .join('\n')
}

/** Builds a WebVTT file string. */
export function buildVtt(subtitles: SubtitleLine[], mode: ExportSubtitleMode = 'bilingual'): string {
  if (!subtitles.length) return 'WEBVTT\n\n'

  const body = subtitles
    .map((line, index) => {
      const start = line.at
      const end = resolveEnd(subtitles, line, index)

      let content = ''
      if (mode === 'bilingual') {
        content = `${line.target}\n${line.source}`
      } else if (mode === 'target') {
        content = line.target
      } else {
        content = line.source
      }

      return `${index + 1}\n${formatVttTime(start)} --> ${formatVttTime(end)}\n${content}\n`
    })
    .join('\n')

  return `WEBVTT - snooper-browser subtitle export\n\n${body}`
}

/** Builds a structured Markdown study & meeting transcript. */
export function buildMarkdownTranscript(
  subtitles: SubtitleLine[],
  meta: {
    sourceLang: string
    targetLang: string
    title?: string
    engine?: string
    elapsedSeconds?: number
  },
): string {
  const dateStr = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const lines = [
    `# ${meta.title || '音视频听译与研读纪要'}`,
    '',
    `- **生成时间**：${dateStr}`,
    `- **语言方向**：${languageLabel(meta.sourceLang)} (${meta.sourceLang}) → ${languageLabel(meta.targetLang)} (${meta.targetLang})`,
    `- **字幕条目**：${subtitles.length} 条`,
  ]

  if (meta.engine) lines.push(`- **处理引擎**：${meta.engine}`)
  lines.push('', '---', '', '### 双语对齐记录', '', '| 时间戳 | 发言人 | 译文 (Target) | 原文 (Source) | 延迟 |', '| :--- | :--- | :--- | :--- | :--- |')

  for (const line of subtitles) {
    const timeStr = formatSrtTime(line.at).split(',')[0]!
    const cleanTarget = line.target.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    const cleanSource = line.source.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| \`${timeStr}\` | ${line.speaker} | **${cleanTarget}** | ${cleanSource} | ${line.latency}ms |`)
  }

  lines.push('', '---', '*由 snooper-browser 浏览器纯前端原生双语工作台导出*')
  return lines.join('\n')
}

/** Builds raw JSON session export for local backup. */
export function buildJsonExport(
  subtitles: SubtitleLine[],
  meta: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      generator: 'snooper-browser',
      meta,
      subtitles,
    },
    null,
    2,
  )
}

/** Triggers a browser native file download without contacting any server. */
export function downloadBlob(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/* ===== Note-based exports ===== */

/** Build a Markdown document from a NoteDocument. */
export function buildNoteMarkdown(note: NoteDocument): string {
  const lines = [
    `# ${note.title}`,
    '',
    `- **创建时间**：${new Date(note.createdAt).toLocaleString('zh-CN')}`,
    `- **条目数**：${note.entries.length}`,
    '',
    '---',
    '',
  ]

  for (const entry of note.entries) {
    const time = new Date(entry.at).toLocaleTimeString('zh-CN')
    switch (entry.type) {
      case 'subtitle':
        lines.push(`### 字幕 ${time}`)
        if (entry.target) lines.push(`**译文**：${entry.target}`)
        if (entry.source) lines.push(`**原文**：${entry.source}`)
        lines.push('')
        break
      case 'image':
        lines.push(`### 配图 ${time}`)
        lines.push(`**描述**：${entry.text || entry.source || ''}`)
        if (entry.imageUrl) lines.push(`![](${entry.imageUrl})`)
        lines.push('')
        break
      case 'screenshot':
        lines.push(`### 截图 ${time}`)
        lines.push(`**截图**：${entry.text || ''}`)
        if (entry.imageUrl) lines.push(`![](${entry.imageUrl})`)
        lines.push('')
        break
      case 'text':
        lines.push(`### 笔记 ${time}`)
        lines.push(entry.text || '')
        lines.push('')
        break
      case 'summary':
        lines.push(`### 摘要 ${time}`)
        lines.push(entry.text || '')
        lines.push('')
        break
    }
  }

  lines.push('---', '*由 snooper-browser 生成*')
  return lines.join('\n')
}

/**
 * Build a DOCX document buffer from a NoteDocument.
 * Requires the `docx` npm package (pnpm add docx).
 */
export async function buildNoteDocx(note: NoteDocument): Promise<Blob | null> {
  try {
    // Dynamic import handled by the app's bundler — docx is a dependency of app/
    const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, PageBreak } = await import('docx')

    const children: any[] = [
      new Paragraph({
        text: note.title,
        heading: HeadingLevel.TITLE,
      }),
      new Paragraph({
        text: `创建时间：${new Date(note.createdAt).toLocaleString('zh-CN')}  ·  条目数：${note.entries.length}`,
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [new PageBreak()],
      }),
    ]

    for (const entry of note.entries) {
      const time = new Date(entry.at).toLocaleTimeString('zh-CN')
      switch (entry.type) {
        case 'subtitle': {
          children.push(
            new Paragraph({
              text: `字幕 ${time}`,
              heading: HeadingLevel.HEADING_3,
            }),
          )
          if (entry.target) {
            children.push(
              new Paragraph({
                text: `译文：${entry.target}`,
                spacing: { after: 60 },
              }),
            )
          }
          if (entry.source) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: `原文：${entry.source}`, italics: true })],
                spacing: { after: 120 },
              }),
            )
          }
          break
        }
        case 'text': {
          children.push(
            new Paragraph({
              text: `笔记 ${time}`,
              heading: HeadingLevel.HEADING_3,
            }),
            new Paragraph({
              text: entry.text || '',
              spacing: { after: 120 },
            }),
          )
          break
        }
        case 'screenshot':
        case 'image': {
          children.push(
            new Paragraph({
              text: entry.type === 'screenshot' ? `截图 ${time}` : `配图 ${time}`,
              heading: HeadingLevel.HEADING_3,
            }),
          )
          if (entry.text) {
            children.push(
              new Paragraph({
                text: entry.text,
                spacing: { after: 60 },
              }),
            )
          }
          if (entry.imageUrl) {
            try {
              const response = await fetch(entry.imageUrl)
              const blob = await response.blob()
              const buffer = await blob.arrayBuffer()
              const imgType = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' || blob.type === 'image/jpg' ? 'jpg' : 'png'
              children.push(
                new ImageRun({
                  type: imgType,
                  data: buffer,
                  transformation: { width: 400, height: 300 },
                }),
              )
            } catch {
              children.push(
                new Paragraph({
                  text: '[图片嵌入失败]',
                  spacing: { after: 120 },
                }),
              )
            }
          }
          children.push(new Paragraph({ spacing: { after: 120 } }))
          break
        }
      }
    }

    const doc = new Document({
      title: note.title,
      description: '由 snooper-browser 生成',
      styles: {
        default: {
          document: {
            run: { font: 'Inter, -apple-system, sans-serif', size: 22 },
          },
        },
      },
      sections: [{ children }],
    })

    return await Packer.toBlob(doc)
  } catch {
    console.warn('[snooper] DOCX export unavailable — docx package not installed or failed to load')
    return null
  }
}

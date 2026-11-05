import type { SubtitleLine } from './types'
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

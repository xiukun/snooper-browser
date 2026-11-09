/**
 * Gateway-shaped message flattening for the MOSS gateway (AGENTS.md §2.2):
 * exactly one user message, a parts array with all text parts before all
 * image parts, `image_url` as an object without `detail`.
 *
 * Lives in its own zero-dependency module so extension bundles can reuse the
 * flattening without pulling in moss.ts — whose module top-level reads
 * `import.meta.env`, which does not exist in esbuild-built MV3 bundles and
 * would crash the background service worker at evaluation time.
 */

import type { MossContentPart, MossMessage } from './models'

export function flattenMessages(messages: MossMessage[]): MossContentPart[] {
  const systemText = messages
    .filter((message) => message.role === 'system')
    .map((message) => contentToText(message.content))
    .filter(Boolean)
    .join('\n\n')

  const turns = messages.filter((message) => message.role !== 'system')

  const prefix = systemText
    ? `【系统指令】\n${systemText}\n\n【对话记录】`
    : turns.length > 1
      ? '【对话记录】'
      : ''

  const lines: string[] = prefix ? [prefix] : []
  const images: MossContentPart[] = []

  for (const message of turns) {
    const label = message.role === 'user' ? '用户' : '助手'
    const text = contentToText(message.content)
    const attached = contentToImages(message.content)
    if (text) lines.push(`${label}：${text}`)
    if (attached.length) {
      lines.push(`${label}上传了 ${attached.length} 张图片。`)
      images.push(...attached)
    }
  }

  // The MOSS gateway requires every image part to come after all text parts;
  // a text part following an image yields `invalid_field_value`.
  const parts: MossContentPart[] = []
  if (lines.length) parts.push({ type: 'text', text: lines.join('\n') })
  parts.push(...images)
  if (!parts.length) parts.push({ type: 'text', text: '你好' })
  return parts
}

function contentToText(content: MossMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('\n')
}

function contentToImages(content: MossMessage['content']): MossContentPart[] {
  if (typeof content === 'string') return []
  return content.filter((part) => part.type === 'image_url')
}

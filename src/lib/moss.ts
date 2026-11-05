import type { MossContentPart, MossMessage, MossRole } from './models'
import {
  type AppConfig,
  type CapabilityKey,
  type ProviderProfile,
  loadProviderConfig,
  resolveRoute,
} from './providers'
import { sleep } from './utils'

const STREAM_CAPABILITY_KEY = 'snooper.moss.stream-capability.v1'
const LEGACY_STREAM_CAPABILITY_KEY = 'rtts.moss.stream-capability.v1'

export class MossError extends Error {
  status: number
  code?: string

  constructor(message: string, status = 0, code?: string) {
    super(message)
    this.name = 'MossError'
    this.status = status
    this.code = code
  }
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function authHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function readError(res: Response): Promise<MossError> {
  let message = `请求失败（HTTP ${res.status}）`
  let code: string | undefined
  try {
    const text = await res.text()
    if (text) {
      try {
        const json = JSON.parse(text) as {
          error?: { message?: string; code?: string }
          message?: string
        }
        message = json.error?.message ?? json.message ?? text.slice(0, 240)
        code = json.error?.code
      } catch {
        message = text.slice(0, 240)
      }
    }
  } catch {
    /* keep default message */
  }
  return new MossError(message, res.status, code)
}

/**
 * `moss-vl-1.0` only accepts a single user message — no system role and no
 * multi-turn history. We flatten the whole conversation into one instruction
 * block so the Chat surface can still behave statefully.
 */
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

interface ChatOptions {
  messages: MossMessage[]
  model?: string
  capability?: CapabilityKey
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  onDelta?: (chunk: string, full: string) => void
  config?: AppConfig
  /** Force the simulated typewriter path (moss-vl currently rejects stream:true). */
  simulateStream?: boolean
}

function extractText(payload: unknown): string {
  const data = payload as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> }
      text?: string
    }>
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    output_text?: string
  }
  const choice = data.choices?.[0]
  if (choice?.message?.content) {
    if (typeof choice.message.content === 'string') return choice.message.content
    return choice.message.content.map((part) => part.text ?? '').join('')
  }
  if (choice?.text) return choice.text
  if (data.output_text) return data.output_text
  const output = data.output
    ?.flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? '')
    .join('')
  return output ?? ''
}

export async function completeChat(options: ChatOptions): Promise<string> {
  const config = options.config ?? loadProviderConfig()
  const route = resolveRoute(config, options.capability ?? 'llm', options.model)

  const res = await fetch(endpoint(route.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: authHeaders(route.apiKey),
    body: JSON.stringify({
      model: route.model,
      messages: [{ role: 'user' satisfies MossRole, content: flattenMessages(options.messages) }],
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 2048,
      stream: false,
    }),
    signal: options.signal,
  })

  if (!res.ok) throw await readError(res)
  const payload = (await res.json()) as unknown
  const text = extractText(payload)
  if (!text) throw new MossError('模型返回了空内容，请重试', 502, 'empty_response')
  return text
}

function readStreamCapability(): Record<string, boolean> {
  try {
    const raw =
      localStorage.getItem(STREAM_CAPABILITY_KEY) ??
      localStorage.getItem(LEGACY_STREAM_CAPABILITY_KEY) ??
      '{}'
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    return {}
  }
}

function writeStreamCapability(capability: Record<string, boolean>) {
  try {
    localStorage.setItem(STREAM_CAPABILITY_KEY, JSON.stringify(capability))
  } catch {
    /* ignore */
  }
}

async function nativeStream(options: ChatOptions): Promise<string> {
  const config = options.config ?? loadProviderConfig()
  const route = resolveRoute(config, options.capability ?? 'llm', options.model)
  const res = await fetch(endpoint(route.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: authHeaders(route.apiKey),
    body: JSON.stringify({
      model: route.model,
      messages: [{ role: 'user', content: flattenMessages(options.messages) }],
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    }),
    signal: options.signal,
  })

  if (!res.ok) throw await readError(res)
  if (!res.body) throw new MossError('当前环境不支持流式读取', 501, 'no_stream_body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let finished = false

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split(/\n\n/)
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') {
          finished = true
          break
        }
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            options.onDelta?.(delta, full)
          }
        } catch {
          /* ignore malformed keep-alive frames */
        }
      }
    }
  }

  if (!full) throw new MossError('流式响应为空', 502, 'empty_stream')
  return full
}

async function typewriter(text: string, onDelta?: ChatOptions['onDelta'], signal?: AbortSignal) {
  if (!onDelta) return
  const chunkSize = Math.max(2, Math.ceil(text.length / 220))
  for (let index = 0; index < text.length; index += chunkSize) {
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
    const next = Math.min(text.length, index + chunkSize)
    onDelta(text.slice(index, next), text.slice(0, next))
    await sleep(12)
  }
}

/**
 * Unified streaming entry. Probes the native SSE channel once per
 * provider+model (`baseUrl::model`), caches the verdict, and falls back to a
 * local typewriter so the UI keeps the same incremental feel. A generic HTTP
 * 400 only earns a one-off non-streaming retry for that request — it must not
 * poison the probe cache.
 */
export async function streamChat(options: ChatOptions): Promise<string> {
  const config = options.config ?? loadProviderConfig()
  const route = resolveRoute(config, options.capability ?? 'llm', options.model)
  const model = options.model ?? route.model
  const probeKey = `${route.baseUrl}::${model}`
  const capability = readStreamCapability()

  if (options.simulateStream !== true && capability[probeKey] !== false) {
    try {
      const text = await nativeStream(options)
      capability[probeKey] = true
      writeStreamCapability(capability)
      return text
    } catch (error) {
      if (isAbortError(error)) throw error
      const message = error instanceof Error ? error.message.toLowerCase() : ''
      const streamSpecific =
        message.includes('stream') || message.includes('invalid_field_value')
      if (streamSpecific) {
        capability[probeKey] = false
        writeStreamCapability(capability)
      } else if (!(error instanceof MossError && error.status === 400)) {
        throw error
      }
      // 无法归因的 400：仅本次请求回退非流式重试，不写入探针缓存。
    }
  }

  const text = await completeChat({ ...options, config })
  await typewriter(text, options.onDelta, options.signal)
  return text
}

export interface AnalyzeImageOptions {
  images: string[]
  prompt: string
  config?: AppConfig
  capability?: CapabilityKey
  model?: string
  signal?: AbortSignal
  onDelta?: (chunk: string, full: string) => void
  maxTokens?: number
}

export async function analyzeImages(options: AnalyzeImageOptions): Promise<string> {
  const config = options.config ?? loadProviderConfig()
  const capability = options.capability ?? 'llm'
  const route = resolveRoute(config, capability, options.model)
  const content: MossContentPart[] = [
    {
      type: 'text',
      text:
        options.prompt.trim() ||
        '请详细分析这些图片：描述主体、场景、关键细节，并提取所有可见文字。使用简体中文回答。',
    },
    ...options.images.map(
      (url) =>
        ({
          type: 'image_url',
          image_url: { url },
        }) satisfies MossContentPart,
    ),
  ]

  return streamChat({
    config,
    capability,
    model: route.model,
    messages: [{ role: 'user', content }],
    signal: options.signal,
    maxTokens: options.maxTokens ?? 2048,
    temperature: 0.25,
    onDelta: options.onDelta,
    simulateStream: true,
  })
}

const LANGUAGE_NAMES: Record<string, string> = {
  auto: '自动检测',
  zh: '简体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  ru: '俄语',
  ar: '阿拉伯语',
  pt: '葡萄牙语',
}

export async function translateText(
  text: string,
  options: {
    source?: string
    target?: string
    config?: AppConfig
    signal?: AbortSignal
    model?: string
  } = {},
): Promise<string> {
  const config = options.config ?? loadProviderConfig()
  const target = LANGUAGE_NAMES[options.target ?? 'zh'] ?? '简体中文'
  const source = LANGUAGE_NAMES[options.source ?? 'auto'] ?? '自动检测'

  const output = await completeChat({
    config,
    capability: 'llm',
    model: options.model,
    signal: options.signal,
    temperature: 0.15,
    maxTokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `你是一名专业的同声传译员。源语言：${source}；目标语言：${target}。`,
              '将下面的内容翻译为目标语言。只输出译文本身，不要解释、不要加引号、不要重复原文。',
              '保持口语化、简洁、适合作为实时字幕显示。',
              '',
              text,
            ].join('\n'),
          },
        ],
      },
    ],
  })

  return output
    .trim()
    .replace(/^["“「『]([\s\S]*)["”」』]$/, '$1')
    .trim()
}

export async function transcribeAudio(
  blob: Blob,
  options: { config?: AppConfig; signal?: AbortSignal; model?: string } = {},
): Promise<string> {
  const config = options.config ?? loadProviderConfig()
  const route = resolveRoute(config, 'audio', options.model)
  const form = new FormData()
  form.append('model', route.model)
  form.append('file', blob, 'segment.webm')
  form.append('response_format', 'json')

  const res = await fetch(endpoint(route.baseUrl, '/audio/transcriptions'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${route.apiKey}` },
    body: form,
    signal: options.signal,
  })

  if (!res.ok) throw await readError(res)
  const payload = (await res.json()) as { text?: string }
  return (payload.text ?? '').trim()
}

/** Pull the model list for one provider profile (`GET /models`). */
export async function listModels(provider: ProviderProfile): Promise<string[]> {
  const baseUrl = provider.baseUrl.trim()
  const apiKey = provider.apiKey.trim()
  if (!baseUrl) throw new MossError('缺少 Base URL，无法拉取模型列表', 400, 'missing_base_url')
  if (!apiKey) throw new MossError('缺少 API Key，无法拉取模型列表', 401, 'missing_api_key')
  const res = await fetch(endpoint(baseUrl, '/models'), {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw await readError(res)
  const payload = (await res.json()) as {
    data?: Array<{ id: string }>
    models?: Array<{ id?: string; name?: string }>
  }
  const fromData = (payload.data ?? []).map((model) => model.id)
  const fromModels = (payload.models ?? [])
    .map((model) => model.id ?? model.name ?? '')
    .filter(Boolean)
  return [...new Set([...fromData, ...fromModels])].filter(Boolean)
}

/**
 * Compress an uploaded image to a JPEG data URL. MOSS recommends 768–1536px
 * and caps base64 payloads at 10MB, so downscaling is mandatory for photos.
 */
export async function fileToDataUrl(
  file: File,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<string> {
  const maxEdge = options.maxEdge ?? 1536
  const quality = options.quality ?? 0.86

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
      reader.readAsDataURL(file)
    })
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(blob)
  })
}

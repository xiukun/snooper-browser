/**
 * Offscreen provider calls: ASR, streaming translation, and subtitle Q&A.
 *
 * The offscreen document owns the user's config snapshot so the content script
 * never sees API keys. All requests go straight to the configured provider.
 */

import type { AppConfig, CapabilityKey } from '../../lib/providers'
import { LANGUAGES } from '../../lib/models'
import { buildTranscriptionFormData } from '../../lib/transcription-request'
import { streamSSE } from './audio'

// Build LANG_NAMES from shared LANGUAGES (single source of truth)
const LANG_NAMES: Record<string, string> = {}
for (const lang of LANGUAGES) {
  LANG_NAMES[lang.code] = lang.label
}

export function validateRoute(
  config: AppConfig,
  capability: CapabilityKey,
): { provider: any; route: any } {
  if (!config || !config.routes || !config.providers) {
    throw new Error('配置缺失')
  }
  const route = config.routes[capability]
  if (!route) throw new Error(`能力 "${capability}" 未配置路由`)
  const provider = config.providers.find((p) => p.id === route.providerId)
  if (!provider) throw new Error(`服务商 "${route.providerId}" 未找到`)
  if (!provider.baseUrl) throw new Error(`服务商 "${provider.name}" 缺少 Base URL`)
  if (!provider.apiKey) throw new Error(`服务商 "${provider.name}" 缺少 API Key`)
  if (!route.model) throw new Error(`能力 "${capability}" 未选择模型`)
  return { provider, route }
}

async function apiFetch(url: string, options: RequestInit): Promise<any> {
  const res = await fetch(url, options)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const text = await res.text()
      if (text) {
        try {
          const json = JSON.parse(text)
          msg = json.error?.message || json.message || text.slice(0, 240)
        } catch {
          msg = text.slice(0, 240)
        }
      }
    } catch {
      // keep default message
    }
    throw new Error(msg)
  }
  return res.json()
}

/* ===== Speech-to-text ===== */

/**
 * ADR-042: a hung ASR request holds one of the three queue slots forever.
 * Three hung requests stop segmentation entirely, which the user experiences
 * as "waiting forever with no subtitles". The bound releases the slot.
 */
const ASR_TIMEOUT_MS = 15000

/** Transcribe one speech segment through the non-streaming MOSS endpoint. */
export async function transcribeAudio(
  wavBlob: Blob,
  config: AppConfig,
  sourceLang: string,
): Promise<string> {
  const { provider, route } = validateRoute(config, 'audio')
  const form = buildTranscriptionFormData({
    model: route.model,
    file: wavBlob,
    sourceLang,
  })

  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ASR_TIMEOUT_MS)
  try {
    const json = await apiFetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: form,
      signal: controller.signal,
    })

    return (json.text || '').trim()
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new Error('转写服务 15 秒未响应，已放弃该段')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/* ===== Translation ===== */

export interface TranslateOptions {
  source: string
  target: string
  config: AppConfig
  context?: string
  onDelta?: (delta: string) => void
}

function buildTranslatePrompt(options: TranslateOptions, text: string): string {
  const source = LANG_NAMES[options.source || 'auto'] || '自动检测'
  const target = LANG_NAMES[options.target || 'zh'] || '简体中文'
  const contextBlock = options.context
    ? `【上下文（最近的字幕）】\n${options.context}\n\n`
    : ''

  return [
    `你是一名专业的同声传译员。源语言：${source}；目标语言：${target}。`,
    '输入来自语音识别，可能有错字、漏字或断句错误。只翻译你看到的内容：不得补全、不得扩写、不得根据上下文编造未说出的信息。',
    '碎片或语气词就译成碎片或语气词，不要改写成完整句子。',
    '人名、地名、专有名词只使用上下文中出现过的写法；没有把握时音译，不得虚构。',
    '只输出译文本身，不要解释、不要加引号、不要重复原文、不要输出标签或注释。',
    '保持口语化、简洁、适合作为实时字幕显示。',
    contextBlock ? `注意保持与上下文的连贯性，专有名词前后一致。\n${contextBlock}` : '',
    '',
    text,
  ].filter(Boolean).join('\n')
}

function cleanTranslation(value: string): string {
  return value
    .trim()
    .replace(/^["“「『]([\s\S]*)["”」』]$/, '$1')
    .trim()
}

/**
 * Translate text via SSE streaming.
 * Calls onDelta for each text chunk as it arrives.
 *
 * Stream-capability probe (AGENTS.md §2.2.6 semantics): some gateways reject
 * stream:true with 400 invalid_field_value ("stream must be false"). Probing
 * on every segment cost one wasted round trip per subtitle line, so the
 * verdict is cached per baseUrl+model and stream is never attempted again
 * for that pair. Only the gateway's explicit stream complaint caches the
 * verdict — a generic 400 stays a one-off retry.
 */
const streamCapabilityCache = new Map<string, boolean>()

export async function translateTextStream(
  text: string,
  options: TranslateOptions,
): Promise<string> {
  if (!text) return ''

  const { onDelta } = options
  const { provider, route } = validateRoute(options.config, 'llm')
  const promptText = buildTranslatePrompt(options, text)
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const probeKey = `${baseUrl}::${route.model}`
  let fullTranslation = ''
  let hasError = false
  let streamRejected = false

  const runStream = async (): Promise<void> => {
    await streamSSE(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: route.model,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: promptText }],
            },
          ],
          temperature: 0.05,
          max_tokens: 512,
          stream: true,
        }),
      },
      {
        onDelta: (delta) => {
          fullTranslation += delta
          if (onDelta) onDelta(delta)
        },
        onDone: () => {},
        onError: (err) => {
          console.warn('[RTTS] Translation SSE failed, falling back:', err.message)
          hasError = true
          if (/stream must be false|invalid_field_value/i.test(err.message)) {
            streamRejected = true
          }
        },
        allowNonStreamingFallback: true,
      },
    )
  }

  const runSync = async (): Promise<void> => {
    const sync = await translateTextSync(text, options)
    if (sync) {
      fullTranslation = sync
      if (onDelta) onDelta(sync)
    }
  }

  // Known non-streaming gateway: skip the doomed attempt entirely.
  if (streamCapabilityCache.get(probeKey) === false) {
    await runSync()
    return cleanTranslation(fullTranslation)
  }

  await runStream()
  if (streamRejected) {
    streamCapabilityCache.set(probeKey, false)
    console.info('[RTTS] gateway rejects stream; cached sync-only for', probeKey)
  }
  if (hasError && !fullTranslation) {
    await runSync()
  }

  return cleanTranslation(fullTranslation)
}

/**
 * Non-streaming translation fallback.
 */
async function translateTextSync(text: string, options: TranslateOptions): Promise<string> {
  if (!text) return ''

  const { provider, route } = validateRoute(options.config, 'llm')
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const json = await apiFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildTranslatePrompt(options, text),
            },
          ],
        },
      ],
      temperature: 0.05,
      max_tokens: 512,
      stream: false,
    }),
  })

  return cleanTranslation(extractChatText(json))
}

/* ===== Subtitle Q&A ===== */

export async function askQuestion({ question, context, config, sourceLang, targetLang, signal }: {
  question: string
  context: string
  config: AppConfig
  sourceLang: string
  targetLang: string
  signal?: AbortSignal
}): Promise<string> {
  const { provider, route } = validateRoute(config, 'llm')

  const source = LANG_NAMES[sourceLang || 'auto'] || '自动检测'
  const target = LANG_NAMES[targetLang || 'zh'] || '简体中文'

  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const json = await apiFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `你是一个视频伴学助手。视频音频的语言：${source}；字幕目标语言：${target}。`,
                '',
                context ? `【最近的字幕上下文】\n${context}\n` : '',
                '请基于以上字幕内容回答用户的问题。用简体中文回答，保持简洁准确。',
                '',
                `【用户提问】\n${question}`,
              ].join('\n'),
            },
          ],
        },
      ],
      temperature: 0.3,
      max_tokens: 2048,
      stream: false,
    }),
    signal,
  })

  return extractChatText(json).trim()
}

export function extractChatText(json: any): string {
  const choice = json.choices?.[0]
  if (choice?.message?.content) {
    if (typeof choice.message.content === 'string') return choice.message.content
    return choice.message.content.map((p: any) => p.text || '').join('')
  }
  if (choice?.text) return choice.text
  if (json.output_text) return json.output_text
  const output = json.output
    ?.flatMap((item: any) => item.content || [])
    .map((p: any) => p.text || '')
    .join('')
  return output || ''
}

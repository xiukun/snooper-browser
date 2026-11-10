import type { MossContentPart, MossMessage, MossRole } from './models'
import {
  type AppConfig,
  type CapabilityKey,
  type ProviderProfile,
  loadProviderConfig,
  resolveRoute,
} from './providers'
import { buildTranscriptionFormData } from './transcription-request'
import { buildTranslationPrompt, cleanTranslation } from './translation-prompt'
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
// Flattening lives in a zero-dependency module (moss-messages.ts) so
// extension bundles can reuse the gateway shape without importing this
// module — its top level reads import.meta.env, which does not exist in
// esbuild-built MV3 bundles and would crash a service worker on load.
import { flattenMessages } from './moss-messages'
export { flattenMessages }

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

export async function translateText(
  text: string,
  options: {
    source?: string
    target?: string
    context?: string
    config?: AppConfig
    signal?: AbortSignal
    model?: string
  } = {},
): Promise<string> {
  const config = options.config ?? loadProviderConfig()

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
            text: buildTranslationPrompt({
              text,
              source: options.source,
              target: options.target,
              context: options.context,
            }),
          },
        ],
      },
    ],
  })

  return cleanTranslation(output)
}

export async function transcribeAudio(
  blob: Blob,
  options: {
    config?: AppConfig
    signal?: AbortSignal
    model?: string
    sourceLang?: string
    fileName?: string
    /** Abort the request when the provider stops responding. */
    timeoutMs?: number
  } = {},
): Promise<string> {
  const config = options.config ?? loadProviderConfig()
  const route = resolveRoute(config, 'audio', options.model)
  const form = buildTranscriptionFormData({
    model: route.model,
    file: blob,
    sourceLang: options.sourceLang ?? 'auto',
    fileName: options.fileName ?? 'segment.webm',
  })

  let controller: AbortController | null = null
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  if (options.timeoutMs) {
    controller = new AbortController()
    timer = setTimeout(() => {
      timedOut = true
      controller?.abort()
    }, options.timeoutMs)
    options.signal?.addEventListener('abort', () => controller?.abort(), { once: true })
  }

  try {
    const res = await fetch(endpoint(route.baseUrl, '/audio/transcriptions'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${route.apiKey}` },
      body: form,
      signal: controller?.signal ?? options.signal,
    })

    if (!res.ok) throw await readError(res)
    const payload = (await res.json()) as { text?: string }
    return (payload.text ?? '').trim()
  } catch (error) {
    if (timedOut && options.timeoutMs) {
      throw new MossError(
        `转写服务 ${Math.round(options.timeoutMs / 1000)} 秒未响应，已放弃该段`,
      )
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
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

/* ===== Image Generation ===== */

export interface GenerateImageOptions {
  prompt: string
  config?: AppConfig
  model?: string
  /** Negative prompt (MOSS-Image supports up to 4000 chars). */
  negativePrompt?: string
  /** Use the provider's built-in prompt enhancer (MOSS-Image `prompt_enhance`). */
  enhance?: boolean
  /** Seed for reproducible generation. */
  seed?: number
  /** Number of inference steps (MOSS-Image: 1–100, default 50). */
  numInferenceSteps?: number
  /** Classifier-free guidance scale (MOSS-Image: 0–10). */
  guidanceScale?: number
  /** Disable the visible watermark (MOSS-Image `output_watermark.enabled=false`). */
  noWatermark?: boolean
  n?: number
  size?: string
  signal?: AbortSignal
}

export interface GenerateImageResult {
  images: string[]  // URLs or base64 data URIs
  created: number
  model: string
}

/**
 * Generate an image via OpenAI-compatible /v1/images/generations endpoint.
 * Optimised for the MOSS-Image models (`moss-image-sft-1.0` etc.) which are
 * currently free in beta. Also works with any provider that speaks the OpenAI
 * image API (FLUX, SD3.5, SDXL through a relay).
 *
 * MOSS-Image specifics handled here:
 * - `n` is capped at 1 (the endpoint only supports a single image).
 * - `response_format` is always omitted so MOSS returns its native `url`.
 * - `output_watermark: { enabled: false }` removes the default watermark.
 * - Generations are synchronous and slow (20–25s); no automatic retry is
 *   attempted because a timed-out request may still be billed.
 */
export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
  const config = options.config ?? loadProviderConfig()
  const route = resolveRoute(config, 'image', options.model)
  const baseUrl = route.baseUrl.replace(/\/+$/, '')

  const body: Record<string, unknown> = {
    model: route.model,
    prompt: options.prompt,
    n: Math.min(1, Math.max(1, options.n ?? 1)),
    size: options.size ?? '1024x1024',
  }

  if (options.negativePrompt?.trim()) body.negative_prompt = options.negativePrompt.trim()
  if (typeof options.enhance === 'boolean') body.prompt_enhance = options.enhance
  if (typeof options.seed === 'number' && Number.isFinite(options.seed)) body.seed = options.seed
  if (typeof options.numInferenceSteps === 'number') {
    body.num_inference_steps = Math.min(100, Math.max(1, Math.round(options.numInferenceSteps)))
  }
  if (typeof options.guidanceScale === 'number') body.guidance_scale = options.guidanceScale
  if (options.noWatermark) body.output_watermark = { enabled: false }

  const res = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${route.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!res.ok) throw await readError(res)

  const payload = (await res.json()) as {
    created?: number
    data?: Array<{ url?: string; b64_json?: string }>
  }

  const data = payload.data ?? []
  if (data.length === 0) {
    throw new MossError('生图接口返回了空结果', 502, 'empty_images')
  }

  const images: string[] = data.map((item) => {
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
    return item.url ?? ''
  }).filter(Boolean)

  if (images.length === 0) {
    throw new MossError('生图接口未返回图片数据', 502, 'no_image_data')
  }

  return {
    images,
    created: payload.created ?? Math.floor(Date.now() / 1000),
    model: route.model,
  }
}

/**
 * Generate SVG code via the LLM route. The LLM writes a complete, self-contained
 * SVG that renders the requested subject. Returns the raw SVG markup string.
 */
export async function generateSvg(
  subject: string,
  options: { config?: AppConfig; signal?: AbortSignal; style?: string } = {},
): Promise<string> {
  const config = options.config ?? loadProviderConfig()
  const style = options.style ?? 'minimalist, clean, modern'

  const output = await completeChat({
    config,
    capability: 'llm',
    signal: options.signal,
    temperature: 0.2,
    maxTokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `你是一个 SVG 设计师。根据以下描述，生成一个纯 SVG 代码。`,
              `风格：${style}`,
              `要求：`,
              `- 输出仅包含 \`\`\`svg...\`\`\` 代码块，不要其他解释`,
              `- SVG 必须是自包含的，使用 viewBox`,
              `- 使用 800x600 尺寸`,
              `- 适合作为 Logo 或品牌标识`,
              `- 使用渐变、阴影等现代设计元素`,
              `- 保持简洁，易于缩放`,
              ``,
              `描述：${subject}`,
            ].join('\n'),
          },
        ],
      },
    ],
  })

  // Extract SVG from markdown code block
  const svgMatch = output.match(/```svg\s*([\s\S]*?)```/) || output.match(/```xml\s*([\s\S]*?)```/)
  if (svgMatch) return svgMatch[1].trim()

  // If no code block found but the output contains <svg>, extract it
  const svgTagMatch = output.match(/<svg[\s\S]*?<\/svg>/)
  if (svgTagMatch) return svgTagMatch[0]

  throw new MossError('LLM 未能生成有效的 SVG 代码', 502, 'invalid_svg')
}

/* ===== Obsidian Export ===== */

export interface ObsidianConfig {
  enabled: boolean
  vaultPath: string
  apiPort: number
  apiKey: string
  noteFolder: string
}

const OBSIDIAN_CONFIG_KEY = 'snooper.obsidian-config.v1'

export function loadObsidianConfig(): ObsidianConfig {
  try {
    const raw = localStorage.getItem(OBSIDIAN_CONFIG_KEY)
    if (raw) return JSON.parse(raw) as ObsidianConfig
  } catch { /* ignore */ }
  return {
    enabled: false,
    vaultPath: '',
    apiPort: 27124,
    apiKey: '',
    noteFolder: 'snooper-notes',
  }
}

export function saveObsidianConfig(config: ObsidianConfig) {
  try {
    localStorage.setItem(OBSIDIAN_CONFIG_KEY, JSON.stringify(config))
  } catch { /* ignore */ }
}

/**
 * Export a Markdown string to Obsidian via the Obsidian Local REST API plugin.
 * Falls back to a file download if the API is unreachable.
 */
export async function exportToObsidian(
  content: string,
  title: string,
  config?: ObsidianConfig,
): Promise<{ ok: boolean; method: 'rest-api' | 'download'; error?: string }> {
  const cfg = config ?? loadObsidianConfig()
  const fileName = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')}.md`
  const folder = cfg.noteFolder.replace(/^\/+|\/+$/g, '')

  if (cfg.enabled && cfg.apiPort > 0) {
    try {
      const res = await fetch(`http://localhost:${cfg.apiPort}/vault/${folder}/${encodeURIComponent(fileName)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/markdown',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: content,
      })
      if (res.ok) return { ok: true, method: 'rest-api' }
      return { ok: false, method: 'rest-api', error: `Obsidian API 返回 ${res.status}` }
    } catch (err: any) {
      // Fall through to download fallback
      console.warn('[snooper] Obsidian REST API unreachable, falling back to download:', err.message)
    }
  }

  // Fallback: download as .md file
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return { ok: true, method: 'download' }
}

import { MODEL_CATALOG } from './models'
import { uid } from './utils'
import { STORAGE_KEYS } from './brand'

export type ProviderProtocol = 'moss' | 'openai'
export type CapabilityKey = 'llm' | 'audio' | 'video' | 'image'
export type ProviderStatus = 'unknown' | 'ok' | 'error'

export interface ProviderProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  protocol: ProviderProtocol
  note: string
  /** Model ids pulled from `GET /models` for this provider. */
  models: string[]
  lastSyncedAt: number | null
  status: ProviderStatus
  lastError: string
}

export interface CapabilityRoute {
  providerId: string
  model: string
}

export interface AppConfig {
  providers: ProviderProfile[]
  routes: Record<CapabilityKey, CapabilityRoute>
}

export interface CapabilityMeta {
  key: CapabilityKey
  label: string
  short: string
  description: string
  fallbackModel: string
}

export const CAPABILITIES: readonly CapabilityMeta[] = [
  {
    key: 'llm',
    label: 'LLM · 对话与视觉',
    short: 'LLM',
    description: 'Chat、图片理解、字幕翻译统一走这条线路。',
    fallbackModel: 'moss-vl-1.0',
  },
  {
    key: 'audio',
    label: '音频 · 语音转写',
    short: 'AUDIO',
    description: '麦克风与标签页音频的分段转写（ASR）。',
    fallbackModel: 'moss-transcribe-1.0',
  },
  {
    key: 'video',
    label: '视频 · 实时画面',
    short: 'VIDEO',
    description: '低延迟视频画面理解；独立于音频与 LLM 路由。',
    fallbackModel: 'moss-vl-realtime-1.0',
  },
  {
    key: 'image',
    label: '图像 · 生成与创作',
    short: 'IMAGE',
    description: '文本/翻译驱动的 AI 图像生成与 SVG 矢量创作。',
    fallbackModel: 'moss-image-sft-1.0',
  },
] as const

export const PROVIDER_PROTOCOLS: readonly { value: ProviderProtocol; label: string; hint: string }[] = [
  {
    value: 'moss',
    label: 'MOSS 原生',
    hint: '官方 MOSS 网关，支持 VL / Transcribe / Realtime',
  },
  {
    value: 'openai',
    label: 'OpenAI 兼容中转',
    hint: '任何兼容 /chat/completions、/models 的中转服务',
  },
] as const

/** Per-capability model suggestions. Fetched `/models` results take priority. */
export const MODEL_SUGGESTIONS: Record<CapabilityKey, string[]> = {
  llm: MODEL_CATALOG.filter((model) => model.kind === 'chat' || model.kind === 'vision').map(
    (model) => model.id,
  ),
  audio: MODEL_CATALOG.filter((model) => model.kind === 'audio').map((model) => model.id),
  video: ['moss-vl-realtime-1.0', 'moss-vl-1.0'],
  image: [
    'moss-image-sft-1.0',
    'moss-image-base-1.0',
    'moss-image-sft-1.0-2026-10-09',
    'moss-image-base-1.0-2026-10-09',
    'black-forest-labs/FLUX.1-schnell',
    'stabilityai/stable-diffusion-3.5-medium',
    'stabilityai/stable-diffusion-xl-base-1.0',
  ],
}

const CONFIG_KEY = STORAGE_KEYS.providerConfig
const SESSION_CONFIG_KEY = STORAGE_KEYS.providerConfigSession
const LEGACY_CONFIG_KEYS = ['snooper.moss.config.v1', 'rtts.moss.config.v1'] as const

/**
 * Returns the session-scoped snapshot key for the current tab.
 * Each browser tab gets its own sessionStorage namespace, so two tabs
 * never share the active runtime config (API key + routes). The first
 * load in a tab hydrates from localStorage (global template) and then
 * materialises this session snapshot.
 */
const TAB_SESSION_KEY = 'snooper.provider-config.tab-id.v1'

export function getTabSessionId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_SESSION_KEY)
    if (existing) return existing
    const id = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    sessionStorage.setItem(TAB_SESSION_KEY, id)
    return id
  } catch {
    return `tab_${Date.now().toString(36)}`
  }
}

function parseStoredConfig(raw: string | null): AppConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    const providers =
      Array.isArray(parsed.providers) && parsed.providers.length
        ? parsed.providers.map(normalizeProvider)
        : DEFAULT_CONFIG.providers.map(normalizeProvider)
    return {
      providers,
      routes: {
        llm: { ...DEFAULT_CONFIG.routes.llm, ...parsed.routes?.llm },
        audio: { ...DEFAULT_CONFIG.routes.audio, ...parsed.routes?.audio },
        video: { ...DEFAULT_CONFIG.routes.video, ...parsed.routes?.video },
        image: { ...DEFAULT_CONFIG.routes.image, ...parsed.routes?.image },
      },
    }
  } catch {
    return null
  }
}

// Vite provides `import.meta.env` in the SPA. MV3 extension bundles are built
// with esbuild, where `import.meta` has no `env` property at runtime.
const env = import.meta.env ?? {}
const envKey = (env.VITE_MOSS_API_KEY ?? '').trim()
const envBaseUrl = (env.VITE_MOSS_BASE_URL ?? 'https://api.mosi.cn/v1').trim()

export function createProvider(partial: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: uid('provider'),
    name: '新服务商',
    baseUrl: 'https://api.mosi.cn/v1',
    apiKey: '',
    protocol: 'openai',
    note: '',
    models: [],
    lastSyncedAt: null,
    status: 'unknown',
    lastError: '',
    ...partial,
  }
}

export const DEFAULT_CONFIG: AppConfig = {
  providers: [
    {
      id: 'moss-official',
      name: 'MOSS 官方',
      baseUrl: envBaseUrl,
      apiKey: envKey,
      protocol: 'moss',
      note: '免费多模态模型矩阵 · 官方网关',
      models: [],
      lastSyncedAt: null,
      status: 'unknown',
      lastError: '',
    },
  ],
  routes: {
    llm: { providerId: 'moss-official', model: 'moss-vl-1.0' },
    audio: { providerId: 'moss-official', model: 'moss-transcribe-1.0' },
    video: { providerId: 'moss-official', model: 'moss-vl-realtime-1.0' },
    image: { providerId: 'moss-official', model: 'moss-image-sft-1.0' },
  },
}

/** Deep copy so resetting never mutates the module-level default object. */
export function createDefaultConfig(): AppConfig {
  return {
    providers: DEFAULT_CONFIG.providers.map((provider) => ({
      ...provider,
      models: [...provider.models],
    })),
    routes: {
      llm: { ...DEFAULT_CONFIG.routes.llm },
      audio: { ...DEFAULT_CONFIG.routes.audio },
      video: { ...DEFAULT_CONFIG.routes.video },
      image: { ...DEFAULT_CONFIG.routes.image },
    },
  }
}

function normalizeProvider(raw: Partial<ProviderProfile>): ProviderProfile {
  return {
    ...createProvider(),
    ...raw,
    models: Array.isArray(raw.models) ? raw.models.filter((model) => typeof model === 'string') : [],
    lastSyncedAt: typeof raw.lastSyncedAt === 'number' ? raw.lastSyncedAt : null,
    status: raw.status === 'ok' || raw.status === 'error' ? raw.status : 'unknown',
    lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
  }
}

interface LegacyConfig {
  apiKey?: string
  baseUrl?: string
  chatModel?: string
  visionModel?: string
  transcribeModel?: string
  realtimeModel?: string
  ttsModel?: string
}

function fromLegacy(legacy: LegacyConfig): AppConfig {
  const provider = normalizeProvider({
    id: 'moss-official',
    name: 'MOSS 官方',
    baseUrl: legacy.baseUrl?.trim() || envBaseUrl,
    apiKey: legacy.apiKey?.trim() || envKey,
    protocol: 'moss',
    note: '从旧版单网关配置迁移',
    status: 'unknown',
  })
  return {
    providers: [provider],
    routes: {
      llm: { providerId: provider.id, model: legacy.chatModel || legacy.visionModel || 'moss-vl-1.0' },
      audio: { providerId: provider.id, model: legacy.transcribeModel || 'moss-transcribe-1.0' },
      video: { providerId: provider.id, model: legacy.realtimeModel || 'moss-vl-realtime-1.0' },
      image: { providerId: provider.id, model: 'moss-image-sft-1.0' },
    },
  }
}

export function loadProviderConfig(): AppConfig {
  try {
    const sessionRaw = sessionStorage.getItem(SESSION_CONFIG_KEY)
    const session = parseStoredConfig(sessionRaw)
    if (session) return session

    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) {
      const parsed = parseStoredConfig(raw)
      if (parsed) {
        try {
          sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify(parsed))
        } catch {
          /* session snapshot best-effort */
        }
        return parsed
      }
    }

    for (const key of LEGACY_CONFIG_KEYS) {
      const legacyRaw = localStorage.getItem(key)
      if (legacyRaw) return fromLegacy(JSON.parse(legacyRaw) as LegacyConfig)
    }
  } catch {
    /* corrupted storage — fall back to defaults */
  }
  return {
    providers: DEFAULT_CONFIG.providers.map(normalizeProvider),
    routes: {
      llm: { ...DEFAULT_CONFIG.routes.llm },
      audio: { ...DEFAULT_CONFIG.routes.audio },
      video: { ...DEFAULT_CONFIG.routes.video },
      image: { ...DEFAULT_CONFIG.routes.image },
    },
  }
}

export function persistProviderConfig(config: AppConfig) {
  const json = JSON.stringify(config)
  try {
    localStorage.setItem(CONFIG_KEY, json)
  } catch {
    /* private mode / quota */
  }
  try {
    sessionStorage.setItem(SESSION_CONFIG_KEY, json)
  } catch {
    /* session snapshot best-effort */
  }
}

/** Returned when another tab modified the global template. Callers must not auto-overwrite the active runtime. */
export interface ExternalConfigUpdate {
  config: AppConfig
  at: number
}

/** Attempt to parse a cross-tab storage payload without touching current runtime state. */
export function parseExternalConfig(raw: string | null): ExternalConfigUpdate | null {
  if (!raw) return null
  const config = parseStoredConfig(raw)
  if (!config) return null
  return { config, at: Date.now() }
}

export function getProvider(config: AppConfig, providerId: string): ProviderProfile | undefined {
  return config.providers.find((provider) => provider.id === providerId)
}

export function maskSecret(secret: string) {
  const value = secret.trim()
  if (!value) return '未设置'
  if (value.length <= 14) return `${value.slice(0, 3)}••••`
  return `${value.slice(0, 7)}••••••${value.slice(-4)}`
}

export interface ResolvedRoute {
  provider: ProviderProfile
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  protocol: ProviderProtocol
}

/**
 * Resolve the provider + model for one capability. Each lane is independent:
 * audio can point at a cheap relay while LLM stays on MOSS.
 */
export function resolveRoute(
  config: AppConfig,
  capability: CapabilityKey,
  modelOverride?: string,
): ResolvedRoute {
  const route = config.routes[capability] ?? DEFAULT_CONFIG.routes[capability]
  const provider = getProvider(config, route.providerId)
  if (!provider) {
    if (config.providers.length === 0) {
      throw new Error('尚未配置任何服务商，请先在「能力设置」中添加。')
    }
    throw new Error(`能力「${capability}」绑定的服务商不存在或已被删除，请在「能力设置」中重新选择。`)
  }
  const baseUrl = provider.baseUrl.trim()
  const apiKey = provider.apiKey.trim()
  if (!baseUrl) throw new Error(`服务商「${provider.name}」缺少 Base URL。`)
  if (!apiKey) throw new Error(`服务商「${provider.name}」缺少 API Key。`)
  const model = (modelOverride || route.model || '').trim()
  if (!model) throw new Error(`能力「${capability}」尚未选择模型。`)
  return {
    provider,
    providerId: provider.id,
    baseUrl,
    apiKey,
    model,
    protocol: provider.protocol,
  }
}

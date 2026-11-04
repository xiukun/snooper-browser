import { computed, reactive, ref, watch } from 'vue'
import { listModels } from '@/lib/moss'
import {
  CAPABILITIES,
  type AppConfig,
  type CapabilityKey,
  type CapabilityRoute,
  type ProviderProfile,
  createDefaultConfig,
  createProvider,
  getProvider,
  loadProviderConfig,
  maskSecret,
  persistProviderConfig,
  resolveRoute,
} from '@/lib/providers'

const settings = reactive<AppConfig>(loadProviderConfig())
const syncingId = ref('')
const verifyError = ref('')
const lastTest = ref<{
  providerId: string
  ok: boolean
  count: number
  message: string
} | null>(null)

let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(
  settings,
  () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => persistProviderConfig(JSON.parse(JSON.stringify(settings)) as AppConfig), 180)
  },
  { deep: true },
)

function safeRoute(capability: CapabilityKey) {
  try {
    return resolveRoute(settings, capability)
  } catch {
    return null
  }
}

const llmRoute = computed(() => safeRoute('llm'))
const audioRoute = computed(() => safeRoute('audio'))
const videoRoute = computed(() => safeRoute('video'))
const isConfigured = computed(() => Boolean(llmRoute.value))
const maskedKey = computed(() => maskSecret(settings.providers[0]?.apiKey ?? ''))
const routeModels = computed(() => ({
  llm: settings.routes.llm.model,
  audio: settings.routes.audio.model,
  video: settings.routes.video.model,
}))

function addProvider(partial: Partial<ProviderProfile> = {}) {
  const provider = createProvider(partial)
  settings.providers.push(provider)
  return provider
}

function updateProvider(id: string, patch: Partial<ProviderProfile>) {
  const provider = getProvider(settings, id)
  if (!provider) return
  Object.assign(provider, patch)
}

function removeProvider(id: string) {
  if (settings.providers.length <= 1) return false
  settings.providers = settings.providers.filter((provider) => provider.id !== id)
  const fallback = settings.providers[0]
  if (!fallback) return false
  for (const capability of CAPABILITIES) {
    if (settings.routes[capability.key].providerId === id) {
      settings.routes[capability.key] = {
        providerId: fallback.id,
        model: settings.routes[capability.key].model || capability.fallbackModel,
      }
    }
  }
  return true
}

function setRoute(capability: CapabilityKey, patch: Partial<CapabilityRoute>) {
  settings.routes[capability] = { ...settings.routes[capability], ...patch }
}

function setRouteProvider(capability: CapabilityKey, providerId: string) {
  const provider = getProvider(settings, providerId)
  const meta = CAPABILITIES.find((item) => item.key === capability)
  const current = settings.routes[capability].model
  const nextModel =
    provider?.models.find((model) => model === current) ??
    provider?.models[0] ??
    current ??
    meta?.fallbackModel ??
    ''
  setRoute(capability, { providerId, model: nextModel })
}

function setRouteModel(capability: CapabilityKey, model: string) {
  setRoute(capability, { model })
}

/**
 * Pull `/models` for one provider and persist the result on its profile.
 * Every provider is independent, so relays and the official gateway can be
 * refreshed without touching each other.
 */
async function syncProvider(id: string) {
  const provider = getProvider(settings, id)
  if (!provider) return { ok: false as const, message: '服务商不存在' }
  syncingId.value = id
  verifyError.value = ''
  try {
    const models = await listModels(provider)
    provider.models = models
    provider.lastSyncedAt = Date.now()
    provider.status = 'ok'
    provider.lastError = ''
    lastTest.value = { providerId: id, ok: true, count: models.length, message: '' }
    return { ok: true as const, count: models.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : '拉取模型失败'
    provider.status = 'error'
    provider.lastError = message
    verifyError.value = message
    lastTest.value = { providerId: id, ok: false, count: 0, message }
    return { ok: false as const, message }
  } finally {
    syncingId.value = ''
  }
}

/** Backwards-compatible alias used by the topbar and settings actions. */
async function testConnection() {
  const provider = settings.providers[0]
  if (!provider) return { ok: false as const, message: '尚未配置服务商' }
  const result = await syncProvider(provider.id)
  return result.ok
    ? { ok: true as const, count: result.count }
    : { ok: false as const, message: result.message }
}

function reset() {
  const defaults = createDefaultConfig()
  settings.providers = defaults.providers
  settings.routes = defaults.routes
  verifyError.value = ''
  lastTest.value = null
}

export function useSettings() {
  return {
    settings,
    config: computed<AppConfig>(() => settings),
    providers: computed(() => settings.providers),
    capabilities: CAPABILITIES,
    llmRoute,
    audioRoute,
    videoRoute,
    routeModels,
    syncingId,
    verifyError,
    lastTest,
    isConfigured,
    maskedKey,
    addProvider,
    updateProvider,
    removeProvider,
    setRoute,
    setRouteProvider,
    setRouteModel,
    syncProvider,
    testConnection,
    reset,
  }
}

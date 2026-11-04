<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  AudioLines,
  Boxes,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  GitBranch,
  KeyRound,
  LoaderCircle,
  MessagesSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-vue-next'
import FieldSelect from '@/components/ui/FieldSelect.vue'
import { useSettings } from '@/composables/useSettings'
import { BRAND } from '@/lib/brand'
import {
  CAPABILITIES,
  MODEL_SUGGESTIONS,
  PROVIDER_PROTOCOLS,
  type CapabilityKey,
  type ProviderProfile,
} from '@/lib/providers'

const {
  settings,
  providers,
  syncingId,
  isConfigured,
  addProvider,
  updateProvider,
  removeProvider,
  setRouteProvider,
  syncProvider,
  reset,
} = useSettings()

const selectedId = ref(providers.value[0]?.id ?? '')
const revealId = ref('')
const pendingDelete = ref<ProviderProfile | null>(null)
const pendingReset = ref(false)

watch(
  providers,
  (list) => {
    if (!list.length) {
      selectedId.value = ''
      return
    }
    if (!list.some((provider) => provider.id === selectedId.value)) {
      selectedId.value = list[0]!.id
    }
  },
  { deep: false },
)

const selected = computed(
  () => providers.value.find((provider) => provider.id === selectedId.value) ?? null,
)

const protocolOptions = PROVIDER_PROTOCOLS.map((item) => ({ value: item.value, label: item.label }))

const capabilityMeta: Record<
  CapabilityKey,
  { icon: typeof MessagesSquare; accent: string; dot: string; ring: string }
> = {
  llm: {
    icon: MessagesSquare,
    accent: 'text-iris-300',
    dot: 'bg-iris-400',
    ring: 'border-iris-400/25 bg-iris-500/[0.06]',
  },
  audio: {
    icon: AudioLines,
    accent: 'text-aqua-300',
    dot: 'bg-aqua-400',
    ring: 'border-aqua-400/25 bg-aqua-500/[0.06]',
  },
  video: {
    icon: Video,
    accent: 'text-amber-glow',
    dot: 'bg-amber-glow',
    ring: 'border-amber-glow/25 bg-amber-glow/[0.05]',
  },
}

const routeProvider = (key: CapabilityKey) =>
  providers.value.find((provider) => provider.id === settings.routes[key].providerId) ?? null

function modelOptions(key: CapabilityKey) {
  const provider = routeProvider(key)
  const pulled = provider?.models ?? []
  return [...new Set([...pulled, ...(MODEL_SUGGESTIONS[key] ?? []), settings.routes[key].model])].filter(
    Boolean,
  )
}

function providerOptions() {
  return providers.value.map((provider) => ({ value: provider.id, label: provider.name }))
}

function hostOf(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '') || '未填写地址'
}

function formatStamp(ts: number | null) {
  if (!ts) return '尚未拉取'
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusTone(provider: ProviderProfile) {
  if (provider.status === 'ok') return { label: '可用', dot: 'bg-aqua-400', text: 'text-aqua-300' }
  if (provider.status === 'error')
    return { label: '异常', dot: 'bg-rose-glow', text: 'text-rose-200' }
  if (!provider.apiKey)
    return { label: '待配置', dot: 'bg-mist-500', text: 'text-mist-400' }
  return { label: '待验证', dot: 'bg-mist-500', text: 'text-mist-400' }
}

function addProviderProfile() {
  const provider = addProvider({
    name: `中转服务商 ${providers.value.length + 1}`,
    protocol: 'openai',
    note: 'OpenAI 兼容中转',
  })
  selectedId.value = provider.id
  toast.success('已添加服务商，填入 Base URL 与 Key 后拉取模型')
}

async function pullModels(provider: ProviderProfile) {
  if (syncingId.value) return
  const result = await syncProvider(provider.id)
  if (result.ok) {
    toast.success(`已从 ${hostOf(provider.baseUrl)} 拉取 ${result.count} 个模型`)
    if (!settings.routes.llm.model && provider.models[0]) {
      settings.routes.llm.model = provider.models[0]
    }
  } else {
    toast.error(`拉取失败：${result.message}`)
  }
}

function requestDelete(provider: ProviderProfile) {
  if (providers.value.length <= 1) {
    toast.error('至少保留一个服务商')
    return
  }
  pendingDelete.value = provider
}

function confirmDelete() {
  const provider = pendingDelete.value
  pendingDelete.value = null
  if (!provider) return
  const ok = removeProvider(provider.id)
  toast[ok ? 'success' : 'error'](ok ? '服务商已移除，相关路由已回退' : '无法移除该服务商')
}

function onRouteProvider(key: CapabilityKey, providerId: string) {
  setRouteProvider(key, providerId)
  const provider = providers.value.find((item) => item.id === providerId)
  if (provider && !provider.models.length) {
    toast.info(`「${provider.name}」还没有模型列表，可在上方拉取`)
  }
}

function confirmReset() {
  pendingReset.value = true
}

function doReset() {
  pendingReset.value = false
  reset()
  selectedId.value = providers.value[0]?.id ?? ''
  toast.info('已恢复默认配置')
}

const canRemoveSelected = computed(() => providers.value.length > 1)
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-[1180px] space-y-4 px-4 pt-4 pb-10 sm:px-6 lg:px-8">
      <!-- Control strip -->
      <div class="glass flex flex-wrap items-center gap-2 rounded-2xl p-2">
        <div class="flex items-center gap-2 px-1.5">
          <span class="relative flex h-1.5 w-1.5">
            <span
              class="relative inline-flex h-1.5 w-1.5 rounded-full"
              :class="isConfigured ? 'bg-aqua-400' : 'bg-amber-glow'"
            />
          </span>
          <span class="text-[11.5px] font-medium" :class="isConfigured ? 'text-aqua-300' : 'text-amber-glow'">
            {{ isConfigured ? 'LLM 路由就绪' : '等待配置' }}
          </span>
          <span class="hidden font-mono text-[10px] text-mist-600 sm:inline">
            {{ providers.length }} 家服务商 · 3 条能力路由
          </span>
        </div>

        <div class="ml-auto flex items-center gap-1.5">
          <span class="hidden items-center gap-1 rounded-full border border-white/7 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-mist-500 md:inline-flex">
            <Check class="h-3 w-3 text-aqua-400" />
            改动自动保存
          </span>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-mist-400 transition-colors hover:bg-white/5 hover:text-mist-100"
            @click="confirmReset"
          >
            <RotateCcw class="h-3.5 w-3.5" />
            恢复默认
          </button>
        </div>
      </div>

      <!-- Providers -->
      <section class="glass overflow-hidden rounded-2xl">
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 px-4 py-3">
          <div class="flex items-center gap-2">
            <Server class="h-4 w-4 text-iris-300" />
            <h2 class="text-[13px] font-medium text-mist-100">服务商</h2>
            <span class="rounded-full bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-mist-500">
              {{ providers.length }}
            </span>
          </div>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-iris-400/25 bg-iris-500/10 px-3 text-[11.5px] font-medium text-iris-200 transition-colors hover:bg-iris-500/18"
            @click="addProviderProfile"
          >
            <Plus class="h-3.5 w-3.5" />
            添加服务商
          </button>
        </header>

        <div class="grid lg:grid-cols-[286px_minmax(0,1fr)]">
          <!-- Provider rail -->
          <div class="border-b border-white/6 p-2 lg:border-r lg:border-b-0">
            <button
              v-for="provider in providers"
              :key="provider.id"
              type="button"
              class="group mb-1 flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors"
              :class="
                provider.id === selectedId
                  ? 'bg-white/[0.07]'
                  : 'hover:bg-white/[0.035]'
              "
              @click="selectedId = provider.id"
            >
              <span class="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full" :class="statusTone(provider).dot" />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span
                    class="truncate text-[12.5px] font-medium"
                    :class="provider.id === selectedId ? 'text-white' : 'text-mist-200'"
                  >
                    {{ provider.name }}
                  </span>
                  <span
                    v-if="provider.protocol === 'moss'"
                    class="shrink-0 rounded border border-white/8 bg-white/[0.04] px-1 py-px font-mono text-[9px] text-mist-500"
                  >
                    MOSS
                  </span>
                </span>
                <span class="mt-0.5 block truncate font-mono text-[10px] text-mist-500">
                  {{ hostOf(provider.baseUrl) }}
                </span>
                <span class="mt-1 flex items-center gap-2 font-mono text-[9.5px] text-mist-600">
                  <span>{{ provider.models.length }} 模型</span>
                  <span class="text-mist-600/60">·</span>
                  <span :class="statusTone(provider).text">{{ statusTone(provider).label }}</span>
                </span>
              </span>
              <span
                v-if="syncingId === provider.id"
                class="mt-1 shrink-0 text-iris-300"
              >
                <LoaderCircle class="h-3.5 w-3.5 animate-spin" />
              </span>
            </button>

            <p class="px-2.5 pt-2 pb-1 text-[10.5px] leading-relaxed text-mist-600">
              每家服务商独立保存地址与密钥。可同时接入官方网关与第三方中转。
            </p>
          </div>

          <!-- Provider editor -->
          <div v-if="selected" class="min-w-0 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-iris-500/12 text-iris-300">
                  <Server class="h-4 w-4" />
                </div>
                <div>
                  <p class="text-[12.5px] font-medium text-mist-100">{{ selected.name }}</p>
                  <p class="font-mono text-[9.5px] text-mist-600">
                    {{ selected.protocol === 'moss' ? 'MOSS protocol' : 'OpenAI compatible' }} · {{ statusTone(selected).label }}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11px] text-mist-300 transition-colors hover:border-iris-400/35 hover:text-iris-200 disabled:opacity-50"
                  :disabled="Boolean(syncingId)"
                  @click="pullModels(selected)"
                >
                  <RefreshCw class="h-3 w-3" :class="syncingId === selected.id ? 'animate-spin' : ''" />
                  拉取模型
                </button>
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 text-mist-500 transition-colors hover:border-rose-glow/30 hover:text-rose-200 disabled:opacity-30"
                  :disabled="!canRemoveSelected"
                  aria-label="删除服务商"
                  @click="requestDelete(selected)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div class="mt-3.5 grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="field-label">名称</span>
                <input
                  v-model="selected.name"
                  class="field-input"
                  placeholder="例如：MOSS 官方 / 某某中转"
                />
              </label>

              <FieldSelect
                :model-value="selected.protocol"
                label="协议"
                :options="protocolOptions"
                @update:model-value="(value: string) => updateProvider(selected?.id ?? '', { protocol: value as ProviderProfile['protocol'] })"
              />

              <label class="block">
                <span class="field-label">Base URL</span>
                <input
                  v-model="selected.baseUrl"
                  class="field-input font-mono text-[11.5px]"
                  placeholder="https://api.mosi.cn/v1"
                  spellcheck="false"
                />
                <span class="mt-1 block font-mono text-[9.5px] text-mist-600">
                  GET {{ hostOf(selected.baseUrl) }}/models
                </span>
              </label>

              <label class="block">
                <span class="field-label">API Key</span>
                <span class="relative block">
                  <input
                    v-model="selected.apiKey"
                    :type="revealId === selected.id ? 'text' : 'password'"
                    class="field-input pr-10 font-mono text-[11.5px]"
                    placeholder="sk-..."
                    spellcheck="false"
                    autocomplete="off"
                  />
                  <button
                    type="button"
                    class="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-mist-500 transition-colors hover:text-mist-200"
                    :aria-label="revealId === selected.id ? '隐藏密钥' : '显示密钥'"
                    @click="revealId = revealId === selected.id ? '' : selected.id"
                  >
                    <EyeOff v-if="revealId === selected.id" class="h-3.5 w-3.5" />
                    <Eye v-else class="h-3.5 w-3.5" />
                  </button>
                </span>
                <span class="mt-1 flex items-center gap-1 font-mono text-[9.5px] text-mist-600">
                  <KeyRound class="h-2.5 w-2.5" />
                  仅保存在本机 localStorage，不上传
                </span>
              </label>

              <label class="block sm:col-span-2">
                <span class="field-label">备注（可选）</span>
                <input
                  v-model="selected.note"
                  class="field-input"
                  placeholder="例如：低价中转，仅用于音频转写"
                />
              </label>
            </div>

            <div
              v-if="selected.lastError"
              class="mt-3 flex items-start gap-2 rounded-xl border border-rose-glow/25 bg-rose-glow/8 px-3 py-2 text-[11px] text-rose-200"
            >
              <CircleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span class="leading-relaxed">{{ selected.lastError }}</span>
            </div>

            <div class="mt-3.5 rounded-xl border border-white/7 bg-black/20 p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="field-label mb-0">可用模型</span>
                <span class="font-mono text-[9.5px] text-mist-600">
                  {{ selected.models.length }} 个 · {{ formatStamp(selected.lastSyncedAt) }}
                </span>
              </div>
              <div v-if="selected.models.length" class="mt-2 flex flex-wrap gap-1.5">
                <span
                  v-for="model in selected.models"
                  :key="model"
                  class="chip max-w-full truncate normal-case tracking-normal text-mist-300"
                >
                  {{ model }}
                </span>
              </div>
              <p v-else class="mt-1.5 text-[11px] leading-relaxed text-mist-500">
                还没有模型列表。点击「拉取模型」调用 /models，或用下方能力卡手动填入模型 ID。
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Capability routes -->
      <section class="space-y-2">
        <div class="flex items-center justify-between px-1">
          <div class="flex items-center gap-2">
            <Boxes class="h-4 w-4 text-iris-300" />
            <h2 class="text-[13px] font-medium text-mist-100">能力路由</h2>
          </div>
          <span class="font-mono text-[10px] text-mist-600">LLM / AUDIO / VIDEO 独立解析</span>
        </div>

        <div class="grid gap-3 lg:grid-cols-3">
          <article
            v-for="capability in CAPABILITIES"
            :key="capability.key"
            class="glass rounded-2xl p-4"
          >
            <div class="flex items-start gap-2.5">
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
                :class="capabilityMeta[capability.key].ring"
              >
                <component
                  :is="capabilityMeta[capability.key].icon"
                  class="h-4 w-4"
                  :class="capabilityMeta[capability.key].accent"
                />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <h3 class="text-[12.5px] font-medium text-mist-100">{{ capability.label }}</h3>
                </div>
                <p class="mt-0.5 text-[10.5px] leading-relaxed text-mist-500">
                  {{ capability.description }}
                </p>
              </div>
            </div>

            <div class="mt-3 space-y-2.5">
              <FieldSelect
                :model-value="settings.routes[capability.key].providerId"
                label="服务商"
                compact
                :options="providerOptions()"
                @update:model-value="(value: string) => onRouteProvider(capability.key, value)"
              />

              <label class="block">
                <span class="field-label">模型 ID</span>
                <input
                  v-model="settings.routes[capability.key].model"
                  class="field-input font-mono text-[11.5px]"
                  :placeholder="capability.fallbackModel"
                  spellcheck="false"
                  :list="`models-${capability.key}`"
                />
                <datalist :id="`models-${capability.key}`">
                  <option v-for="model in modelOptions(capability.key)" :key="model" :value="model" />
                </datalist>
              </label>
            </div>

            <div class="mt-3 flex items-center justify-between gap-2 border-t border-white/6 pt-2.5">
              <span class="flex min-w-0 items-center gap-1.5 font-mono text-[9.5px] text-mist-600">
                <span class="h-1 w-1 shrink-0 rounded-full" :class="capabilityMeta[capability.key].dot" />
                <span class="truncate">{{ routeProvider(capability.key)?.name ?? '未选择服务商' }}</span>
              </span>
              <span class="shrink-0 font-mono text-[9.5px] text-mist-600">
                {{ routeProvider(capability.key)?.models.length ?? 0 }} 可选
              </span>
            </div>
          </article>
        </div>

        <p class="px-1 text-[10.5px] leading-relaxed text-mist-600">
          字幕链路 = 音频转写（AUDIO）+ 上下文翻译（LLM）；视频路由用于低延迟画面理解，可单独指向支持实时的中转。
        </p>
      </section>

      <!-- Open source card -->
      <section class="glass-soft rounded-2xl p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-2.5">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-aqua-500/10 text-aqua-300">
              <ShieldCheck class="h-4 w-4" />
            </div>
            <div>
              <p class="flex items-center gap-2 text-[12.5px] font-medium text-mist-100">
                {{ BRAND.product }}
                <span class="chip py-0 text-[9.5px]">v{{ BRAND.version }}</span>
              </p>
              <p class="mt-1 max-w-[560px] text-[10.5px] leading-relaxed text-mist-500">
                浏览器直连你配置的服务商：密钥、模型与路由都保存在本机，仓库不含任何内置凭据。
                音频仅在分段转写时发送给你选定的服务商。
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <a
              :href="BRAND.repoUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11px] text-mist-300 transition-colors hover:border-white/20 hover:text-white"
            >
              <GitBranch class="h-3 w-3" />
              源码
            </a>
            <span class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/8 px-2.5 font-mono text-[10px] text-mist-500">
              <Sparkles class="h-3 w-3" />
              {{ BRAND.license }}
            </span>
          </div>
        </div>
        <div class="mt-3 grid gap-2 border-t border-white/6 pt-3 text-[10.5px] text-mist-500 sm:grid-cols-2">
          <p class="flex items-start gap-1.5">
            <Check class="mt-0.5 h-3 w-3 shrink-0 text-aqua-400" />
            LLM 路由同时服务对话、图片理解与字幕翻译。
          </p>
          <p class="flex items-start gap-1.5">
            <Check class="mt-0.5 h-3 w-3 shrink-0 text-aqua-400" />
            兼容任何实现 /chat/completions 与 /models 的中转。
          </p>
        </div>
      </section>
    </div>

    <!-- Reset confirm -->
    <div
      v-if="pendingReset"
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4 backdrop-blur-sm"
      @click.self="pendingReset = false"
    >
      <div class="glass-strong w-full max-w-sm rounded-2xl p-5">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-[14px] font-semibold text-white">恢复默认配置？</h3>
          <button
            type="button"
            class="rounded-md p-1 text-mist-500 transition-colors hover:text-mist-200"
            aria-label="关闭"
            @click="pendingReset = false"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
        <p class="mt-2 text-[11.5px] leading-relaxed text-mist-400">
          自定义服务商、密钥与三条能力路由都会被清除，并重建默认的 MOSS 官方服务商。
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-white/10 px-3 py-1.5 text-[11.5px] text-mist-300 hover:bg-white/5"
            @click="pendingReset = false"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-lg border border-amber-glow/30 bg-amber-glow/15 px-3 py-1.5 text-[11.5px] text-amber-glow hover:bg-amber-glow/25"
            @click="doReset"
          >
            恢复默认
          </button>
        </div>
      </div>
    </div>

    <!-- Delete provider confirm -->
    <div
      v-if="pendingDelete"
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4 backdrop-blur-sm"
      @click.self="pendingDelete = null"
    >
      <div class="glass-strong w-full max-w-sm rounded-2xl p-5">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-[14px] font-semibold text-white">移除服务商？</h3>
          <button
            type="button"
            class="rounded-md p-1 text-mist-500 transition-colors hover:text-mist-200"
            aria-label="关闭"
            @click="pendingDelete = null"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
        <p class="mt-2 text-[11.5px] leading-relaxed text-mist-400">
          「{{ pendingDelete.name }}」及其密钥会被删除，指向它的能力路由会回退到第一家服务商。
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-white/10 px-3 py-1.5 text-[11.5px] text-mist-300 hover:bg-white/5"
            @click="pendingDelete = null"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-lg border border-rose-glow/30 bg-rose-glow/15 px-3 py-1.5 text-[11.5px] text-rose-200 hover:bg-rose-glow/25"
            @click="confirmDelete"
          >
            移除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

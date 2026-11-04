<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ImagePlus,
  Layers,
  Maximize2,
  ScanEye,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-vue-next'
import { useVision } from '@/composables/useVision'
import { useSettings } from '@/composables/useSettings'
import { renderMarkdown } from '@/lib/markdown'
import { formatBytes, formatClock } from '@/lib/utils'

const {
  images,
  runs,
  activeRun,
  isAnalyzing,
  error,
  presets,
  addFiles,
  removeImage,
  clearImages,
  analyze,
  stop,
  clearHistory,
} = useVision()

const { routeModels, isConfigured } = useSettings()

const prompt = ref('')
const activePreset = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const lightbox = ref('')
const expanded = ref<string[]>([])
const copiedId = ref('')

const history = computed(() => runs.value.slice(1))

function renderContent(content: string) {
  return renderMarkdown(content)
}

function pickFiles() {
  fileInput.value?.click()
}

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) void addFiles(input.files)
  input.value = ''
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  if (event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files)
}

function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith('image/'),
  )
  if (!files.length) return
  event.preventDefault()
  void addFiles(files)
}

function usePreset(id: string, text: string) {
  activePreset.value = id
  prompt.value = text
}

async function run() {
  if (isAnalyzing.value) return
  if (!isConfigured.value) {
    toast.error('请先在「能力设置」中配置 LLM 服务商')
    return
  }
  const text = prompt.value.trim() || '请全面解析这张图片：说明整体场景、主体与关键细节，并提取所有可见文字。'
  await analyze(text)
}

async function copyText(id: string, content: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content)
    } else {
      const helper = document.createElement('textarea')
      helper.value = content
      helper.style.position = 'fixed'
      helper.style.opacity = '0'
      document.body.appendChild(helper)
      helper.select()
      document.execCommand('copy')
      document.body.removeChild(helper)
    }
    copiedId.value = id
    window.setTimeout(() => {
      if (copiedId.value === id) copiedId.value = ''
    }, 1600)
    toast.success('已复制结果')
  } catch {
    toast.error('复制失败')
  }
}

function toggleExpanded(id: string) {
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter((item) => item !== id)
    : [...expanded.value, id]
}

function statusLabel(status: string) {
  if (status === 'streaming') return '分析中'
  if (status === 'error') return '失败'
  return '完成'
}
</script>

<template>
  <div
    class="h-full overflow-y-auto"
    @dragover.prevent="isDragging = true"
    @dragleave.self="isDragging = false"
    @drop.prevent="onDrop"
    @paste="onPaste"
  >
    <div class="mx-auto w-full max-w-[1320px] px-4 pt-4 pb-10 sm:px-6 lg:px-8">
      <!-- Toolbar -->
      <div class="glass flex flex-wrap items-center gap-2 rounded-2xl p-2">
        <div class="flex items-center gap-2 px-1.5">
          <ScanEye class="h-4 w-4 text-amber-glow" />
          <span class="text-[11.5px] font-medium text-mist-200">视觉解析</span>
          <span class="rounded-full border border-white/7 bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-mist-500">
            {{ isConfigured ? routeModels.llm : '未配置模型' }}
          </span>
        </div>
        <div class="ml-auto flex items-center gap-1.5">
          <span class="hidden font-mono text-[10px] text-mist-600 md:inline">
            {{ images.length }}/10 张 · 单图 ≤ 20MB
          </span>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-mist-400 transition-colors hover:bg-white/5 hover:text-mist-100 disabled:opacity-40"
            :disabled="!runs.length"
            @click="clearHistory"
          >
            <Trash2 class="h-3.5 w-3.5" />
            清空历史
          </button>
        </div>
      </div>

      <div class="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <!-- Result column (left, wide) -->
        <section
          class="min-w-0 space-y-4 xl:order-1"
          :class="activeRun ? 'order-1' : 'order-2'"
        >
          <article
            v-if="activeRun"
            class="glass overflow-hidden rounded-2xl"
          >
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 px-4 py-3">
              <div class="flex min-w-0 items-center gap-2">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px]"
                  :class="
                    activeRun.status === 'error'
                      ? 'border-rose-glow/30 bg-rose-glow/10 text-rose-200'
                      : 'border-amber-glow/25 bg-amber-glow/8 text-amber-glow'
                  "
                >
                  <span
                    class="h-1 w-1 rounded-full"
                    :class="
                      activeRun.status === 'streaming'
                        ? 'animate-pulse bg-amber-glow'
                        : activeRun.status === 'error'
                          ? 'bg-rose-glow'
                          : 'bg-aqua-400'
                    "
                  />
                  {{ statusLabel(activeRun.status) }}
                </span>
                <span class="truncate font-mono text-[10px] text-mist-500">
                  {{ activeRun.images.length }} 图 · {{ activeRun.model }}
                </span>
                <span class="hidden font-mono text-[10px] text-mist-600 sm:inline">
                  {{ formatClock(activeRun.createdAt) }}
                </span>
              </div>
              <div class="flex items-center gap-1.5">
                <button
                  v-if="isAnalyzing"
                  type="button"
                  class="inline-flex h-7 items-center gap-1.5 rounded-md border border-rose-glow/30 bg-rose-glow/12 px-2 text-[10.5px] text-rose-200 hover:bg-rose-glow/20"
                  @click="stop"
                >
                  <Square class="h-2.5 w-2.5 fill-current" />
                  停止
                </button>
                <button
                  v-else
                  type="button"
                  class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] text-mist-500 transition-colors hover:bg-white/5 hover:text-mist-200"
                  @click="copyText(activeRun.id, activeRun.content)"
                >
                  <Check v-if="copiedId === activeRun.id" class="h-3 w-3 text-aqua-300" />
                  <Copy v-else class="h-3 w-3" />
                  {{ copiedId === activeRun.id ? '已复制' : '复制' }}
                </button>
              </div>
            </div>

            <div class="flex gap-2 overflow-x-auto border-b border-white/6 bg-black/20 px-4 py-2.5">
              <button
                v-for="(image, index) in activeRun.images"
                :key="index"
                type="button"
                class="group relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10"
                @click="lightbox = image"
              >
                <img :src="image" alt="" class="h-full w-full object-cover" />
                <span
                  class="absolute inset-0 flex items-center justify-center bg-ink-950/55 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Maximize2 class="h-3.5 w-3.5 text-white" />
                </span>
              </button>
            </div>

            <div class="border-b border-white/6 px-4 py-2.5">
              <p class="line-clamp-2 text-[11px] leading-relaxed text-mist-500">
                <span class="mr-1.5 font-mono text-[9.5px] tracking-[0.14em] text-amber-glow/70 uppercase">query</span>
                {{ activeRun.prompt }}
              </p>
            </div>

            <div class="relative p-4 sm:p-5">
              <div
                v-if="!activeRun.content && isAnalyzing"
                class="flex flex-col items-center justify-center gap-3 py-14"
              >
                <span class="relative flex h-10 w-10 items-center justify-center">
                  <span class="absolute inset-0 animate-breathe rounded-full border border-amber-glow/30" />
                  <Camera class="h-4 w-4 text-amber-glow" />
                </span>
                <p class="font-mono text-[10.5px] tracking-[0.16em] text-mist-500 uppercase">
                  Analyzing image…
                </p>
              </div>
              <div
                v-else
                class="prose-snooper max-h-[560px] overflow-y-auto pr-1"
                :class="activeRun.status === 'error' ? 'text-rose-200' : ''"
                v-html="renderContent(activeRun.content)"
              />
            </div>
          </article>

          <!-- Empty state -->
          <article v-else class="glass rounded-2xl px-5 py-10 text-center sm:py-14">
            <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-glow/20 bg-amber-glow/8 text-amber-glow">
              <Layers class="h-6 w-6" />
            </div>
            <h2 class="mt-4 text-lg font-semibold tracking-[-0.02em] text-white">
              让图片自己说话
            </h2>
            <p class="mx-auto mt-2 max-w-sm text-[12px] leading-relaxed text-mist-400">
              截图、表格、图表、代码或商品图，上传后直接提问。结果以 Markdown 呈现，代码自动高亮。
            </p>
            <div class="mx-auto mt-6 grid max-w-lg gap-2 text-left sm:grid-cols-2">
              <div class="rounded-xl border border-white/7 bg-white/[0.02] p-3">
                <span class="font-mono text-[9.5px] tracking-[0.14em] text-amber-glow/70 uppercase">OCR</span>
                <p class="mt-1 text-[11px] text-mist-300">表格与票据结构化还原</p>
              </div>
              <div class="rounded-xl border border-white/7 bg-white/[0.02] p-3">
                <span class="font-mono text-[9.5px] tracking-[0.14em] text-amber-glow/70 uppercase">Chart</span>
                <p class="mt-1 text-[11px] text-mist-300">趋势、异常与结论</p>
              </div>
              <div class="rounded-xl border border-white/7 bg-white/[0.02] p-3">
                <span class="font-mono text-[9.5px] tracking-[0.14em] text-amber-glow/70 uppercase">Code</span>
                <p class="mt-1 text-[11px] text-mist-300">截图代码还原并诊断</p>
              </div>
              <div class="rounded-xl border border-white/7 bg-white/[0.02] p-3">
                <span class="font-mono text-[9.5px] tracking-[0.14em] text-amber-glow/70 uppercase">Product</span>
                <p class="mt-1 text-[11px] text-mist-300">卖点、材质与受众</p>
              </div>
            </div>
          </article>

          <!-- History -->
          <section v-if="history.length" class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <h3 class="text-[12px] font-medium text-mist-200">历史记录</h3>
              <span class="font-mono text-[10px] text-mist-600">{{ history.length }} 条</span>
            </div>
            <article
              v-for="run in history"
              :key="run.id"
              class="glass-soft overflow-hidden rounded-xl"
            >
              <button
                type="button"
                class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
                @click="toggleExpanded(run.id)"
              >
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="run.status === 'error' ? 'bg-rose-glow' : 'bg-amber-glow/80'"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[11.5px] text-mist-200">{{ run.prompt }}</span>
                  <span class="mt-0.5 block font-mono text-[9.5px] text-mist-600">
                    {{ run.images.length }} 图 · {{ formatBytes(run.content.length) }} 文本 · {{ formatClock(run.createdAt) }}
                  </span>
                </span>
                <ChevronUp v-if="expanded.includes(run.id)" class="h-3.5 w-3.5 shrink-0 text-mist-500" />
                <ChevronDown v-else class="h-3.5 w-3.5 shrink-0 text-mist-500" />
              </button>
              <div v-if="expanded.includes(run.id)" class="border-t border-white/6 bg-black/20 p-3.5">
                <div class="mb-2.5 flex gap-2 overflow-x-auto">
                  <button
                    v-for="(image, index) in run.images"
                    :key="index"
                    type="button"
                    class="h-12 w-16 shrink-0 overflow-hidden rounded-md border border-white/10"
                    @click="lightbox = image"
                  >
                    <img :src="image" alt="" class="h-full w-full object-cover" />
                  </button>
                </div>
                <div class="prose-snooper max-h-72 overflow-y-auto text-[12px]" v-html="renderContent(run.content)" />
              </div>
            </article>
          </section>
        </section>

        <!-- Input column (right, sticky) -->
        <aside
          class="min-w-0 space-y-3 xl:order-2"
          :class="activeRun ? 'order-2' : 'order-1'"
        >
          <section
            class="glass rounded-2xl p-3 transition-colors"
            :class="isDragging ? 'border-amber-glow/50 bg-amber-glow/[0.06]' : ''"
          >
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="onFilesPicked"
            />

            <button
              v-if="!images.length"
              type="button"
              class="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-8 text-center transition-colors hover:border-amber-glow/35 hover:bg-amber-glow/[0.04]"
              @click="pickFiles"
            >
              <span class="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-glow/20 bg-amber-glow/8 text-amber-glow">
                <Upload class="h-5 w-5" />
              </span>
              <span class="mt-1 text-[12px] font-medium text-mist-200">上传或拖拽图片</span>
              <span class="text-[10.5px] text-mist-500">也可以直接 Ctrl / ⌘ + V 粘贴</span>
              <span class="mt-1 font-mono text-[9.5px] tracking-[0.1em] text-mist-600 uppercase">
                PNG · JPEG · WebP
              </span>
            </button>

            <div v-else>
              <div class="mb-2 flex items-center justify-between px-0.5">
                <span class="font-mono text-[10px] text-mist-500">{{ images.length }} / 10</span>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-[10.5px] text-mist-400 transition-colors hover:text-amber-glow"
                    @click="pickFiles"
                  >
                    <ImagePlus class="h-3 w-3" />
                    添加
                  </button>
                  <button
                    type="button"
                    class="text-[10.5px] text-mist-500 transition-colors hover:text-rose-200"
                    @click="clearImages"
                  >
                    清空
                  </button>
                </div>
              </div>
              <div class="grid max-h-[232px] grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
                <div
                  v-for="image in images"
                  :key="image.id"
                  class="group relative aspect-square overflow-hidden rounded-lg border border-white/8 bg-black/30"
                >
                  <img :src="image.dataUrl" :alt="image.name" class="h-full w-full object-cover" />
                  <button
                    type="button"
                    class="absolute top-1 right-1 rounded-full bg-ink-950/80 p-0.5 text-mist-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-200"
                    :aria-label="`移除 ${image.name}`"
                    @click="removeImage(image.id)"
                  >
                    <X class="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section class="glass rounded-2xl p-3.5">
            <div class="flex items-center justify-between">
              <span class="field-label mb-0">预设</span>
              <span class="font-mono text-[9.5px] text-mist-600">6 modes</span>
            </div>
            <div class="mt-2 grid grid-cols-2 gap-1.5">
              <button
                v-for="preset in presets"
                :key="preset.id"
                type="button"
                class="rounded-lg border px-2.5 py-2 text-left transition-colors"
                :class="
                  activePreset === preset.id
                    ? 'border-amber-glow/40 bg-amber-glow/10'
                    : 'border-white/7 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
                "
                @click="usePreset(preset.id, preset.prompt)"
              >
                <span
                  class="block text-[11px] font-medium"
                  :class="activePreset === preset.id ? 'text-amber-glow' : 'text-mist-200'"
                >
                  {{ preset.label }}
                </span>
                <span class="mt-0.5 block truncate text-[9.5px] text-mist-600">{{ preset.hint }}</span>
              </button>
            </div>
          </section>

          <section class="glass rounded-2xl p-3.5">
            <label class="block">
              <span class="field-label">问题 / 指令</span>
              <textarea
                v-model="prompt"
                rows="4"
                class="w-full resize-none rounded-xl border border-white/8 bg-black/28 p-2.5 text-[12px] leading-relaxed text-mist-100 outline-none transition-colors placeholder:text-mist-600 hover:border-white/15 focus:border-amber-glow/50"
                placeholder="例如：提取图中表格，并指出第三列的异常值。"
              />
            </label>

            <div v-if="error" class="mt-2 rounded-lg border border-rose-glow/25 bg-rose-glow/8 px-2.5 py-2 text-[10.5px] leading-relaxed text-rose-200">
              {{ error }}
            </div>

            <button
              v-if="isAnalyzing"
              type="button"
              class="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-glow/30 bg-rose-glow/12 py-2.5 text-[12.5px] font-medium text-rose-200 transition-colors hover:bg-rose-glow/20"
              @click="stop"
            >
              <Square class="h-3.5 w-3.5 fill-current" />
              停止分析
            </button>
            <button
              v-else
              type="button"
              class="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-glow to-rose-glow py-2.5 text-[12.5px] font-semibold text-ink-950 transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-35"
              :disabled="!images.length"
              @click="run"
            >
              <Sparkles class="h-4 w-4" />
              开始分析
            </button>

            <p class="mt-2 text-center font-mono text-[9.5px] text-mist-600">
              图片以 base64 发送到你配置的服务商
            </p>
          </section>
        </aside>
      </div>
    </div>

    <!-- Lightbox -->
    <div
      v-if="lightbox"
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/85 p-4 backdrop-blur-sm"
      @click="lightbox = ''"
    >
      <button
        type="button"
        class="absolute top-4 right-4 rounded-full border border-white/10 bg-white/[0.06] p-2 text-mist-200 hover:bg-white/10"
        aria-label="关闭"
      >
        <X class="h-4 w-4" />
      </button>
      <img
        :src="lightbox"
        alt=""
        class="max-h-[88vh] max-w-[92vw] rounded-xl border border-white/10 object-contain shadow-2xl"
      />
    </div>
  </div>
</template>

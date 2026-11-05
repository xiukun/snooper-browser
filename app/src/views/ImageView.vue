<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  Copy,
  Download,
  Image as ImageIcon,
  Lightbulb,
  LoaderCircle,
  Palette,
  Sparkles,
  WandSparkles,
  X,
} from '@lucide/vue'
import { useSettings } from '@/composables/useSettings'
import { useImagePrompt } from '@/composables/useImagePrompt'
import { generateImage, generateSvg } from '@lib/moss'
import { uid } from '@lib/utils'

type OutputMode = 'image' | 'svg'

interface HistoryEntry {
  id: string
  prompt: string
  outputType: OutputMode
  result: string // image URL or SVG markup
  model: string
  createdAt: number
}

const { imageRoute } = useSettings()
const { consumePendingPrompt } = useImagePrompt()

const prompt = ref('')
const negativePrompt = ref('')
const outputMode = ref<OutputMode>('image')
const enhancePrompt = ref(true)
const noWatermark = ref(true)
const seedInput = ref('')
const isGenerating = ref(false)
const history = ref<HistoryEntry[]>([])
const previewEntry = ref<HistoryEntry | null>(null)
const svgStyle = ref('minimalist, clean, modern')

// Consume pending prompt from other views when this view activates
onActivated(() => {
  const pending = consumePendingPrompt()
  if (pending) {
    prompt.value = pending
  }
})

const modelLabel = computed(() => imageRoute.value?.model ?? '未配置生图模型')
const hasProvider = computed(() => Boolean(imageRoute.value))

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    doGenerate()
  }
}

async function doGenerate() {
  const text = prompt.value.trim()
  if (!text) {
    toast.error('请输入描述文字')
    return
  }
  if (!hasProvider.value) {
    toast.error('未配置生图服务商，请先在「能力设置」中配置')
    return
  }

  isGenerating.value = true
  try {
    if (outputMode.value === 'svg') {
      const styleText = svgStyle.value.trim() || 'minimalist, clean, modern'
      const svg = await generateSvg(text, { style: styleText })
      history.value.unshift({
        id: uid('img'),
        prompt: text,
        outputType: 'svg',
        result: svg,
        model: modelLabel.value,
        createdAt: Date.now(),
      })
      toast.success('SVG 生成成功')
    } else {
      const parsedSeed = seedInput.value.trim() ? Number(seedInput.value.trim()) : undefined
      const result = await generateImage({
        prompt: text,
        enhance: enhancePrompt.value,
        negativePrompt: negativePrompt.value.trim() || undefined,
        noWatermark: noWatermark.value,
        ...(Number.isFinite(parsedSeed) && parsedSeed !== undefined
          ? { seed: Math.trunc(parsedSeed) }
          : {}),
      })
      history.value.unshift({
        id: uid('img'),
        prompt: text,
        outputType: 'image',
        result: result.images[0],
        model: result.model,
        createdAt: Date.now(),
      })
      toast.success('图片生成成功')
    }
  } catch (err: any) {
    toast.error(err.message || '生成失败')
  } finally {
    isGenerating.value = false
  }
}

function copySvg(svg: string) {
  navigator.clipboard.writeText(svg).then(() => {
    toast.success('SVG 代码已复制到剪贴板')
  }).catch(() => {
    toast.error('复制失败')
  })
}

function downloadImage(url: string, promptText: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = `snooper-${promptText.slice(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}.png`
  a.click()
  toast.success('已开始下载')
}

function clearHistory() {
  history.value = []
  previewEntry.value = null
}

/** Render SVG markup safely via a data URL <img> — scripts never execute. */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-[1440px] px-4 pt-4 pb-8 sm:px-6 lg:px-8">
      <!-- Top bar -->
      <div class="glass flex flex-wrap items-center gap-2 rounded-2xl p-2">
        <div class="flex rounded-xl bg-black/30 p-1">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            :class="
              outputMode === 'image'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-mist-500 hover:text-mist-200'
            "
            @click="outputMode = 'image'"
          >
            <ImageIcon class="h-3.5 w-3.5" />
            图片
          </button>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            :class="
              outputMode === 'svg'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-mist-500 hover:text-mist-200'
            "
            @click="outputMode = 'svg'"
          >
            <Palette class="h-3.5 w-3.5" />
            SVG / Logo
          </button>
        </div>

        <span class="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-mist-500">
          {{ modelLabel }}
        </span>

        <div class="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-mist-400 transition-colors hover:bg-white/5 hover:text-mist-100"
            :disabled="history.length === 0"
            @click="clearHistory"
          >
            <X class="h-3.5 w-3.5" />
            清空
          </button>
        </div>
      </div>

      <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_364px]">
        <!-- Main area -->
        <div class="min-w-0 space-y-4">
          <!-- Preview area -->
          <section
            class="relative isolate flex min-h-[400px] items-center justify-center overflow-hidden rounded-[26px] border border-white/8 bg-ink-900/50 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.95)] sm:min-h-[500px]"
          >
            <div class="absolute inset-0 bg-[radial-gradient(120%_120%_at_15%_0%,rgba(124,92,255,0.20),transparent_55%),radial-gradient(100%_100%_at_90%_100%,rgba(20,200,184,0.14),transparent_60%)]" />
            <div class="grid-lines absolute inset-0 opacity-60" />

            <!-- Image preview -->
            <div v-if="previewEntry" class="relative z-10 flex max-h-full max-w-full flex-col items-center p-6">
              <div v-if="previewEntry.outputType === 'image'" class="relative max-h-[520px] max-w-full overflow-hidden rounded-xl shadow-2xl">
                <img
                  :src="previewEntry.result"
                  :alt="previewEntry.prompt"
                  class="h-auto max-h-[520px] w-auto max-w-full object-contain"
                />
              </div>
              <div
                v-else
                class="flex max-h-[520px] max-w-full items-center justify-center overflow-auto rounded-xl bg-white p-4 shadow-2xl"
              >
                <img :src="svgDataUrl(previewEntry.result)" alt="SVG 预览" class="max-h-[480px] max-w-full" />
              </div>
              <p class="mt-3 max-w-lg truncate text-[11px] text-mist-400">
                {{ previewEntry.prompt }}
              </p>
              <div class="mt-2 flex items-center gap-2">
                <button
                  v-if="previewEntry.outputType === 'svg'"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-mist-300 transition-colors hover:border-iris-400/40 hover:text-iris-200"
                  @click="copySvg(previewEntry.result)"
                >
                  <Copy class="h-3 w-3" />
                  复制 SVG
                </button>
                <button
                  v-if="previewEntry.outputType === 'image'"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-mist-300 transition-colors hover:border-aqua-400/40 hover:text-aqua-200"
                  @click="downloadImage(previewEntry.result, previewEntry!.prompt)"
                >
                  <Download class="h-3 w-3" />
                  下载
                </button>
              </div>
            </div>

            <!-- Empty state -->
            <div v-else-if="!isGenerating" class="relative z-10 flex flex-col items-center px-6 text-center">
              <div class="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
                <ImageIcon class="h-8 w-8 text-mist-500" />
              </div>
              <h2 class="mt-4 text-lg font-semibold text-white">AI 图像创作</h2>
              <p class="mt-2 max-w-sm text-[12.5px] leading-relaxed text-mist-400">
                输入描述文字或从翻译字幕一键生图。
                支持图片生成和 SVG/Logo 矢量创作。
              </p>
            </div>

            <!-- Loading -->
            <div v-else class="relative z-10 flex flex-col items-center">
              <LoaderCircle class="h-10 w-10 animate-spin text-iris-400" />
              <p class="mt-4 text-[12px] text-mist-400">
                {{ outputMode === 'svg' ? '正在生成 SVG...' : '正在生成图片...' }}
              </p>
            </div>
          </section>

          <!-- History gallery -->
          <section v-if="history.length > 0" class="glass rounded-2xl p-4">
            <div class="mb-3 flex items-center gap-2">
              <ImageIcon class="h-4 w-4 text-mist-400" />
              <h3 class="text-[13px] font-medium text-mist-100">生成历史</h3>
              <span class="rounded-full bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-mist-500">
                {{ history.length }}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              <button
                v-for="entry in history"
                :key="entry.id"
                type="button"
                class="group relative aspect-square overflow-hidden rounded-xl border border-white/8 bg-white/[0.03] transition-colors hover:border-iris-400/40"
                @click="previewEntry = entry"
              >
                <div v-if="entry.outputType === 'image'" class="h-full w-full">
                  <img
                    :src="entry.result"
                    :alt="entry.prompt"
                    class="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div
                  v-else
                  class="flex h-full w-full items-center justify-center bg-white p-2"
                >
                  <img :src="svgDataUrl(entry.result)" :alt="entry.prompt" class="h-full w-full object-contain" />
                </div>
                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <p class="truncate text-[10px] text-white/80">{{ entry.prompt }}</p>
                </div>
                <span
                  class="absolute right-1.5 top-1.5 rounded border border-white/15 bg-black/50 px-1 py-0.5 font-mono text-[8px] text-mist-400"
                >
                  {{ entry.outputType === 'svg' ? 'SVG' : 'IMG' }}
                </span>
              </button>
            </div>
          </section>
        </div>

        <!-- Right rail: prompt input -->
        <aside class="space-y-4">
          <section class="glass rounded-2xl p-4">
            <div class="mb-3 flex items-center gap-2">
              <WandSparkles class="h-4 w-4 text-iris-300" />
              <h3 class="text-[13px] font-medium text-mist-100">创作输入</h3>
            </div>

            <!-- Prompt input -->
            <textarea
              v-model="prompt"
              class="field-input min-h-[100px] resize-y text-[13px] leading-relaxed"
              placeholder="输入描述文字，如：一只穿着宇航服的猫，赛博朋克风格"
              @keydown="handleKeydown"
            />

            <!-- Negative prompt (only in image mode) -->
            <div v-if="outputMode === 'image'" class="mt-2">
              <input
                v-model="negativePrompt"
                type="text"
                class="field-input text-[12px]"
                placeholder="负向提示词（可选）：模糊、畸形、水印、低质量"
              />
            </div>

            <!-- SVG style (only in SVG mode) -->
            <div v-if="outputMode === 'svg'" class="mt-3">
              <label class="field-label">SVG 风格</label>
              <input
                v-model="svgStyle"
                type="text"
                class="field-input mt-1 text-[12px]"
                placeholder="minimalist, clean, modern"
              />
            </div>

            <!-- Options row: enhance + watermark + seed -->
            <div v-if="outputMode === 'image'" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                :class="
                  enhancePrompt
                    ? 'border-iris-400/30 bg-iris-400/10 text-iris-200'
                    : 'border-white/8 bg-white/[0.03] text-mist-400 hover:text-mist-200'
                "
                @click="enhancePrompt = !enhancePrompt"
              >
                <Sparkles class="h-3 w-3" />
                提示词增强
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                :class="
                  noWatermark
                    ? 'border-aqua-400/30 bg-aqua-400/10 text-aqua-200'
                    : 'border-white/8 bg-white/[0.03] text-mist-400 hover:text-mist-200'
                "
                @click="noWatermark = !noWatermark"
                title="MOSS-Image 默认加水印，关闭后生成无水印原图"
              >
                <ImageIcon class="h-3 w-3" />
                {{ noWatermark ? '无水印' : '带水印' }}
              </button>
              <label class="flex items-center gap-1.5 text-[11px] text-mist-500">
                种子
                <input
                  v-model="seedInput"
                  type="number"
                  class="field-input w-24 px-2 py-1 text-[11px]"
                  placeholder="随机"
                  min="0"
                />
              </label>
            </div>

            <!-- Enhance toggle (kept for SVG mode) -->
            <div v-else class="mt-3 flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                :class="
                  enhancePrompt
                    ? 'border-iris-400/30 bg-iris-400/10 text-iris-200'
                    : 'border-white/8 bg-white/[0.03] text-mist-400 hover:text-mist-200'
                "
                @click="enhancePrompt = !enhancePrompt"
              >
                <Sparkles class="h-3 w-3" />
                LLM 增强
              </button>
              <span class="text-[10px] text-mist-500">
                {{ enhancePrompt ? '自动优化 prompt' : '使用原始文本' }}
              </span>
            </div>

            <!-- Generate button -->
            <button
              type="button"
              class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-semibold transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
              :class="
                isGenerating
                  ? 'border border-iris-400/30 bg-iris-400/12 text-iris-200'
                  : 'bg-gradient-to-r from-iris-500 to-aqua-500 text-white shadow-[0_16px_40px_-16px_rgba(124,92,255,0.8)] hover:brightness-110'
              "
              :disabled="isGenerating || !prompt.trim()"
              @click="doGenerate"
            >
              <LoaderCircle v-if="isGenerating" class="h-4 w-4 animate-spin" />
              <WandSparkles v-else class="h-4 w-4" />
              {{ isGenerating ? '生成中...' : outputMode === 'svg' ? '生成 SVG' : '生成图片' }}
            </button>
          </section>

          <!-- Tips -->
          <section class="glass-soft rounded-2xl p-4">
            <h4 class="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-mist-300">
              <Lightbulb class="h-3 w-3 text-amber-glow" />
              使用技巧
            </h4>
            <ul class="space-y-1.5 text-[11px] leading-relaxed text-mist-500">
              <li>• 在实时互译页点击字幕行的「配图」按钮，自动填入翻译文本</li>
              <li>• 开启「提示词增强」自动优化英文 prompt，提升生图质量</li>
              <li>• SVG 模式适合生成 Logo、图标、品牌标识等矢量素材</li>
              <li>• 生成图片可直接下载 PNG，SVG 可一键复制代码</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>

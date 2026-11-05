<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  ArrowUp,
  Bot,
  Check,
  Copy,
  FileImage,
  ImagePlus,
  Languages,
  MessageSquare,
  Paperclip,
  Sparkles,
  Square,
  Trash2,
  X,
} from '@lucide/vue'
import SnooperMark from '@/components/SnooperMark.vue'
import { useChat } from '@/composables/useChat'
import { useSettings } from '@/composables/useSettings'
import { initMarkdown, renderMarkdown } from '@/lib/markdown'
import { formatBytes, formatClock } from '@lib/utils'

const { messages, attachments, isStreaming, addFiles, removeAttachment, send, stop, clear } =
  useChat()
const { routeModels, llmRoute, isConfigured } = useSettings()

const draft = ref('')
const composerEl = ref<HTMLTextAreaElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const copiedId = ref('')
const showClearConfirm = ref(false)

const suggestions = [
  {
    tag: 'Translate',
    title: '把这段英文演讲翻成中文',
    prompt: '把下面这段英文演讲翻译成自然、口语化的中文，保留技术术语：\n\n',
  },
  {
    tag: 'Explain',
    title: '解释一个复杂概念',
    prompt: '用类比的方式解释什么是「事件驱动架构」，面向没有后端经验的读者。',
  },
  {
    tag: 'Build',
    title: '写一个可运行的脚本',
    prompt: '用 TypeScript 写一个把 SRT 字幕文件合并为双语的脚本，带错误处理。',
  },
  {
    tag: 'Review',
    title: '审阅一段文案',
    prompt: '帮我把下面这段产品文案改得更简洁、更有说服力：\n\n',
  },
]

const lastMessage = computed(() => messages.value[messages.value.length - 1] ?? null)
const showEmpty = computed(() => messages.value.length === 0)

function renderContent(content: string) {
  return renderMarkdown(content)
}

onMounted(() => {
  void initMarkdown()
})

function autoGrow() {
  const el = composerEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

function focusComposer() {
  void nextTick(() => composerEl.value?.focus())
}

function useSuggestion(prompt: string) {
  draft.value = prompt
  focusComposer()
  void nextTick(autoGrow)
}

function scrollToBottom(smooth = true) {
  void nextTick(() => {
    const el = scrollEl.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  })
}

watch(
  () => messages.value.length,
  () => scrollToBottom(true),
)

watch(
  () => lastMessage.value?.content,
  () => {
    const el = scrollEl.value
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (nearBottom || isStreaming.value) scrollToBottom(false)
  },
)

async function submit() {
  if (isStreaming.value) return
  const text = draft.value.trim()
  if (!text && !attachments.value.length) return
  draft.value = ''
  void nextTick(autoGrow)
  await send(text)
  focusComposer()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void submit()
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
  if (files.length) {
    event.preventDefault()
    void addFiles(files)
  }
}

async function copyMessage(id: string, content: string) {
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
    toast.success('已复制')
  } catch {
    toast.error('复制失败')
  }
}

function confirmClear() {
  clear()
  showClearConfirm.value = false
  toast.info('对话已清空')
}

function clearDraft() {
  draft.value = ''
  void nextTick(autoGrow)
}
</script>

<template>
  <div
    class="flex h-full min-h-0"
    @dragover.prevent="isDragging = true"
    @dragleave.self="isDragging = false"
    @drop.prevent="onDrop"
    @paste="onPaste"
  >
    <section class="flex min-w-0 flex-1 flex-col">
      <!-- Toolbar -->
      <div class="flex h-12 shrink-0 items-center justify-between border-b border-white/6 px-4 sm:px-6">
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-iris-400/20 bg-iris-500/8 px-2.5 py-1 font-mono text-[10.5px] text-iris-200"
          >
            <Sparkles class="h-3 w-3" />
            {{ isConfigured ? routeModels.llm : '未配置服务商' }}
          </span>
          <span class="hidden font-mono text-[10px] text-mist-600 sm:inline">single-turn · flattened history</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="mr-1 hidden font-mono text-[10px] text-mist-600 sm:inline">
            {{ messages.length }} msg
          </span>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] text-mist-400 transition-colors hover:bg-white/5 hover:text-mist-100 disabled:opacity-40"
            :disabled="showEmpty"
            @click="showClearConfirm = true"
          >
            <Trash2 class="h-3.5 w-3.5" />
            清空
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          <div v-if="showEmpty" class="flex flex-col items-center pt-6 text-center sm:pt-12">
            <SnooperMark :size="56" glow />
            <p class="mt-5 font-mono text-[10px] tracking-[0.24em] text-mist-500 uppercase">
              Multimodal copilot
            </p>
            <h2 class="mt-2 text-2xl font-semibold tracking-[-0.02em] text-white">
              想聊点什么？
            </h2>
            <p class="mt-2 max-w-sm text-[12.5px] leading-relaxed text-mist-400">
              文本、图片、代码都能直接丢进来。回答会以 Markdown 渲染，支持代码高亮。
            </p>

            <div class="mt-7 grid w-full gap-2 sm:grid-cols-2">
              <button
                v-for="item in suggestions"
                :key="item.tag"
                type="button"
                class="group flex flex-col rounded-2xl border border-white/8 bg-white/[0.025] p-3.5 text-left transition-all hover:border-iris-400/30 hover:bg-white/[0.05]"
                @click="useSuggestion(item.prompt)"
              >
                <span class="font-mono text-[9.5px] tracking-[0.16em] text-iris-300/70 uppercase">
                  {{ item.tag }}
                </span>
                <span class="mt-1.5 text-[12.5px] font-medium text-mist-200 group-hover:text-white">
                  {{ item.title }}
                </span>
                <span class="mt-1 line-clamp-1 text-[10.5px] text-mist-600">
                  {{ item.prompt.replace(/\n/g, ' ') }}
                </span>
              </button>
            </div>
          </div>

          <div v-else class="space-y-6">
            <article
              v-for="message in messages"
              :key="message.id"
              class="flex gap-3"
              :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
            >
              <template v-if="message.role === 'user'">
                <div class="max-w-[86%] sm:max-w-[78%]">
                  <div
                    class="rounded-2xl rounded-tr-md border border-iris-400/20 bg-iris-500/10 px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-mist-100"
                  >
                    <div v-if="message.attachments?.length" class="mb-2.5 flex flex-wrap gap-2">
                      <img
                        v-for="attachment in message.attachments"
                        :key="attachment.id"
                        :src="attachment.dataUrl"
                        :alt="attachment.name"
                        class="h-16 w-16 rounded-lg border border-white/10 object-cover"
                      />
                    </div>
                    {{ message.content }}
                  </div>
                  <p class="mt-1 pr-1 text-right font-mono text-[9.5px] text-mist-600">
                    {{ formatClock(message.createdAt) }}
                  </p>
                </div>
              </template>

              <template v-else>
                <SnooperMark :size="28" class="mt-0.5" />
                <div class="min-w-0 max-w-[92%] flex-1">
                  <div class="mb-1.5 flex items-center gap-2">
                    <span class="text-[11.5px] font-medium text-mist-200">snooper</span>
                    <span class="font-mono text-[9.5px] text-mist-600">
                      {{ message.model || routeModels.llm }}
                    </span>
                    <span class="font-mono text-[9.5px] text-mist-600">·</span>
                    <span class="font-mono text-[9.5px] text-mist-600">
                      {{ formatClock(message.createdAt) }}
                    </span>
                  </div>

                  <div
                    class="group inline-block max-w-full rounded-2xl rounded-tl-md border px-4 py-3.5"
                    :class="
                      message.status === 'error'
                        ? 'border-rose-glow/25 bg-rose-glow/6'
                        : 'border-white/7 bg-white/[0.025]'
                    "
                  >
                    <div
                      v-if="message.status === 'streaming' && !message.content"
                      class="flex items-center gap-1.5 py-1"
                    >
                      <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-iris-300" />
                      <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-iris-300 [animation-delay:150ms]" />
                      <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-iris-300 [animation-delay:300ms]" />
                      <span class="ml-1 font-mono text-[10px] text-mist-500">thinking…</span>
                    </div>
                    <div
                      v-else
                      class="prose-snooper text-[13px] leading-relaxed"
                      :class="message.status === 'error' ? 'text-rose-200' : 'text-mist-200'"
                      v-html="renderContent(message.content)"
                    />

                    <div
                      v-if="message.content && message.status !== 'streaming'"
                      class="mt-2 flex justify-end"
                    >
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-mist-600 opacity-0 transition group-hover:opacity-100 hover:text-mist-300"
                        @click="copyMessage(message.id, message.content)"
                      >
                        <Check v-if="copiedId === message.id" class="h-3 w-3 text-aqua-300" />
                        <Copy v-else class="h-3 w-3" />
                        {{ copiedId === message.id ? '已复制' : '复制' }}
                      </button>
                    </div>
                  </div>
                </div>
              </template>
            </article>

            <div v-if="isStreaming" class="flex justify-center">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10.5px] text-mist-300 transition-colors hover:border-rose-glow/30 hover:text-rose-200"
                @click="stop"
              >
                <Square class="h-2.5 w-2.5 fill-current" />
                停止生成
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Composer -->
      <div class="shrink-0 border-t border-white/6 bg-ink-950/55 px-3 py-3 backdrop-blur-xl sm:px-6 sm:py-4">
        <div class="mx-auto w-full max-w-3xl">
          <div
            v-if="attachments.length"
            class="mb-2 flex flex-wrap gap-2"
          >
            <div
              v-for="attachment in attachments"
              :key="attachment.id"
              class="group relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]"
            >
              <img
                :src="attachment.dataUrl"
                :alt="attachment.name"
                class="h-14 w-14 object-cover"
              />
              <button
                type="button"
                class="absolute top-0.5 right-0.5 rounded-full bg-ink-950/80 p-0.5 text-mist-300 opacity-0 transition group-hover:opacity-100 hover:text-rose-200"
                :aria-label="`移除 ${attachment.name}`"
                @click="removeAttachment(attachment.id)"
              >
                <X class="h-3 w-3" />
              </button>
              <span class="sr-only">{{ attachment.name }} · {{ formatBytes(attachment.size) }}</span>
            </div>
          </div>

          <div
            class="rounded-2xl border bg-white/[0.03] p-1.5 transition-colors focus-within:border-iris-400/40"
            :class="isDragging ? 'border-iris-400/60 bg-iris-500/8' : 'border-white/10'"
          >
            <div class="flex items-end gap-1.5">
              <input
                ref="fileInput"
                type="file"
                accept="image/*"
                multiple
                class="hidden"
                @change="onFilesPicked"
              />
              <button
                type="button"
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-mist-400 transition-colors hover:bg-white/5 hover:text-mist-100"
                aria-label="添加图片"
                @click="pickFiles"
              >
                <ImagePlus class="h-[18px] w-[18px]" />
              </button>

              <textarea
                ref="composerEl"
                v-model="draft"
                rows="1"
                placeholder="问点什么，或直接粘贴一张图片…"
                class="max-h-[180px] min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[13px] leading-relaxed text-mist-100 placeholder:text-mist-600 focus:outline-none"
                @input="autoGrow"
                @keydown="onKeydown"
              />

              <button
                v-if="isStreaming"
                type="button"
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-glow/30 bg-rose-glow/12 text-rose-200 transition hover:bg-rose-glow/20"
                aria-label="停止生成"
                @click="stop"
              >
                <Square class="h-4 w-4 fill-current" />
              </button>
              <button
                v-else
                type="button"
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-iris-400 to-iris-600 text-white shadow-[0_10px_30px_-10px_rgba(124,92,255,0.8)] transition hover:brightness-110 active:scale-95 disabled:opacity-35"
                :disabled="!draft.trim() && !attachments.length"
                aria-label="发送"
                @click="submit"
              >
                <ArrowUp class="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>

          <div class="mt-1.5 flex items-center justify-between px-1 text-[10px] text-mist-600">
            <span class="inline-flex items-center gap-1">
              <Paperclip class="h-3 w-3" />
              Enter 发送 · Shift+Enter 换行 · 最多 8 张图
            </span>
            <button
              v-if="draft"
              type="button"
              class="transition-colors hover:text-mist-300"
              @click="clearDraft"
            >
              清空输入
            </button>
            <span v-else class="inline-flex items-center gap-1">
              <MessageSquare class="h-3 w-3" />
              单轮上下文压缩
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- Context rail -->
    <aside class="hidden w-[292px] shrink-0 border-l border-white/6 p-4 2xl:block">
      <div class="sticky top-0 space-y-3">
        <div class="glass-soft rounded-2xl p-4">
          <div class="flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-iris-500/12 text-iris-300">
              <Bot class="h-4 w-4" />
            </div>
            <div>
              <p class="text-[12px] font-medium text-mist-100">当前路由</p>
              <p class="font-mono text-[9.5px] text-mist-600">LLM · chat + vision</p>
            </div>
          </div>
          <dl class="mt-3 space-y-2 text-[11px]">
            <div class="flex items-center justify-between gap-2">
              <dt class="text-mist-500">模型</dt>
              <dd class="max-w-[150px] truncate font-mono text-[10px] text-mist-300">
                {{ routeModels.llm }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-mist-500">服务商</dt>
              <dd class="max-w-[150px] truncate font-mono text-[10px] text-mist-300">
                {{ llmRoute?.provider.name ?? '未配置' }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-mist-500">上下文</dt>
              <dd class="font-mono text-[10px] text-mist-300">最近 12 轮</dd>
            </div>
          </dl>
        </div>

        <div class="glass-soft rounded-2xl p-4">
          <div class="flex items-center gap-2 text-[11.5px] font-medium text-mist-200">
            <Languages class="h-3.5 w-3.5 text-aqua-300" />
            使用建议
          </div>
          <ul class="mt-2.5 space-y-2 text-[10.5px] leading-relaxed text-mist-500">
            <li>· 中文提问，模型会用中文回答；也可以直接说「用英文」。</li>
            <li>· 图片会压缩后随消息发送，单条最多 8 张。</li>
            <li>· MOSS VL 只接受单轮消息，snooper 会自动压缩历史。</li>
            <li>· 停止生成不会丢失已输出的内容。</li>
          </ul>
        </div>

        <div class="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
          <div class="flex items-center gap-2 text-[10.5px] text-mist-400">
            <FileImage class="h-3.5 w-3.5" />
            图片会以 base64 形式发送
          </div>
          <p class="mt-1.5 text-[10px] leading-relaxed text-mist-600">
            图片仅用于本次请求，不会被持久化到任何服务器。密钥保存在浏览器本地。
          </p>
        </div>
      </div>
    </aside>

    <!-- Clear confirm -->
    <div
      v-if="showClearConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4 backdrop-blur-sm"
      @click.self="showClearConfirm = false"
    >
      <div class="glass-strong w-full max-w-sm rounded-2xl p-5">
        <h3 class="text-[14px] font-semibold text-white">清空当前对话？</h3>
        <p class="mt-2 text-[11.5px] leading-relaxed text-mist-400">
          所有消息与未发送的图片都会被移除，此操作无法撤销。
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-white/10 px-3 py-1.5 text-[11.5px] text-mist-300 hover:bg-white/5"
            @click="showClearConfirm = false"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-lg border border-rose-glow/30 bg-rose-glow/15 px-3 py-1.5 text-[11.5px] text-rose-200 hover:bg-rose-glow/25"
            @click="confirmClear"
          >
            清空
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

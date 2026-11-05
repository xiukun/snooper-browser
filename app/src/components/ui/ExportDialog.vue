<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { Download, FileJson2, FileText, X } from '@lucide/vue'
import type { SubtitleLine } from '@/composables/useRealtime'
import {
  buildJsonExport,
  buildMarkdownTranscript,
  buildSrt,
  buildVtt,
  downloadBlob,
  type ExportSubtitleMode,
} from '@lib/export'

const props = defineProps<{
  open: boolean
  subtitles: SubtitleLine[]
  sourceLang: string
  targetLang: string
  engine?: string
  elapsedSeconds?: number
}>()

const emit = defineEmits<{
  close: []
}>()

type Format = 'srt' | 'vtt' | 'markdown' | 'json'
const selectedFormat = ref<Format>('srt')
const selectedMode = ref<ExportSubtitleMode>('bilingual')

const isEmpty = ref(false)

function handleExport() {
  if (!props.subtitles.length) {
    toast.error('当前没有可导出的字幕')
    isEmpty.value = true
    return
  }
  isEmpty.value = false
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/T/, '-')
    .slice(0, 19)

  let content = ''
  let filename = ''
  let mime = 'text/plain;charset=utf-8'

  switch (selectedFormat.value) {
    case 'srt':
      content = buildSrt(props.subtitles, selectedMode.value)
      filename = `snooper_${timestamp}.srt`
      break
    case 'vtt':
      content = buildVtt(props.subtitles, selectedMode.value)
      filename = `snooper_${timestamp}.vtt`
      break
    case 'markdown':
      content = buildMarkdownTranscript(props.subtitles, {
        sourceLang: props.sourceLang,
        targetLang: props.targetLang,
        engine: props.engine,
        elapsedSeconds: props.elapsedSeconds,
      })
      filename = `snooper_notes_${timestamp}.md`
      mime = 'text/markdown;charset=utf-8'
      break
    case 'json':
      content = buildJsonExport(props.subtitles, {
        sourceLang: props.sourceLang,
        targetLang: props.targetLang,
        engine: props.engine,
        elapsedSeconds: props.elapsedSeconds,
      })
      filename = `snooper_session_${timestamp}.json`
      mime = 'application/json;charset=utf-8'
      break
  }

  if (!content.trim()) {
    toast.error('导出内容为空')
    return
  }
  downloadBlob(filename, content, mime)
  toast.success(`已导出 ${filename}`)
  emit('close')
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="导出双语字幕"
  >
    <div class="glass-strong w-full max-w-md rounded-2xl p-5">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-[15px] font-semibold text-white">导出双语字幕</h3>
          <p class="mt-1 text-[12px] leading-relaxed text-mist-400">
            纯前端在浏览器本地生成，不会上传到任何服务器。
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg p-1.5 text-mist-500 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="关闭导出对话框"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-4 space-y-4">
        <div>
          <p class="text-[11.5px] font-medium text-mist-300">格式</p>
          <div class="mt-1.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              class="flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors"
              :class="
                selectedFormat === 'srt'
                  ? 'border-iris-400/40 bg-iris-500/10 text-iris-200'
                  : 'border-white/8 bg-white/[0.03] text-mist-300 hover:border-white/15'
              "
              @click="selectedFormat = 'srt'"
            >
              <FileText class="h-4 w-4 shrink-0" />
              <span>
                <span class="block text-[12px] font-medium">SRT 字幕</span>
                <span class="block text-[10px] leading-tight text-mist-500">播放器通用</span>
              </span>
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors"
              :class="
                selectedFormat === 'vtt'
                  ? 'border-iris-400/40 bg-iris-500/10 text-iris-200'
                  : 'border-white/8 bg-white/[0.03] text-mist-300 hover:border-white/15'
              "
              @click="selectedFormat = 'vtt'"
            >
              <FileText class="h-4 w-4 shrink-0" />
              <span>
                <span class="block text-[12px] font-medium">WebVTT</span>
                <span class="block text-[10px] leading-tight text-mist-500">HTML5 track</span>
              </span>
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors"
              :class="
                selectedFormat === 'markdown'
                  ? 'border-iris-400/40 bg-iris-500/10 text-iris-200'
                  : 'border-white/8 bg-white/[0.03] text-mist-300 hover:border-white/15'
              "
              @click="selectedFormat = 'markdown'"
            >
              <FileText class="h-4 w-4 shrink-0" />
              <span>
                <span class="block text-[12px] font-medium">Markdown 笔记</span>
                <span class="block text-[10px] leading-tight text-mist-500">结构化对齐</span>
              </span>
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors"
              :class="
                selectedFormat === 'json'
                  ? 'border-iris-400/40 bg-iris-500/10 text-iris-200'
                  : 'border-white/8 bg-white/[0.03] text-mist-300 hover:border-white/15'
              "
              @click="selectedFormat = 'json'"
            >
              <FileJson2 class="h-4 w-4 shrink-0" />
              <span>
                <span class="block text-[12px] font-medium">JSON 备份</span>
                <span class="block text-[10px] leading-tight text-mist-500">原始会话数据</span>
              </span>
            </button>
          </div>
        </div>

        <div v-if="selectedFormat === 'srt' || selectedFormat === 'vtt'">
          <p class="text-[11.5px] font-medium text-mist-300">字幕模式</p>
          <div class="mt-1.5 grid grid-cols-3 gap-2">
            <button
              type="button"
              class="rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors"
              :class="
                selectedMode === 'bilingual'
                  ? 'border-iris-400/40 bg-iris-500/10 text-iris-200'
                  : 'border-white/8 bg-white/[0.03] text-mist-400 hover:border-white/15'
              "
              @click="selectedMode = 'bilingual'"
            >
              双语并排
            </button>
            <button
              type="button"
              class="rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors"
              :class="
                selectedMode === 'target'
                  ? 'border-iris-400/40 bg-iris-500/10 text-iris-200'
                  : 'border-white/8 bg-white/[0.03] text-mist-400 hover:border-white/15'
              "
              @click="selectedMode = 'target'"
            >
              仅译文
            </button>
            <button
              type="button"
              class="rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors"
              :class="
                selectedMode === 'source'
                  ? 'border-iris-400/40 bg-iris-500/10 text-iris-200'
                  : 'border-white/8 bg-white/[0.03] text-mist-400 hover:border-white/15'
              "
              @click="selectedMode = 'source'"
            >
              仅原文
            </button>
          </div>
          <p class="mt-1.5 text-[10.5px] leading-relaxed text-mist-500">
            每条字幕按 <code class="rounded bg-white/5 px-1 py-0.5 font-mono">start --> end</code> 轴导出。
          </p>
        </div>

        <p v-if="isEmpty" class="text-[11px] text-amber-glow">当前会话暂无字幕，请先开始听译。</p>

        <div class="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            class="rounded-lg border border-white/8 px-3.5 py-2 text-[12px] text-mist-300 transition-colors hover:bg-white/5"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-iris-500 to-aqua-500 px-4 py-2 text-[12px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
            :disabled="!subtitles.length"
            @click="handleExport"
          >
            <Download class="h-3.5 w-3.5" />
            导出
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

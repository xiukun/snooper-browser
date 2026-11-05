<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  ArrowLeftRight,
  AudioLines,
  Clock3,
  Film,
  Gauge,
  Languages,
  LoaderCircle,
  Mic,
  MonitorUp,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Upload,
  Users,
  Waves,
  X,
} from '@lucide/vue'
import FieldSelect from '@/components/ui/FieldSelect.vue'
import { useNavigation } from '@/composables/useNavigation'
import { useRealtime } from '@/composables/useRealtime'
import { useSettings } from '@/composables/useSettings'
import { languageLabel, LANGUAGES } from '@/lib/models'
import { formatTime } from '@/lib/utils'

const {
  engine,
  mediaKind,
  sourceLang,
  targetLang,
  isRunning,
  isCapturing,
  captureLabel,
  level,
  elapsed,
  subtitles,
  mediaUrl,
  mediaName,
  stats,
  directionLabel,
  start,
  stop,
  reset,
  startMic,
  startTabAudio,
  stopCapture,
  pauseVisualiser,
  resumeVisualiser,
  loadMediaFile,
  clearMedia,
} = useRealtime()

const { isConfigured, audioRoute } = useSettings()
const { setView } = useNavigation()

const fileInput = ref<HTMLInputElement | null>(null)
const transcriptEl = ref<HTMLElement | null>(null)
const showSettingsHint = computed(() => engine.value === 'moss' && !isConfigured.value)

const sourceOptions = LANGUAGES.map((language) => ({
  value: language.code,
  label: language.label,
}))
const targetOptions = LANGUAGES.filter((language) => language.code !== 'auto').map((language) => ({
  value: language.code,
  label: language.label,
}))

const currentLine = computed(() => subtitles.value[subtitles.value.length - 1] ?? null)
const sessionState = computed(() => {
  if (isRunning.value) return { label: '直播中', tone: 'text-aqua-300', dot: 'bg-aqua-400' }
  if (isCapturing.value) return { label: '已接入音频', tone: 'text-iris-300', dot: 'bg-iris-400' }
  return { label: '待机', tone: 'text-mist-400', dot: 'bg-mist-600' }
})

const bars = computed(() => {
  const amplitude = isRunning.value ? level.value : 0
  return Array.from({ length: 56 }, (_, index) => {
    const wave = Math.abs(Math.sin(index * 0.55 + elapsed.value * 2.2))
    const envelope = Math.sin((index / 55) * Math.PI) * 0.7 + 0.3
    const height = isRunning.value ? 10 + wave * envelope * amplitude * 88 : 6 + wave * 5
    return Math.round(Math.max(6, Math.min(100, height)))
  })
})

watch(
  () => subtitles.value.length,
  () => {
    void nextTick(() => {
      if (transcriptEl.value) transcriptEl.value.scrollTop = transcriptEl.value.scrollHeight
    })
  },
)

onActivated(() => {
  resumeVisualiser()
})

onDeactivated(() => {
  pauseVisualiser()
})

function swapLanguages() {
  if (sourceLang.value === 'auto') {
    sourceLang.value = targetLang.value
    targetLang.value = targetLang.value === 'zh' ? 'en' : 'zh'
    return
  }
  const previousSource = sourceLang.value
  sourceLang.value = targetLang.value
  targetLang.value = previousSource
}

function setEngine(next: 'demo' | 'moss') {
  if (engine.value === next) return
  if (isRunning.value) stop()
  engine.value = next
}

function toggleSession() {
  if (isRunning.value) {
    stop()
    return
  }
  if (engine.value === 'moss' && !isConfigured.value) {
    toast.error('请先在「能力设置」中填入 MOSS API Key')
    setView('settings')
    return
  }
  if (engine.value === 'moss' && !isCapturing.value) {
    toast.error('真实听译需要先开启麦克风或共享标签页音频')
    return
  }
  start()
}

async function useMicrophone() {
  if (isCapturing.value) stopCapture()
  await startMic()
}

async function shareTabAudio() {
  if (isCapturing.value) stopCapture()
  await startTabAudio()
}

function toggleCapture() {
  if (isCapturing.value) stopCapture()
  else void useMicrophone()
}

function pickMedia() {
  fileInput.value?.click()
}

function onMediaPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      toast.error('请选择视频或音频文件')
    } else {
      loadMediaFile(file)
    }
  }
  input.value = ''
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-[1440px] px-4 pt-4 pb-8 sm:px-6 lg:px-8">
      <!-- Session toolbar -->
      <div class="glass flex flex-wrap items-center gap-2 rounded-2xl p-2">
        <div class="flex rounded-xl bg-black/30 p-1">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            :class="
              engine === 'demo'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-mist-500 hover:text-mist-200'
            "
            @click="setEngine('demo')"
          >
            <Sparkles class="h-3.5 w-3.5" />
            演示信号
          </button>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            :class="
              engine === 'moss'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-mist-500 hover:text-mist-200'
            "
            @click="setEngine('moss')"
          >
            <Waves class="h-3.5 w-3.5" />
            在线识别
          </button>
        </div>

        <div class="flex items-center gap-2 px-1.5">
          <span class="relative flex h-1.5 w-1.5">
            <span
              v-if="isRunning"
              class="absolute inline-flex h-full w-full animate-ping rounded-full bg-aqua-400 opacity-70"
            />
            <span class="relative inline-flex h-1.5 w-1.5 rounded-full" :class="sessionState.dot" />
          </span>
          <span class="text-[11.5px] font-medium" :class="sessionState.tone">
            {{ sessionState.label }}
          </span>
        </div>

        <div class="ml-auto flex items-center gap-1.5">
          <span
            class="hidden rounded-full border border-white/7 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-mist-500 md:inline"
          >
            16 kHz · mono
          </span>
          <span
            class="hidden rounded-full border border-white/7 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-mist-500 lg:inline"
          >
            20 ms frames
          </span>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-mist-400 transition-colors hover:bg-white/5 hover:text-mist-100"
            @click="reset"
          >
            <RotateCcw class="h-3.5 w-3.5" />
            重置
          </button>
        </div>
      </div>

      <!-- Stage + rail -->
      <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_364px]">
        <div class="min-w-0 space-y-4">
          <section
            class="relative isolate overflow-hidden rounded-[26px] border border-white/8 bg-ink-900/50 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.95)]"
          >
            <div class="relative min-h-[400px] sm:min-h-[440px] lg:min-h-[500px]">
              <!-- Backdrop -->
              <div class="absolute inset-0 bg-[radial-gradient(120%_120%_at_15%_0%,rgba(124,92,255,0.20),transparent_55%),radial-gradient(100%_100%_at_90%_100%,rgba(20,200,184,0.14),transparent_60%)]" />
              <div class="grid-lines absolute inset-0 opacity-60" />

              <video
                v-if="mediaUrl && mediaKind === 'video'"
                :src="mediaUrl"
                class="absolute inset-0 h-full w-full object-cover opacity-45"
                autoplay
                loop
                muted
                playsinline
              />
              <div
                v-if="mediaUrl"
                class="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/50 to-ink-950/20"
              />

              <!-- Stage chrome -->
              <div class="relative flex items-start justify-between gap-3 p-4 sm:p-5">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.14em] uppercase"
                    :class="
                      isRunning
                        ? 'border-rose-glow/30 bg-rose-glow/12 text-rose-glow'
                        : 'border-white/10 bg-white/[0.04] text-mist-400'
                    "
                  >
                    <span
                      class="h-1.5 w-1.5 rounded-full"
                      :class="isRunning ? 'animate-pulse bg-rose-glow' : 'bg-mist-500'"
                    />
                    {{ isRunning ? 'Live' : 'Standby' }}
                  </span>
                  <span
                    v-if="mediaName || captureLabel"
                    class="max-w-[180px] truncate rounded-full border border-white/8 bg-black/25 px-2.5 py-1 text-[10.5px] text-mist-300 sm:max-w-[240px]"
                  >
                    {{ captureLabel || mediaName }}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <span
                    class="rounded-full border border-white/8 bg-black/30 px-2.5 py-1 font-mono text-[10.5px] text-mist-300 tabular-nums"
                  >
                    {{ formatTime(elapsed) }}
                  </span>
                  <span
                    class="hidden rounded-full border border-white/8 bg-black/30 px-2.5 py-1 font-mono text-[10.5px] sm:inline"
                    :class="stats.avgLatency && stats.avgLatency < 900 ? 'text-aqua-300' : 'text-mist-400'"
                  >
                    {{ stats.avgLatency ? `${stats.avgLatency} ms` : '— ms' }}
                  </span>
                </div>
              </div>

              <!-- Center state -->
              <div
                v-if="!currentLine"
                class="relative flex flex-col items-center justify-center px-6 pt-6 pb-24 text-center sm:pt-10"
              >
                <div class="relative flex h-28 w-28 items-center justify-center sm:h-32 sm:w-32">
                  <span
                    class="absolute inset-0 rounded-full border border-iris-400/20"
                    :class="isRunning ? 'animate-breathe' : ''"
                  />
                  <span class="absolute inset-4 rounded-full border border-aqua-400/15" />
                  <span
                    class="absolute inset-8 rounded-full bg-gradient-to-br from-iris-500/25 to-aqua-500/15 blur-md"
                  />
                  <button
                    type="button"
                    class="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-md transition hover:scale-105 hover:bg-white/15 active:scale-95"
                    :aria-label="isRunning ? '停止会话' : '开始会话'"
                    @click="toggleSession"
                  >
                    <Square v-if="isRunning" class="h-5 w-5 fill-white" />
                    <Play v-else class="ml-0.5 h-6 w-6 fill-white" />
                  </button>
                </div>

                <p class="mt-5 text-[11px] font-medium tracking-[0.22em] text-mist-500 uppercase">
                  {{ isRunning ? 'Listening' : engine === 'moss' ? 'Realtime pipeline' : 'Demo signal' }}
                </p>
                <h2 class="mt-1.5 text-xl font-semibold tracking-[-0.02em] text-white sm:text-2xl">
                  {{ isRunning ? '正在聆听，等待第一句…' : '把任何声音，变成双语字幕' }}
                </h2>
                <p class="mt-2 max-w-md text-[12.5px] leading-relaxed text-mist-400">
                  {{
                    engine === 'moss'
                      ? '麦克风或标签页音频 → 6 秒分段转写 → 上下文翻译。原始播放不会被静音。'
                      : '点击播放即可预览完整字幕动效。切换到在线识别可接入真实音视频。'
                  }}
                </p>
                <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <span class="chip">{{ directionLabel }}</span>
                  <span class="chip">{{ engine === 'moss' ? 'Transcribe + Translate' : 'Instant preview' }}</span>
                </div>
              </div>

              <!-- Live subtitle -->
              <div
                v-else
                class="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink-950 via-ink-950/85 to-transparent px-4 pt-16 pb-16 sm:px-8 sm:pb-20"
              >
                <Transition name="line" mode="out-in">
                  <div :key="currentLine.id" class="mx-auto max-w-3xl">
                    <p class="text-[12px] leading-relaxed text-mist-400 sm:text-[13px]">
                      {{ currentLine.source }}
                    </p>
                    <p
                      class="mt-2 text-[22px] leading-snug font-semibold tracking-[-0.02em] text-white sm:text-[28px] lg:text-[32px]"
                    >
                      {{ currentLine.target }}
                    </p>
                    <div class="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] text-mist-500">
                      <span
                        class="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono tracking-[0.08em]"
                      >
                        {{ currentLine.speaker }}
                      </span>
                      <span class="inline-flex items-center gap-1">
                        <Gauge class="h-3 w-3" />
                        {{ currentLine.latency }} ms
                      </span>
                      <span class="inline-flex items-center gap-1">
                        <Clock3 class="h-3 w-3" />
                        {{ formatTime(currentLine.at) }}
                      </span>
                    </div>
                  </div>
                </Transition>
              </div>

              <!-- Waveform footer -->
              <div
                class="absolute inset-x-0 bottom-0 z-20 flex h-12 items-end gap-[3px] bg-gradient-to-t from-ink-950 to-ink-950/0 px-4 pb-3 sm:px-6"
              >
                <span
                  v-for="(height, index) in bars"
                  :key="index"
                  class="flex-1 rounded-full transition-[height] duration-150 ease-out"
                  :class="
                    isRunning
                      ? index % 3 === 0
                        ? 'bg-aqua-400/70'
                        : 'bg-iris-400/60'
                      : 'bg-white/12'
                  "
                  :style="{ height: `${height}%`, minHeight: '2px' }"
                />
              </div>

              <div
                v-if="mediaUrl"
                class="absolute right-4 bottom-14 z-20 sm:right-6"
              >
                <span
                  class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] text-mist-400 backdrop-blur"
                >
                  <Film class="h-3 w-3" />
                  画面预览 · 静音
                  <button
                    type="button"
                    class="ml-0.5 rounded-full p-0.5 text-mist-500 hover:text-rose-300"
                    aria-label="移除预览媒体"
                    @click="clearMedia"
                  >
                    <X class="h-3 w-3" />
                  </button>
                </span>
              </div>
            </div>
          </section>

          <!-- Stats -->
          <div class="grid grid-cols-3 gap-2 sm:gap-3">
            <div class="glass-soft rounded-2xl px-3.5 py-3">
              <div class="flex items-center gap-1.5 text-[10px] tracking-[0.14em] text-mist-500 uppercase">
                <AudioLines class="h-3 w-3" />
                Lines
              </div>
              <p class="mt-1 font-mono text-xl text-white tabular-nums">{{ stats.lines }}</p>
            </div>
            <div class="glass-soft rounded-2xl px-3.5 py-3">
              <div class="flex items-center gap-1.5 text-[10px] tracking-[0.14em] text-mist-500 uppercase">
                <Users class="h-3 w-3" />
                Words
              </div>
              <p class="mt-1 font-mono text-xl text-white tabular-nums">{{ stats.words }}</p>
            </div>
            <div class="glass-soft rounded-2xl px-3.5 py-3">
              <div class="flex items-center gap-1.5 text-[10px] tracking-[0.14em] text-mist-500 uppercase">
                <Gauge class="h-3 w-3" />
                Latency
              </div>
              <p class="mt-1 font-mono text-xl text-white tabular-nums">
                {{ stats.avgLatency || 0 }}<span class="ml-1 text-[10px] text-mist-500">ms</span>
              </p>
            </div>
          </div>

          <!-- Transcript -->
          <section class="glass rounded-2xl">
            <div class="flex items-center justify-between border-b border-white/6 px-4 py-3">
              <div class="flex items-center gap-2">
                <AudioLines class="h-4 w-4 text-iris-300" />
                <h3 class="text-[13px] font-medium text-mist-100">实时字幕流</h3>
                <span class="rounded-full bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-mist-500">
                  {{ subtitles.length }}
                </span>
              </div>
              <span class="hidden font-mono text-[10px] text-mist-600 sm:inline">
                {{ engine === 'moss' ? audioRoute?.model ?? '未配置 ASR' : 'demo-engine' }}
              </span>
            </div>
            <div ref="transcriptEl" class="max-h-[290px] overflow-y-auto px-2 py-2">
              <div v-if="!subtitles.length" class="px-3 py-8 text-center text-[12px] text-mist-500">
                字幕会按时间顺序出现在这里。
              </div>
              <div
                v-for="line in [...subtitles].reverse()"
                :key="line.id"
                class="group flex gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.035]"
              >
                <span class="mt-0.5 w-9 shrink-0 font-mono text-[10px] text-mist-600 tabular-nums">
                  {{ formatTime(line.at) }}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-[9.5px] tracking-[0.1em] text-iris-300/70">
                      {{ line.speaker }}
                    </span>
                    <span class="text-[9.5px] text-mist-600">{{ line.latency }} ms</span>
                  </div>
                  <p class="mt-0.5 truncate text-[11px] text-mist-500">{{ line.source }}</p>
                  <p class="mt-0.5 text-[12.5px] leading-relaxed text-mist-100">{{ line.target }}</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- Right rail -->
        <aside class="space-y-4">
          <!-- Languages -->
          <section class="glass rounded-2xl p-4">
            <div class="mb-3 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Languages class="h-4 w-4 text-iris-300" />
                <h3 class="text-[13px] font-medium text-mist-100">语言方向</h3>
              </div>
              <span class="font-mono text-[10px] text-mist-500">{{ directionLabel }}</span>
            </div>
            <div class="grid grid-cols-[1fr_36px_1fr] items-end gap-2">
              <FieldSelect
                v-model="sourceLang"
                label="源语言"
                :options="sourceOptions"
                compact
              />
              <button
                type="button"
                class="mb-0.5 flex h-10 w-9 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-mist-400 transition-colors hover:border-iris-400/40 hover:text-iris-200"
                aria-label="交换语言"
                @click="swapLanguages"
              >
                <ArrowLeftRight class="h-3.5 w-3.5" />
              </button>
              <FieldSelect
                v-model="targetLang"
                label="目标语言"
                :options="targetOptions"
                compact
              />
            </div>
            <p class="mt-2.5 text-[11px] leading-relaxed text-mist-500">
              {{ languageLabel(sourceLang) }} → {{ languageLabel(targetLang) }} · 切换后下一条字幕生效
            </p>
          </section>

          <!-- Capture + run -->
          <section class="glass rounded-2xl p-4">
            <div class="mb-3 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Radio class="h-4 w-4 text-aqua-300" />
                <h3 class="text-[13px] font-medium text-mist-100">音频来源</h3>
              </div>
              <span
                class="rounded-full border px-2 py-0.5 font-mono text-[9.5px]"
                :class="
                  isCapturing
                    ? 'border-aqua-400/25 bg-aqua-400/10 text-aqua-300'
                    : 'border-white/8 bg-white/[0.03] text-mist-500'
                "
              >
                {{ isCapturing ? captureLabel : 'OFF' }}
              </span>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors"
                :class="
                  captureLabel === '麦克风'
                    ? 'border-aqua-400/35 bg-aqua-400/10 text-aqua-200'
                    : 'border-white/8 bg-white/[0.03] text-mist-300 hover:border-white/15'
                "
                @click="useMicrophone"
              >
                <Mic class="h-4 w-4 shrink-0" />
                <span class="min-w-0">
                  <span class="block text-[11.5px] font-medium">麦克风</span>
                  <span class="block text-[9.5px] text-mist-500">现场 / 会议</span>
                </span>
              </button>
              <button
                type="button"
                class="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors"
                :class="
                  captureLabel === '标签页音频'
                    ? 'border-aqua-400/35 bg-aqua-400/10 text-aqua-200'
                    : 'border-white/8 bg-white/[0.03] text-mist-300 hover:border-white/15'
                "
                @click="shareTabAudio"
              >
                <MonitorUp class="h-4 w-4 shrink-0" />
                <span class="min-w-0">
                  <span class="block text-[11.5px] font-medium">标签页</span>
                  <span class="block text-[9.5px] text-mist-500">视频 / 直播</span>
                </span>
              </button>
            </div>

            <button
              v-if="isCapturing"
              type="button"
              class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/8 py-1.5 text-[10.5px] text-mist-400 transition-colors hover:border-rose-glow/30 hover:text-rose-200"
              @click="stopCapture"
            >
              <X class="h-3 w-3" />
              断开音频
            </button>

            <div v-if="showSettingsHint" class="mt-3 rounded-xl border border-amber-glow/25 bg-amber-glow/8 p-2.5">
              <p class="text-[11px] leading-relaxed text-amber-glow">
                尚未配置 MOSS Key，真实听译不可用。
              </p>
              <button
                type="button"
                class="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-glow hover:underline"
                @click="setView('settings')"
              >
                <Settings2 class="h-3 w-3" />
                前往配置
              </button>
            </div>

            <button
              type="button"
              class="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-semibold transition-all active:scale-[0.99]"
              :class="
                isRunning
                  ? 'border border-rose-glow/30 bg-rose-glow/12 text-rose-200 hover:bg-rose-glow/18'
                  : 'bg-gradient-to-r from-iris-500 via-iris-500 to-aqua-500 text-white shadow-[0_16px_40px_-16px_rgba(124,92,255,0.8)] hover:brightness-110'
              "
              @click="toggleSession"
            >
              <Square v-if="isRunning" class="h-4 w-4 fill-current" />
              <Play v-else class="h-4 w-4 fill-current" />
              {{ isRunning ? '结束会话' : engine === 'moss' ? '开始实时听译' : '播放演示字幕' }}
            </button>

            <div class="mt-2 flex items-center justify-between text-[10px] text-mist-600">
              <span class="inline-flex items-center gap-1">
                <LoaderCircle v-if="isRunning && engine === 'moss'" class="h-3 w-3 animate-spin" />
                {{ engine === 'moss' ? '6s 分段 · 自动翻译' : '内置双语脚本' }}
              </span>
              <button
                v-if="isCapturing"
                type="button"
                class="inline-flex items-center gap-1 text-mist-500 hover:text-mist-300"
                @click="toggleCapture"
              >
                <Mic class="h-3 w-3" />
                切换
              </button>
            </div>
          </section>

          <!-- Media preview -->
          <section class="glass rounded-2xl p-4">
            <div class="mb-3 flex items-center gap-2">
              <Film class="h-4 w-4 text-mist-400" />
              <h3 class="text-[13px] font-medium text-mist-100">媒体预览</h3>
            </div>
            <input
              ref="fileInput"
              type="file"
              accept="video/*,audio/*"
              class="hidden"
              @change="onMediaPicked"
            />
            <button
              v-if="!mediaUrl"
              type="button"
              class="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-center transition-colors hover:border-iris-400/35 hover:bg-white/[0.04]"
              @click="pickMedia"
            >
              <Upload class="h-4 w-4 text-mist-500" />
              <span class="text-[11.5px] text-mist-300">上传视频 / 音频画面</span>
              <span class="text-[10px] text-mist-600">仅作背景预览，不参与音频采集</span>
            </button>
            <div v-else class="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-iris-500/12 text-iris-300"
              >
                <Film v-if="mediaKind === 'video'" class="h-4 w-4" />
                <AudioLines v-else class="h-4 w-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[11.5px] text-mist-200">{{ mediaName }}</p>
                <p class="text-[9.5px] text-mist-500">{{ mediaKind === 'video' ? '视频' : '音频' }} · 静音预览</p>
              </div>
              <button
                type="button"
                class="rounded-lg p-1.5 text-mist-500 transition-colors hover:bg-rose-glow/10 hover:text-rose-200"
                aria-label="移除媒体"
                @click="clearMedia"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
            <p class="mt-2 text-[10.5px] leading-relaxed text-mist-600">
              本地文件不会上传。实时音频仍由上方麦克风或标签页共享提供。
            </p>
          </section>

          <p class="px-1 text-[10.5px] leading-relaxed text-mist-600">
            音频在浏览器内按 16 kHz / 320 samples 分帧；密钥仅保存在本机
            <code class="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px]">localStorage</code>。
          </p>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-enter-active,
.line-leave-active {
  transition:
    opacity 0.24s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.line-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.line-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>

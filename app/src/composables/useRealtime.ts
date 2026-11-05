import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { friendlyError } from '@lib/errors'
import { languageShort } from '@lib/models'
import { transcribeAudio, translateText } from '@lib/moss'
import { clamp, sleep, uid } from '@lib/utils'
import { useSettings } from './useSettings'
import { checkCaptureSupport, mapCaptureErrorToHint } from '@lib/permissions'
import type { AppConfig } from '@lib/providers'

export interface SubtitleLine {
  id: string
  at: number
  /** End timestamp (seconds relative to session start). */
  endedAt: number
  source: string
  target: string
  speaker: string
  latency: number
}

type Engine = 'demo' | 'moss'
type MediaKind = 'video' | 'audio'

const DEMO_LINES = [
  {
    en: 'Welcome back to the deep dive on real-time translation.',
    zh: '欢迎回到实时翻译的深度解析。',
    speaker: 'SPEAKER 01',
  },
  {
    en: 'Latency is the single most important metric in this pipeline.',
    zh: '延迟是这条链路中最重要的指标。',
    speaker: 'SPEAKER 01',
  },
  {
    en: 'We capture the tab audio directly, so the original video never gets muted.',
    zh: '我们直接捕获标签页音频，因此原视频永远不会被静音。',
    speaker: 'SPEAKER 02',
  },
  {
    en: 'Every subtitle is translated in context, not word by word.',
    zh: '每条字幕都结合上下文翻译，而不是逐词直译。',
    speaker: 'SPEAKER 01',
  },
  {
    en: 'The whole system runs on free multimodal models.',
    zh: '整套系统运行在免费的多模态模型之上。',
    speaker: 'SPEAKER 02',
  },
  {
    en: 'And yes, you can switch languages without restarting the session.',
    zh: '而且无需重启会话即可切换语言。',
    speaker: 'SPEAKER 01',
  },
  {
    en: 'Look at the waveform on the left — that is the live audio level.',
    zh: '请看左侧的波形，这就是实时音频电平。',
    speaker: 'SPEAKER 02',
  },
  {
    en: 'That is the full-duplex loop closing in under a second.',
    zh: '这就是一秒内闭合的全双工回路。',
    speaker: 'SPEAKER 01',
  },
]

const engine = ref<Engine>('demo')
const mediaKind = ref<MediaKind>('video')
const sourceLang = ref('en')
const targetLang = ref('zh')

const isRunning = ref(false)
const isCapturing = ref(false)
const captureLabel = ref('')
const level = ref(0)
const elapsed = ref(0)
const subtitles = ref<SubtitleLine[]>([])
const error = ref('')
const mediaUrl = ref<string | null>(null)
const mediaName = ref('')

let clockTimer: number | undefined
let demoCursor = 0
let startedAt = 0
let stream: MediaStream | null = null
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let waveformFrame = 0
let recorder: MediaRecorder | null = null
let analyserBuffer: Uint8Array<ArrayBuffer> | null = null
let visualiserPaused = false
let warnedTranscribe = false
let warnedOverflow = false

const MAX_SEGMENT_QUEUE = 3
const segmentQueue: Blob[] = []
let draining = false

// VAD segmentation: prefer natural pause over mechanical 6s slicing.
// A segment is cut when silence >500ms after at least 2s of speech, or at
// a hard cap of 7s (and the legacy 6s fallback when VAD is off).
const VAD_THRESHOLD = 0.045
const VAD_SILENCE_MS = 500
const VAD_MIN_SEGMENT_MS = 2000
const VAD_HARD_CAP_MS = 7000
const FALLBACK_SLICE_MS = 6000
let vadEnabled = false
let vadTimer: number | undefined
let vadSilenceStart = 0
let vadSegmentStart = 0

type SegmentBlob = Blob & { enqueuedAt?: number; endedAt?: number; durationMs?: number }

function pushSubtitle(source: string, target: string, speaker: string, latency: number, endedAt?: number) {
  subtitles.value.push({
    id: uid('sub'),
    at: elapsed.value,
    endedAt: endedAt ?? elapsed.value,
    source,
    target,
    speaker,
    latency: Math.round(latency),
  })
  if (subtitles.value.length > 200) subtitles.value.splice(0, subtitles.value.length - 200)
}

function demoDirection() {
  if (sourceLang.value === 'zh' && targetLang.value !== 'zh') {
    return { source: 'zh' as const, target: 'en' as const }
  }
  return { source: 'en' as const, target: 'zh' as const }
}

function emitDemoLine() {
  const line = DEMO_LINES[demoCursor % DEMO_LINES.length]
  demoCursor += 1
  if (!line) return
  const direction = demoDirection()
  const latency = 180 + Math.random() * 260
  if (direction.source === 'zh') {
    pushSubtitle(line.zh, line.en, line.speaker, latency)
  } else {
    pushSubtitle(line.en, line.zh, line.speaker, latency)
  }
}

function syntheticLevel() {
  const wave = Math.abs(Math.sin(elapsed.value * 2.4) * 0.55 + Math.sin(elapsed.value * 5.1) * 0.2)
  level.value = clamp(0.16 + wave * (0.55 + Math.random() * 0.25), 0, 1)
}

function startClock() {
  window.clearInterval(clockTimer)
  clockTimer = window.setInterval(() => {
    elapsed.value = (performance.now() - startedAt) / 1000
    if (!analyser) syntheticLevel()
  }, 160)
}

function bindAnalyser(mediaStream: MediaStream) {
  audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(mediaStream)
  analyser = audioContext.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.82
  source.connect(analyser)
  analyserBuffer = new Uint8Array(analyser.fftSize)
  visualiserPaused = false
  startWaveformLoop()
}

function startWaveformLoop() {
  if (!analyser || !analyserBuffer || visualiserPaused) return
  cancelAnimationFrame(waveformFrame)
  const node = analyser
  const buffer = analyserBuffer
  const loop = () => {
    if (!analyser || !analyserBuffer || visualiserPaused) {
      waveformFrame = 0
      return
    }
    node.getByteTimeDomainData(buffer)
    let sum = 0
    for (const sample of buffer) {
      const normalized = (sample - 128) / 128
      sum += normalized * normalized
    }
    const rms = Math.sqrt(sum / buffer.length)
    level.value = clamp(rms * 5.2, 0, 1)
    waveformFrame = requestAnimationFrame(loop)
  }
  waveformFrame = requestAnimationFrame(loop)
}

function pauseVisualiser() {
  visualiserPaused = true
  cancelAnimationFrame(waveformFrame)
  waveformFrame = 0
}

function resumeVisualiser() {
  visualiserPaused = false
  startWaveformLoop()
}

function detachAnalyser() {
  cancelAnimationFrame(waveformFrame)
  waveformFrame = 0
  visualiserPaused = false
  analyser = null
  analyserBuffer = null
  if (audioContext) {
    void audioContext.close().catch(() => undefined)
    audioContext = null
  }
  level.value = 0
}

function startRecorder(mediaStream: MediaStream) {
  if (recorder) return
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  recorder = new MediaRecorder(mediaStream, { mimeType })
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    const segment = event.data as SegmentBlob
    segment.enqueuedAt = performance.now()
    segment.endedAt = elapsed.value
    enqueueSegment(segment)
  }
  recorder.start(FALLBACK_SLICE_MS)
  // Enable VAD only when the capture path provides an AnalyserNode.
  vadEnabled = !!analyser
  vadSegmentStart = performance.now()
  vadSilenceStart = 0
  startVadLoop()
}

function stopVadLoop() {
  if (vadTimer !== undefined) {
    window.clearInterval(vadTimer)
    vadTimer = undefined
  }
}

function startVadLoop() {
  if (!vadEnabled || !analyser || !analyserBuffer) return
  if (vadTimer !== undefined) return
  vadTimer = window.setInterval(() => {
    if (!analyser || !analyserBuffer || !recorder || !isRunning.value || engine.value !== 'moss') return
    if (analyserBuffer.length === 0) return
    analyser.getByteTimeDomainData(analyserBuffer)
    let sum = 0
    for (const sample of analyserBuffer) {
      const normalized = (sample - 128) / 128
      sum += normalized * normalized
    }
    const rms = Math.sqrt(sum / Math.max(1, analyserBuffer.length))
    const now = performance.now()
    const segmentElapsed = now - vadSegmentStart
    if (rms < VAD_THRESHOLD) {
      if (vadSilenceStart === 0) vadSilenceStart = now
      const silenceElapsed = now - vadSilenceStart
      if (silenceElapsed >= VAD_SILENCE_MS && segmentElapsed >= VAD_MIN_SEGMENT_MS) {
        // Natural pause: flush the current segment now instead of waiting
        // for the next hard slice.
        vadSilenceStart = 0
        vadSegmentStart = now
        try {
          recorder.requestData()
        } catch {
          /* recorder already stopped */
        }
      }
    } else {
      vadSilenceStart = 0
    }
    if (segmentElapsed >= VAD_HARD_CAP_MS) {
      vadSegmentStart = now
      vadSilenceStart = 0
      try {
        recorder.requestData()
      } catch {
        /* recorder already stopped */
      }
    }
  }, 100)
}

function enqueueSegment(blob: Blob) {
  if (!isRunning.value || engine.value !== 'moss' || blob.size < 2400) return
  // Attach end timestamp if not already set by the data-available handler.
  const segmentBlob = blob as SegmentBlob
  if (typeof segmentBlob.endedAt !== 'number') segmentBlob.endedAt = elapsed.value
  segmentQueue.push(blob)
  if (segmentQueue.length > MAX_SEGMENT_QUEUE) {
    segmentQueue.shift()
    if (!warnedOverflow) {
      warnedOverflow = true
      toast.error('处理速度跟不上，已跳过部分音频片段')
    }
  }
  void drainSegments()
}

async function drainSegments() {
  if (draining) return
  draining = true
  try {
    while (segmentQueue.length > 0 && isRunning.value && engine.value === 'moss') {
      const blob = segmentQueue.shift()
      if (!blob) continue
      await processSegment(blob)
    }
  } finally {
    draining = false
  }
}

async function processSegment(blob: Blob) {
  const started = (blob as SegmentBlob).enqueuedAt ?? performance.now()
  const endedAt = (blob as SegmentBlob).endedAt ?? elapsed.value
  const { settings } = useSettings()
  const snapshot = (): AppConfig => JSON.parse(JSON.stringify(settings)) as AppConfig
  const doTranscribe = async (): Promise<string> => {
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await transcribeAudio(blob, { config: snapshot() })
      } catch (err) {
        lastErr = err
        if (attempt === 0) await sleep(300)
      }
    }
    throw lastErr
  }
  try {
    const text = await doTranscribe()
    if (!text) return
    const translated = await translateText(text, {
      source: sourceLang.value,
      target: targetLang.value,
      config: snapshot(),
    })
    if (isRunning.value) {
      pushSubtitle(text, translated || text, captureLabel.value || 'LIVE', performance.now() - started, endedAt)
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message.toLowerCase() : ''
    const isAuthOrQuota = raw.includes('401') || raw.includes('403') || raw.includes('quota') || raw.includes('unauthorized')
    const message = isAuthOrQuota
      ? `${friendlyError(err)} 请检查 API Key 或额度。`
      : friendlyError(err)
    error.value = message
    if (!warnedTranscribe) {
      warnedTranscribe = true
      toast.error(`实时听写失败：${message}`)
    }
  }
}

async function startMic() {
  const support = await checkCaptureSupport()
  if (!support.ok) {
    toast.error(support.hint ?? '当前浏览器不支持麦克风采集')
    return false
  }
  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    attachStream(mediaStream, '麦克风')
    return true
  } catch (err) {
    const hint = mapCaptureErrorToHint(err, 'microphone')
    toast.error(hint)
    return false
  }
}

async function startTabAudio() {
  const support = await checkCaptureSupport()
  if (!support.ok && support.code === 'unsupported') {
    toast.error(support.hint ?? '当前环境不支持标签页音频共享')
    return false
  }
  try {
    const mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    })
    if (!mediaStream.getAudioTracks().length) {
      mediaStream.getTracks().forEach((track) => track.stop())
      toast.error('没有共享音频。请在弹窗中勾选「分享标签页音频」。')
      return false
    }
    mediaStream.getVideoTracks().forEach((track) => {
      track.onended = () => stopCapture()
    })
    attachStream(mediaStream, '标签页音频')
    return true
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'NotAllowedError'
    if (!aborted) {
      const hint = mapCaptureErrorToHint(err, 'tab')
      toast.error(hint)
    }
    return false
  }
}

function attachStream(mediaStream: MediaStream, label: string) {
  stopCapture()
  stream = mediaStream
  isCapturing.value = true
  captureLabel.value = label
  bindAnalyser(mediaStream)
  if (isRunning.value && engine.value === 'moss') startRecorder(mediaStream)
}

function stopCapture() {
  stopVadLoop()
  vadEnabled = false
  if (recorder) {
    try {
      recorder.stop()
    } catch {
      /* already stopped */
    }
    recorder = null
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop())
    stream = null
  }
  detachAnalyser()
  isCapturing.value = false
  captureLabel.value = ''
}

function start() {
  if (isRunning.value) return
  if (engine.value === 'moss' && !isCapturing.value) {
    toast.error('真实听译模式需要先开启麦克风或共享标签页音频')
    return
  }
  isRunning.value = true
  error.value = ''
  startedAt = performance.now() - elapsed.value * 1000
  startClock()

  if (engine.value === 'moss') {
    if (stream) startRecorder(stream)
  } else {
    emitDemoLine()
    window.clearInterval(demoTimer)
    demoTimer = window.setInterval(emitDemoLine, 3200)
  }
}

let demoTimer: number | undefined

function stop() {
  isRunning.value = false
  window.clearInterval(clockTimer)
  window.clearInterval(demoTimer)
  clockTimer = undefined
  demoTimer = undefined
  segmentQueue.length = 0
  stopCapture()
}

function reset() {
  stop()
  subtitles.value = []
  elapsed.value = 0
  error.value = ''
  demoCursor = 0
  warnedTranscribe = false
  warnedOverflow = false
}

function loadMediaFile(file: File) {
  clearMedia()
  mediaKind.value = file.type.startsWith('audio/') ? 'audio' : 'video'
  mediaUrl.value = URL.createObjectURL(file)
  mediaName.value = file.name
}

function clearMedia() {
  if (mediaUrl.value) URL.revokeObjectURL(mediaUrl.value)
  mediaUrl.value = null
  mediaName.value = ''
}

const stats = computed(() => {
  const lines = subtitles.value
  const words = lines.reduce((total, line) => {
    const sourceWords = line.source.trim().split(/\s+/).filter(Boolean).length
    return total + (sourceWords > 1 ? sourceWords : Math.ceil(line.source.length / 2))
  }, 0)
  const avgLatency = lines.length
    ? Math.round(lines.reduce((total, line) => total + line.latency, 0) / lines.length)
    : 0
  return { lines: lines.length, words, avgLatency }
})

const directionLabel = computed(
  () => `${languageShort(sourceLang.value)} → ${languageShort(targetLang.value)}`,
)

export function useRealtime() {
  return {
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
    error,
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
  }
}

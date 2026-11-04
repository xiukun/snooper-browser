import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { friendlyError } from '@/lib/errors'
import { languageShort } from '@/lib/models'
import { transcribeAudio, translateText } from '@/lib/moss'
import { clamp, uid } from '@/lib/utils'
import { useSettings } from './useSettings'

export interface SubtitleLine {
  id: string
  at: number
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
let processing = false
let warnedTranscribe = false

function pushSubtitle(source: string, target: string, speaker: string, latency: number) {
  subtitles.value.push({
    id: uid('sub'),
    at: elapsed.value,
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
  const buffer = new Uint8Array(analyser.fftSize)

  const loop = () => {
    if (!analyser) return
    analyser.getByteTimeDomainData(buffer)
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

function detachAnalyser() {
  cancelAnimationFrame(waveformFrame)
  waveformFrame = 0
  analyser = null
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
    void handleSegment(event.data)
  }
  recorder.start(6000)
}

async function handleSegment(blob: Blob) {
  if (!isRunning.value || engine.value !== 'moss' || processing || blob.size < 2400) return
  processing = true
  const started = performance.now()
  const { settings } = useSettings()
  try {
    const text = await transcribeAudio(blob, { config: { ...settings } })
    if (!text) return
    const translated = await translateText(text, {
      source: sourceLang.value,
      target: targetLang.value,
      config: { ...settings },
    })
    if (isRunning.value) {
      pushSubtitle(text, translated || text, captureLabel.value || 'LIVE', performance.now() - started)
    }
  } catch (err) {
    const message = friendlyError(err)
    error.value = message
    if (!warnedTranscribe) {
      warnedTranscribe = true
      toast.error(`实时听写失败：${message}`)
    }
  } finally {
    processing = false
  }
}

async function startMic() {
  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    attachStream(mediaStream, '麦克风')
    return true
  } catch (err) {
    toast.error(err instanceof Error ? `无法访问麦克风：${err.message}` : '无法访问麦克风')
    return false
  }
}

async function startTabAudio() {
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
      toast.error(err instanceof Error ? `无法共享音频：${err.message}` : '无法共享音频')
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
  stopCapture()
}

function reset() {
  stop()
  subtitles.value = []
  elapsed.value = 0
  error.value = ''
  demoCursor = 0
  warnedTranscribe = false
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
    loadMediaFile,
    clearMedia,
  }
}

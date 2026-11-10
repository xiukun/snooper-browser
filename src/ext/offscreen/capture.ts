/**
 * Offscreen capture sessions.
 *
 * One CaptureSession per tab: tab audio + a low-frame-rate video track,
 * energy-aware segmentation, ASR → translation, and teardown. The offscreen
 * document keeps every session independent so two tabs can record at once.
 */

import type { AppConfig } from '../../lib/providers'
import { classifyAudioFrames } from '../../lib/audio-noise-gate'
import { classifyPcmSpectrum } from '../../lib/audio-spectrum-gate'
import {
  isCurrentCaptureGeneration,
  requestCaptureGeneration,
  stopCaptureGeneration,
  type CaptureGenerationState,
} from '../../lib/capture-generation'
import { runKeyedTask } from '../../lib/keyed-task'
import { shouldSkipTranslation } from '../../lib/passthrough'
import {
  isLikelyAsrHallucination,
  isLikelyAsrHallucinationSequence,
  isLikelyAsrLanguageMismatch,
  isLikelyAsrRepeatLoop,
  isLikelyShortRepeatLoop,
  isLikelySparseTranscript,
  isLikelyArtifactBurst,
  isArtifactLine,
  isFillerOnly,
} from '../../lib/asr-guard'
import {
  computeRMS,
  speechDurationMs,
  trimToSpeechBounds,
  MIN_SPEECH_MS,
} from '../../lib/audio-segments'
import {
  createWavBlob,
  FRAME_SIZE,
  MAX_QUEUE_SIZE,
  MAX_SEGMENT_DURATION_MS,
  MIN_SEGMENT_DURATION_MS,
  SILENCE_RMS_THRESHOLD,
  SILENCE_THRESHOLD_MS,
  TARGET_SAMPLE_RATE,
} from './audio'
import { transcribeAudio, translateTextStream } from './api'

const WORKLET_PATH = chrome.runtime.getURL('audio-worklet.js')

/**
 * Explicit STOP keeps the offscreen document alive this long so a segment
 * already in ASR/translation can still emit its final line (ADR-031). The
 * bound keeps the stop response from hanging on a stalled provider.
 */
const STOP_DRAIN_MS = 4000

/**
 * ADR-042: evidence windows describe one noise episode. A gap longer than
 * this means the previous lines can no longer explain the current one.
 */
const ASR_EVIDENCE_RESET_MS = 60000

export interface CaptureSession {
  tabId: number
  generation: number
  sourceLang: string
  targetLang: string
  config: AppConfig
  mediaStream: MediaStream | null
  audioCtx: AudioContext | null
  monitorAudioCtx: AudioContext | null
  workletNode: AudioWorkletNode | null
  pcmBuffer: Int16Array[]
  lastChunkTime: number
  segmentStartTime: number
  lastSilenceTime: number
  isSilent: boolean
  pendingTranscriptions: number
  currentAskController: AbortController | null
  aborted: boolean
  /** Teardown started: no new audio may be segmented. */
  captureStopped: boolean
  /**
   * Explicit stop is waiting (bounded) for in-flight ASR/translation so the
   * final line still reaches the transcript (ADR-031).
   */
  draining: boolean
  videoEl: HTMLVideoElement | null
  /** Per-frame RMS, aligned with pcmBuffer, used to trim edges. */
  frameRms: number[]
  /** Per-frame sample counts, aligned with pcmBuffer. */
  frameLens: number[]
  /** True while the last few seconds produced nothing above the gate. */
  audioSilent: boolean
  recentContext?: { source: string; target: string }[]
  /**
   * Rejected ASR lines — burst evidence. Cleared whenever a line is accepted,
   * so only the current noise episode counts.
   */
  recentAsrCandidates: string[]
  /**
   * ADR-042: accepted and rejected weak lines (fillers and stock artifacts)
   * since the last contentful line. Bounds the artifact-burst rule; cleared
   * by real content and after a long silence.
   */
  recentWeakWindow: string[]
  /** Wall clock of the last ASR result, used to expire evidence windows. */
  lastAsrAt: number
  /**
   * All recent ASR lines, accepted and rejected — repeat evidence. Only a
   * loop that survives a real transcript is impossible, so the window resets
   * on accepted lines too... except the loop signature itself (see
   * finalizeSegment: an accepted generic stock line is still recorded here,
   * because the very first repeat needs one accepted generic line before the
   * second one can be confirmed as a loop).
   */
  recentAsrWindow: string[]
}

export const captureSessions = new Map<number, CaptureSession>()

/* ===== Context tracking ===== */

const MAX_CONTEXT_ENTRIES = 5

function getContextSummary(session: CaptureSession): string {
  const ctx = session.recentContext || []
  if (ctx.length === 0) return ''
  return ctx
    .slice(-MAX_CONTEXT_ENTRIES)
    .map((c, i) => `[${i + 1}] ${c.source || '(silence)'} → ${c.target || '(silence)'}`)
    .join('\n')
}

function pushContext(session: CaptureSession, source: string, target: string) {
  if (!session.recentContext) session.recentContext = []
  session.recentContext.push({ source, target })
  if (session.recentContext.length > MAX_CONTEXT_ENTRIES * 2) {
    session.recentContext = session.recentContext.slice(-MAX_CONTEXT_ENTRIES)
  }
}

/* ===== Start / stop ===== */

interface StartCaptureArgs {
  tabId: number
  streamId: string
  sourceLang: string
  targetLang: string
  config: AppConfig
  generation: number
}

/**
 * Serialize capture starts per tab.
 *
 * `startTabCapture` is async (getUserMedia + AudioWorklet). Two overlapping
 * starts used to interleave here: the second one stopped the first while it
 * was still initializing, then replaced its map entry. The first pipeline
 * survived and kept pushing PCM into `onPcmChunk(tabId)`, which resolves the
 * *second* session from the map — duplicated audio, duplicated ASR cost, and
 * slower subtitles. One start per tab at a time, always.
 */
const startLocks = new Map<number, Promise<unknown>>()
const startTasks = new Map<number, Map<number, Promise<{ ok: true }>>>()
const generationStates = new Map<number, CaptureGenerationState>()

function generationState(tabId: number): CaptureGenerationState {
  let state = generationStates.get(tabId)
  if (!state) {
    state = { stopped: -1 }
    generationStates.set(tabId, state)
  }
  return state
}

export function startTabCapture(args: StartCaptureArgs): Promise<{ ok: true }> {
  const { tabId, generation } = args
  const state = generationState(tabId)
  if (!requestCaptureGeneration(state, generation)) {
    return Promise.resolve({ ok: true })
  }

  const existing = captureSessions.get(tabId)
  if (existing?.generation === generation && !existing.aborted) {
    return Promise.resolve({ ok: true })
  }

  let tasksForTab = startTasks.get(tabId)
  const existingTask = tasksForTab?.get(generation)
  if (existingTask) return existingTask

  if (!tasksForTab) {
    tasksForTab = new Map()
    startTasks.set(tabId, tasksForTab)
  }

  const task = runKeyedTask(startLocks, tabId, 'queue', () => {
    if (!isCurrentStart(tabId, generation)) return Promise.resolve({ ok: true })
    return startTabCaptureNow(args)
  })
  tasksForTab.set(generation, task)
  const cleanup = () => {
    if (tasksForTab?.get(generation) === task) tasksForTab.delete(generation)
    if (tasksForTab?.size === 0 && startTasks.get(tabId) === tasksForTab) {
      startTasks.delete(tabId)
    }
  }
  task.then(cleanup, cleanup)
  return task
}

function isCurrentStart(tabId: number, generation: number): boolean {
  return isCurrentCaptureGeneration(generationState(tabId), generation)
}

async function startTabCaptureNow({ tabId, streamId, sourceLang, targetLang, config, generation }: StartCaptureArgs): Promise<{ ok: true }> {
  await stopCurrentCapture(tabId)
  if (!isCurrentStart(tabId, generation)) return { ok: true }

  const session: CaptureSession = {
    tabId,
    generation,
    sourceLang,
    targetLang,
    config: JSON.parse(JSON.stringify(config)),
    mediaStream: null,
    audioCtx: null,
    monitorAudioCtx: null,
    workletNode: null,
    pcmBuffer: [],
    lastChunkTime: 0,
    segmentStartTime: Date.now(),
    lastSilenceTime: 0,
    isSilent: false,
    pendingTranscriptions: 0,
    currentAskController: null,
    aborted: false,
    captureStopped: false,
    draining: false,
    videoEl: null,
    frameRms: [],
    frameLens: [],
    audioSilent: false,
    recentAsrCandidates: [],
    recentAsrWindow: [],
    recentWeakWindow: [],
    lastAsrAt: 0,
  }
  captureSessions.set(tabId, session)
  ensureKeepAlive()

  try {
    const audioConstraints = {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    } as any
    // A low-frame-rate video track lets CAPTURE_FRAME grab the visible tab
    // while recording: chrome.tabs.captureVisibleTab refuses to work then.
    const videoConstraints = {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 5,
      },
    } as any

    let mediaStream: MediaStream
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints,
      })
    } catch (videoErr) {
      // A few tabs (DRM players, occluded windows) reject the video track.
      // Recording must never fail because of it; screenshots just degrade.
      console.warn('[RTTS] video track unavailable, falling back to audio only:', videoErr)
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      })
    }

    // STOP can land while getUserMedia is pending. The offscreen map no
    // longer contains this session, so nobody would ever stop the stream
    // that just resolved — it must be closed here instead of leaked.
    if (
      session.aborted ||
      captureSessions.get(tabId) !== session ||
      !isCurrentStart(tabId, generation)
    ) {
      mediaStream.getTracks().forEach((track) => track.stop())
      return { ok: true }
    }

    session.mediaStream = mediaStream

    // A captured tab ignores (or pauses) tabCapture streams when the track
    // ends – e.g. the user stops sharing or the tab crashes. Without this the
    // toolbar kept saying "recording" forever.
    for (const track of mediaStream.getTracks()) {
      track.addEventListener('ended', () => {
        const current = captureSessions.get(tabId)
        // `stop()` normally does not fire `ended`, but guard anyway so a
        // teardown can never re-enter stopTabCapture.
        if (!current || current.aborted || current.generation !== generation) return
        chrome.runtime.sendMessage({
          type: 'CAPTURE_ENDED',
          tabId,
          generation,
          reason: track.kind,
        }).catch(() => {})
        stopTabCapture(tabId, generation)
      })
    }

    if (mediaStream.getVideoTracks().length > 0) {
      const videoEl = document.createElement('video')
      videoEl.srcObject = mediaStream
      videoEl.muted = true
      videoEl.playsInline = true
      videoEl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none'
      document.body.appendChild(videoEl)
      videoEl.play().catch(() => {})
      session.videoEl = videoEl
    }

    session.audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
    session.monitorAudioCtx = new AudioContext()

    const sourceNode = session.audioCtx.createMediaStreamSource(session.mediaStream)
    await session.audioCtx.audioWorklet.addModule(WORKLET_PATH)
    // The context may have been closed by STOP while the worklet module was
    // loading. Building a node on it would throw and bury the real reason.
    if (
      session.aborted ||
      captureSessions.get(tabId) !== session ||
      !isCurrentStart(tabId, generation)
    ) {
      await stopCurrentCapture(tabId, session)
      return { ok: true }
    }

    session.workletNode = new AudioWorkletNode(session.audioCtx, 'rtts-audio-processor', {
      processorOptions: { frameSize: FRAME_SIZE },
    })

    session.workletNode.port.onmessage = (event) => {
      const msg = event.data
      if (msg.type === 'pcm') {
        onPcmChunk(tabId, msg)
      }
    }

    sourceNode.connect(session.workletNode)

    // Monitor playback (prevents tab mute)
    const monitorSource = session.monitorAudioCtx.createMediaStreamSource(session.mediaStream)
    const monitorGain = session.monitorAudioCtx.createGain()
    monitorGain.gain.value = 1.0
    monitorSource.connect(monitorGain)
    monitorGain.connect(session.monitorAudioCtx.destination)

    chrome.runtime.sendMessage({
      type: 'CAPTURE_STARTED',
      tabId,
      generation,
    })

    return { ok: true }
  } catch (err) {
    await stopCurrentCapture(tabId, session)
    throw err
  }
}

export async function stopTabCapture(tabId: number, generation?: number, drain = false): Promise<void> {
  const session = captureSessions.get(tabId)
  const result = stopCaptureGeneration(
    generationState(tabId),
    session?.generation,
    generation,
  )
  if (!result.stopActive) return
  await runKeyedTask(
    startLocks,
    tabId,
    'queue',
    () => stopCurrentCapture(tabId, session, drain),
  )
}

async function stopCurrentCapture(tabId: number, expectedSession?: CaptureSession, drain = false): Promise<void> {
  const session = captureSessions.get(tabId)
  if (!session || (expectedSession && session !== expectedSession)) return

  // From here on no new audio is segmented. An explicit stop keeps `aborted`
  // false for a bounded drain so ASR/translation already in flight can still
  // emit its final line; every other teardown (restart, tab close) aborts now.
  session.captureStopped = true
  session.draining = drain
  if (!drain) session.aborted = true

  if (session.currentAskController) {
    session.currentAskController.abort()
    session.currentAskController = null
  }

  if (session.workletNode) {
    session.workletNode.port.onmessage = null
    session.workletNode.disconnect()
    session.workletNode = null
  }

  if (session.videoEl) {
    session.videoEl.pause()
    session.videoEl.srcObject = null
    session.videoEl.remove()
    session.videoEl = null
  }

  if (session.mediaStream) {
    session.mediaStream.getTracks().forEach((track) => track.stop())
  }

  // Stop the native tab-capture tracks before waiting on Web Audio teardown.
  // Chrome will otherwise keep the tab stream active while an AudioContext is
  // closing, causing the next tabCapture.getMediaStreamId() to be rejected.
  await Promise.allSettled([
    session.audioCtx && session.audioCtx.state !== 'closed'
      ? session.audioCtx.close()
      : Promise.resolve(),
    session.monitorAudioCtx && session.monitorAudioCtx.state !== 'closed'
      ? session.monitorAudioCtx.close()
      : Promise.resolve(),
  ])

  // Give an in-flight segment a short window to finish before the document is
  // allowed to close. Without this the last line of the session is dropped.
  if (drain) await waitForPendingTranscriptions(session, STOP_DRAIN_MS)
  session.aborted = true
  session.draining = false

  if (captureSessions.get(tabId) === session) captureSessions.delete(tabId)
  stopKeepAliveIfIdle()
}

/**
 * Bounded wait for in-flight ASR/translation. Polling is sufficient: the
 * window is short and only this document owns the timer.
 */
async function waitForPendingTranscriptions(session: CaptureSession, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (session.pendingTranscriptions > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/* ===== PCM pipeline ===== */

function onPcmChunk(tabId: number, msg: any) {
  const session = captureSessions.get(tabId)
  if (!session || session.aborted || session.captureStopped) return

  const pcmData = new Int16Array(msg.buffer)
  session.pcmBuffer.push(pcmData)
  session.lastChunkTime = Date.now()

  // Track energy per frame while it is still cheap: trimming and the
  // "is this segment worth transcribing at all" decision both need it.
  const rms = computeRMS(pcmData)
  session.frameRms.push(rms)
  session.frameLens.push(pcmData.length)

  checkSegment(tabId)
}

/**
 * Drop leading frames until the buffer is at most `maxMs` long. Used when the
 * ASR queue is saturated: without it the buffer grows without bound and one
 * enormous segment is eventually shipped, which both the model and the user
 * read as "subtitles unrelated to what is on screen".
 */
function trimBufferToMax(session: CaptureSession, maxMs: number) {
  const maxSamples = Math.floor((TARGET_SAMPLE_RATE * maxMs) / 1000)
  let total = session.pcmBuffer.reduce((sum, buf) => sum + buf.length, 0)
  while (total > maxSamples && session.pcmBuffer.length > 1) {
    const first = session.pcmBuffer[0]!
    const excess = total - maxSamples
    if (first.length <= excess) {
      session.pcmBuffer.shift()
      session.frameRms.shift()
      session.frameLens.shift()
      total -= first.length
    } else {
      const kept = first.slice(excess)
      session.pcmBuffer[0] = kept
      session.frameLens[0] = kept.length
      total = maxSamples
    }
  }
}

/** Let the UI explain "recording, but nothing is coming in". */
function reportAudioState(session: CaptureSession, silent: boolean) {
  if (session.audioSilent === silent) return
  session.audioSilent = silent
  chrome.runtime.sendMessage({
    type: 'CAPTURE_AUDIO_STATE',
    tabId: session.tabId,
    generation: session.generation,
    silent,
  }).catch(() => {
    // Background may be restarting; the next state change will retry.
  })
}

export function checkSegment(tabId: number) {
  const session = captureSessions.get(tabId)
  if (!session || session.aborted || session.captureStopped) return

  // Backpressure: never let the buffer grow past one segment's worth while a
  // slow ASR request is still in flight.
  if (session.pendingTranscriptions >= MAX_QUEUE_SIZE) {
    trimBufferToMax(session, MAX_SEGMENT_DURATION_MS)
    return
  }

  const now = Date.now()
  const segmentDuration = now - session.segmentStartTime

  if (segmentDuration < MIN_SEGMENT_DURATION_MS) return

  const recentPcm = getRecentPcm(session, TARGET_SAMPLE_RATE * 0.2)
  const rms = computeRMS(recentPcm)

  if (rms < SILENCE_RMS_THRESHOLD) {
    if (!session.isSilent) {
      session.isSilent = true
      session.lastSilenceTime = now
    } else if (now - session.lastSilenceTime >= SILENCE_THRESHOLD_MS) {
      finalizeSegment(tabId)
    }
  } else {
    session.isSilent = false
    session.lastSilenceTime = 0
  }

  if (segmentDuration >= MAX_SEGMENT_DURATION_MS) {
    finalizeSegment(tabId)
  }
}

function getRecentPcm(session: CaptureSession, durationMs: number): Int16Array {
  const samplesNeeded = Math.floor(TARGET_SAMPLE_RATE * (durationMs / 1000))
  const allPcm = concatPcm(session.pcmBuffer)
  if (allPcm.length <= samplesNeeded) return allPcm
  return allPcm.slice(allPcm.length - samplesNeeded)
}

function concatPcm(buffers: Int16Array[]): Int16Array {
  const totalLen = buffers.reduce((sum, buf) => sum + buf.length, 0)
  const result = new Int16Array(totalLen)
  let offset = 0
  for (const buf of buffers) {
    result.set(buf, offset)
    offset += buf.length
  }
  return result
}

/* ===== Segment finalization ===== */

/**
 * Final subtitles are awaited during an explicit stop so the STOP response
 * cannot finalize the transcript before the last line is delivered. Normal
 * operation stays fire-and-forget.
 */
async function emitFinalSubtitle(session: CaptureSession, payload: Record<string, unknown>): Promise<void> {
  const message = {
    type: 'CAPTURE_SUBTITLE',
    tabId: session.tabId,
    generation: session.generation,
    ...payload,
  }
  if (session.draining) {
    await chrome.runtime.sendMessage(message).catch(() => {})
    return
  }
  chrome.runtime.sendMessage(message).catch(() => {})
}

async function finalizeSegment(tabId: number) {
  const session = captureSessions.get(tabId)
  if (!session) return

  if (session.pendingTranscriptions >= MAX_QUEUE_SIZE) return

  const segmentStartTime = session.segmentStartTime

  const rawPcm = concatPcm(session.pcmBuffer)
  const frameRms = session.frameRms
  const frameLens = session.frameLens
  const speechMs = speechDurationMs(frameRms, frameLens, TARGET_SAMPLE_RATE)
  const trimmedPcm = trimToSpeechBounds(rawPcm, frameRms, frameLens, TARGET_SAMPLE_RATE)

  // Reset the segment regardless of what happens next, otherwise one skipped
  // segment poisons every later one with stale audio.
  session.pcmBuffer = []
  session.frameRms = []
  session.frameLens = []
  session.segmentStartTime = Date.now()
  session.isSilent = false
  session.lastSilenceTime = 0

  // A segment with essentially no audio is not speech. Sending it to a
  // Whisper-family model produces an invented sentence ("Who are you?",
  // "123456789", "请不吝点赞订阅…") which translation then makes look real.
  if (speechMs < MIN_SPEECH_MS) {
    reportAudioState(session, true)
    return
  }
  const audioFeatures = classifyAudioFrames(frameRms, frameLens, TARGET_SAMPLE_RATE)
  if (!audioFeatures.accept) {
    reportAudioState(session, true)
    console.info('[RTTS] dropped non-speech audio:', {
      reason: audioFeatures.reason,
      durationMs: Math.round(frameLens.reduce((sum, length) => sum + length, 0) / TARGET_SAMPLE_RATE * 1000),
      speechRatio: Number(audioFeatures.speechRatio.toFixed(3)),
      transitions: audioFeatures.transitions,
      variation: Number(audioFeatures.variation.toFixed(3)),
    })
    return
  }
  // Spectrum-shape gate: catches rhythmic music (energy varies frame to
  // frame, so the RMS gate above passes it) by where energy sits, not how it
  // moves. Runs on trimmed PCM before ASR; logs the ratio for live tuning.
  const spectrum = classifyPcmSpectrum(trimmedPcm, TARGET_SAMPLE_RATE)
  if (!spectrum.accept) {
    reportAudioState(session, true)
    console.info('[RTTS] dropped music-like audio:', {
      speechBandRatio: Number(spectrum.speechBandRatio.toFixed(3)),
      windows: spectrum.windows,
      durationMs: Math.round((trimmedPcm.length / TARGET_SAMPLE_RATE) * 1000),
    })
    return
  }
  if (spectrum.reason === 'ok') {
    console.info('[RTTS] spectrum ok:', {
      speechBandRatio: Number(spectrum.speechBandRatio.toFixed(3)),
      windows: spectrum.windows,
    })
  }
  reportAudioState(session, false)

  const pcmData = trimmedPcm
  const durationMs = (pcmData.length / TARGET_SAMPLE_RATE) * 1000
  if (durationMs < 300) return

  session.pendingTranscriptions++

  try {
    const wavBlob = createWavBlob(pcmData, TARGET_SAMPLE_RATE)
    const t0 = performance.now()

    // 1. Transcribe the complete audio segment.
    const transcription = await transcribeAudio(wavBlob, session.config, session.sourceLang)
    if (session.aborted) return
    if (!transcription) return
    const asrMs = Math.round(performance.now() - t0)
    // Segment-level ASR trace: the primary tool for diagnosing "subtitles
    // nobody said". Every accepted line records what audio produced it, so a
    // hallucination that slips through every guard can be traced back to its
    // segment shape (duration, speech ratio) and the raw model output.
    console.log('[RTTS] ASR segment:', {
      text: transcription,
      durationMs: Math.round(durationMs),
      speechMs,
      sourceLang: session.sourceLang,
      asrMs,
    })
    const isHallucination = isLikelyAsrHallucinationSequence(
      session.recentAsrCandidates,
      transcription,
    )
    const isRepeatLoop = isLikelyAsrRepeatLoop(session.recentAsrWindow, transcription)
    // ADR-039: a gateway that ignores the `language` field returns another
    // script; translating it would disguise the failure.
    const isLanguageMismatch = isLikelyAsrLanguageMismatch(
      transcription,
      session.sourceLang,
    )
    // ADR-042: a stock line that follows a filler or another stock line is
    // the music-bridge burst. A lone stock line after content is kept.
    const asrNow = Date.now()
    if (session.lastAsrAt > 0 && asrNow - session.lastAsrAt > ASR_EVIDENCE_RESET_MS) {
      session.recentAsrCandidates = []
      session.recentAsrWindow = []
      session.recentWeakWindow = []
    }
    session.lastAsrAt = asrNow
    const isArtifactBurst = isLikelyArtifactBurst(session.recentWeakWindow, transcription)
    if (isArtifactLine(transcription) || isFillerOnly(transcription)) {
      session.recentWeakWindow = [
        ...session.recentWeakWindow.slice(-4),
        transcription,
      ]
    } else {
      session.recentWeakWindow = []
    }
    // ADR-042: seconds of continuous audio that the model reduced to a word
    // or two is a music/noise artifact, not speech.
    const isSparse = isLikelySparseTranscript(transcription, durationMs)
    if (isHallucination || isRepeatLoop || isLanguageMismatch || isSparse || isArtifactBurst) {
      // Loud music and encoder noise still reach the model even with energy
      // gating. Drop the stock phrases instead of translating them. The
      // duration and level make it possible to tune the energy gate when a
      // new hallucination pattern slips through.
      console.warn('[RTTS] dropped likely ASR hallucination:', {
        text: transcription,
        burst: isHallucination,
        repeatLoop: isRepeatLoop,
        languageMismatch: isLanguageMismatch,
        sparse: isSparse,
        artifactBurst: isArtifactBurst,
        sourceLang: session.sourceLang,
        durationMs: Math.round(durationMs),
        speechMs,
        recentCandidates: [...session.recentAsrCandidates],
        recentWindow: [...session.recentAsrWindow],
      })
      session.recentAsrCandidates = [
        ...session.recentAsrCandidates.slice(-5),
        transcription,
      ]
      session.recentAsrWindow = [
        ...session.recentAsrWindow.slice(-5),
        transcription,
      ]
      return
    }
    // A real subtitle breaks a suspected noise burst. Keeping only rejected
    // candidates avoids carrying a stale counting phrase into later dialogue.
    session.recentAsrCandidates = []
      // The repeat window is the last three lines regardless of verdict:
      // the first "Keep it up." is accepted, and only the second can
      // confirm the loop (cycles of period ≤ 3 repeat within three lines).
      // Three lines also means one long real line evicts the loop from the
      // window, so genuine speech recovers immediately.
      session.recentAsrWindow = [
        ...session.recentAsrWindow.slice(-2),
        transcription,
      ]

    const asrLatency = asrMs

    // Same-language passthrough: when the transcript already is the target
    // language (e.g. zh audio with zh subtitles), displaying it directly is
    // faster, cheaper, and avoids the LLM rewriting correct text.
    if (shouldSkipTranslation(session.sourceLang, session.targetLang, transcription)) {
      const passthroughLatency = Math.round(performance.now() - t0 + (Date.now() - segmentStartTime))
      if (session.aborted) return
      console.log('[RTTS] subtitle emitted:', {
        source: transcription,
        target: transcription,
        passthrough: true,
        asrMs,
      })
      await emitFinalSubtitle(session, {
        at: segmentStartTime,
        endedAt: Date.now(),
        source: transcription,
        target: transcription,
        latency: passthroughLatency,
      })
      return
    }

    // 2. Build context for coherent translation
    const contextSummary = getContextSummary(session)

    // 3. Send initial streaming marker (so UI shows "translating..." immediately)
    chrome.runtime.sendMessage({
      type: 'CAPTURE_SUBTITLE_STREAMING',
      tabId,
      generation: session.generation,
      at: segmentStartTime,
      source: transcription,
      partialTarget: '',
      latency: asrLatency,
    })

    // 4. Translate via SSE streaming — each delta forwarded incrementally
    let fullTranslation = ''

    const translation = await translateTextStream(transcription, {
      source: session.sourceLang,
      target: session.targetLang,
      config: session.config,
      context: contextSummary,
      onDelta: (delta) => {
        if (session.aborted || session.draining) return
        fullTranslation += delta
        const currentLatency = Math.round(
          performance.now() - t0 + (Date.now() - segmentStartTime),
        )
        chrome.runtime.sendMessage({
          type: 'CAPTURE_SUBTITLE_STREAMING',
          tabId,
          generation: session.generation,
          at: segmentStartTime,
          source: transcription,
          partialTarget: fullTranslation,
          latency: currentLatency,
        }).catch(() => {
          // Background may be busy; streaming updates are best-effort
        })
      },
    })

    // ADR-039: different fragments can collapse into the same short
    // translation ("你快" / "快快" → "Speak up."). The ASR-side repeat check
    // cannot see that; the translated line is the last chance before display.
    const recentTargets = (session.recentContext || [])
      .map((entry) => entry.target)
      .filter(Boolean)
    if (isLikelyShortRepeatLoop(recentTargets, translation)) {
      console.warn('[RTTS] dropped repeated translation:', {
        source: transcription,
        translation,
        recentTargets,
      })
      chrome.runtime.sendMessage({
        type: 'CAPTURE_SUBTITLE_STREAMING',
        tabId,
        generation: session.generation,
        at: segmentStartTime,
        source: '',
        partialTarget: '',
        latency: 0,
      }).catch(() => {})
      return
    }

    const processingMs = Math.round(performance.now() - t0)
    const llmMs = Math.max(0, processingMs - asrMs)
    const totalLatency = processingMs + (Date.now() - segmentStartTime)

    // 5. Track context for future coherence
    if (transcription && translation) {
      pushContext(session, transcription, translation)
    }

    // 6. Send final subtitle (triggers content script to finalize the entry)
    if (session.aborted) return
    console.log('[RTTS] subtitle emitted:', {
      source: transcription,
      target: translation,
      passthrough: false,
      asrMs,
      llmMs,
    })
    await emitFinalSubtitle(session, {
      at: segmentStartTime,
      endedAt: Date.now(),
      source: transcription,
      target: translation,
      latency: totalLatency,
    })
  } catch (err: any) {
    if (session.aborted) return
    console.warn('[RTTS] finalizeSegment error:', err.message)
    // Clear streaming state on error
    chrome.runtime.sendMessage({
      type: 'CAPTURE_SUBTITLE_STREAMING',
      tabId,
      generation: session.generation,
      at: segmentStartTime,
      source: '',
      partialTarget: '',
      latency: 0,
    }).catch(() => {})
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      tabId,
      generation: session.generation,
      error: err.message,
    })
  } finally {
    session.pendingTranscriptions--
  }
}

/* ===== Frame capture ===== */

export type CaptureFrameResult =
  | { ok: true; dataUrl: string; width: number; height: number }
  | { ok: false; error: string }

export async function captureVideoFrame(tabId: number): Promise<CaptureFrameResult> {
  const sess = captureSessions.get(tabId)
  if (!sess || sess.aborted || !sess.videoEl) {
    return { ok: false, error: '没有可用的视频帧' }
  }

  try {
    const video = sess.videoEl
    // A freshly created capture element can report dimensions one or two
    // frames late. Wait briefly instead of failing the screenshot.
    for (let attempt = 0; attempt < 12; attempt++) {
      if (video.readyState >= 2 && video.videoWidth > 0) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    // The content script hides the injected toolbar before asking for a
    // frame. Wait for the *next* presented frame so that hide is visible
    // in the capture; the timeout keeps paused tabs from hanging.
    if (video.readyState >= 2) {
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        const requestFrame = (video as any).requestVideoFrameCallback
        if (typeof requestFrame === 'function') {
          try {
            requestFrame.call(video, () => finish())
          } catch { /* fall through to the timeout */ }
        }
        setTimeout(finish, 400)
      })
    }
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return { ok: false, error: '录制中的视频帧尚未就绪，请稍后再试' }
    }
    const canvas = document.createElement('canvas')
    let w = video.videoWidth
    let h = video.videoHeight
    const maxW = 1600
    if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW }
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    return { ok: true, dataUrl, width: w, height: h }
  } catch (err: any) {
    return { ok: false, error: err.message || '帧捕获失败' }
  }
}

/* ===== Service-worker keepalive =====
 * MV3 background workers are suspended after ~30 s without events. A silent
 * stretch of video produced no subtitle messages, so the worker died; the
 * offscreen capture kept running, the toolbar showed "stopped", and starting
 * again failed with "Cannot capture a tab with an active stream." A message
 * every 15 s keeps the worker alive for as long as a capture exists.
 */
let keepAliveTimer: ReturnType<typeof setInterval> | null = null

function ensureKeepAlive() {
  if (keepAliveTimer !== null) return
  keepAliveTimer = setInterval(() => {
    for (const [tabId, session] of captureSessions) {
      try {
        chrome.runtime.sendMessage({
          type: 'CAPTURE_KEEPALIVE',
          tabId,
          generation: session.generation,
        }).catch(() => {})
      } catch {
        // Extension context may be gone; the next stop will clear the timer.
      }
    }
  }, 15000)
}

function stopKeepAliveIfIdle() {
  if (captureSessions.size === 0 && keepAliveTimer !== null) {
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
  }
}

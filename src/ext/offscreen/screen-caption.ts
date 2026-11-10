/**
 * Screen-caption channel (ADR-043).
 *
 * Samples the bottom strip of the captured tab video, asks the vision model to
 * read and translate it, and emits one subtitle line per changed subtitle.
 * Runs only while the user has toggled it on for a live capture.
 */

import type { AppConfig } from '../../lib/providers'
import {
  SCREEN_SAMPLE_INTERVAL_MS,
  computeStripRect,
  frameSignature,
  isDuplicateCaption,
  isSameFrame,
  type ScreenCaption,
} from '../../lib/screen-caption'
import { readScreenCaption } from './api'
import { captureSessions } from './capture'

const REQUEST_TIMEOUT_MS = 20000
const MAX_CONSECUTIVE_FAILURES = 3
const SIGNATURE_COLS = 64
const SIGNATURE_ROWS = 8
/** Signature canvas is deliberately tiny: it only gates requests. */
const SIGNATURE_WIDTH = 128

export interface ScreenCaptionOptions {
  tabId: number
  generation: number
  config: AppConfig
  targetLang: string
}

interface ScreenState {
  tabId: number
  generation: number
  config: AppConfig
  targetLang: string
  timer: ReturnType<typeof setInterval> | null
  inFlight: boolean
  stopped: boolean
  failures: number
  lastSignature: number[]
  lastCaption: ScreenCaption | null
  lastRequestAt: number
  canvas: HTMLCanvasElement | null
}

const states = new Map<number, ScreenState>()

function emit(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage(message).catch(() => {})
}

function emitStatus(state: ScreenState, status: 'active' | 'error' | 'stopped', error = ''): void {
  emit({
    type: 'CAPTURE_SCREEN_STATUS',
    tabId: state.tabId,
    generation: state.generation,
    status,
    error,
  })
}

export function isScreenCaptionActive(tabId: number): boolean {
  return states.has(tabId)
}

export function screenCaptionTargetLang(tabId: number): string | null {
  return states.get(tabId)?.targetLang ?? null
}

/** Update the language of a running channel without restarting the sampler. */
export function setScreenCaptionLang(tabId: number, targetLang: string): void {
  const state = states.get(tabId)
  if (state && targetLang) state.targetLang = targetLang
}

/**
 * Start the channel. Resolves once the sampler owns the tab, or with an error
 * when there is no live capture video to sample.
 */
export function startScreenCaption(options: ScreenCaptionOptions): { ok: boolean; error?: string } {
  const session = captureSessions.get(options.tabId)
  if (!session || session.aborted || !session.videoEl) {
    return { ok: false, error: '请先开始录音：画面字幕需要录制中的视频画面' }
  }
  if (session.generation !== options.generation) {
    return { ok: false, error: '会话已过期，请重新开始录音' }
  }

  stopScreenCaption(options.tabId)

  const state: ScreenState = {
    tabId: options.tabId,
    generation: options.generation,
    config: options.config,
    targetLang: options.targetLang,
    timer: null,
    inFlight: false,
    stopped: false,
    failures: 0,
    lastSignature: [],
    lastCaption: null,
    lastRequestAt: 0,
    canvas: null,
  }
  states.set(options.tabId, state)
  state.timer = setInterval(() => void tick(state), SCREEN_SAMPLE_INTERVAL_MS)
  emitStatus(state, 'active')
  return { ok: true }
}

export function stopScreenCaption(tabId: number): void {
  const state = states.get(tabId)
  if (!state) return
  state.stopped = true
  if (state.timer) clearInterval(state.timer)
  state.timer = null
  state.canvas = null
  states.delete(tabId)
  emitStatus(state, 'stopped')
}

export function stopAllScreenCaptions(): void {
  for (const tabId of Array.from(states.keys())) stopScreenCaption(tabId)
}

function stopWithError(state: ScreenState, error: string): void {
  if (state.stopped) return
  state.stopped = true
  if (state.timer) clearInterval(state.timer)
  state.timer = null
  states.delete(state.tabId)
  emitStatus(state, 'error', error)
}

function ensureCanvas(state: ScreenState): HTMLCanvasElement {
  if (!state.canvas) state.canvas = document.createElement('canvas')
  return state.canvas
}

interface StripSample {
  dataUrl: string
  signature: number[]
}

function sampleStrip(state: ScreenState, video: HTMLVideoElement): StripSample | null {
  const rect = computeStripRect(video.videoWidth, video.videoHeight)
  if (!rect) return null

  // 1. Tiny grayscale copy for the change gate.
  const gate = ensureCanvas(state)
  gate.width = SIGNATURE_WIDTH
  gate.height = SIGNATURE_ROWS
  const gateCtx = gate.getContext('2d', { willReadFrequently: true })
  if (!gateCtx) return null
  gateCtx.drawImage(
    video,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    SIGNATURE_WIDTH,
    SIGNATURE_ROWS,
  )
  const pixels = gateCtx.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_ROWS).data
  const signature = frameSignature(pixels, SIGNATURE_WIDTH, SIGNATURE_ROWS, SIGNATURE_COLS, SIGNATURE_ROWS)

  // 2. Full-colour strip for the model.
  const full = document.createElement('canvas')
  full.width = rect.width
  full.height = rect.height
  const ctx = full.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(
    video,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  )
  return { dataUrl: full.toDataURL('image/jpeg', 0.72), signature }
}

async function tick(state: ScreenState): Promise<void> {
  if (state.stopped || state.inFlight) return
  const session = captureSessions.get(state.tabId)
  if (!session || session.aborted || !session.videoEl) {
    stopScreenCaption(state.tabId)
    return
  }
  if (session.generation !== state.generation) {
    stopScreenCaption(state.tabId)
    return
  }

  const video = session.videoEl
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return

  const now = Date.now()
  if (now - state.lastRequestAt < SCREEN_SAMPLE_INTERVAL_MS) return

  let sample: StripSample | null = null
  try {
    sample = sampleStrip(state, video)
  } catch {
    return
  }
  if (!sample) return
  if (isSameFrame(state.lastSignature, sample.signature)) return

  state.lastSignature = sample.signature
  state.lastRequestAt = now
  state.inFlight = true

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    const caption = await readScreenCaption({
      imageDataUrl: sample.dataUrl,
      targetLang: state.targetLang,
      config: state.config,
      signal: controller.signal,
    })
    state.failures = 0
    if (!caption.source) {
      // Text-free screen: refresh freshness only, never append an empty row.
      emit({
        type: 'CAPTURE_SCREEN_SUBTITLE',
        tabId: state.tabId,
        generation: state.generation,
        at: startedAt,
        source: '',
        target: '',
        latency: Date.now() - startedAt,
      })
      return
    }
    if (isDuplicateCaption(state.lastCaption, caption)) {
      emit({
        type: 'CAPTURE_SCREEN_SUBTITLE',
        tabId: state.tabId,
        generation: state.generation,
        at: startedAt,
        source: caption.source,
        target: caption.target,
        latency: Date.now() - startedAt,
        duplicate: true,
      })
      return
    }
    state.lastCaption = caption
    emit({
      type: 'CAPTURE_SCREEN_SUBTITLE',
      tabId: state.tabId,
      generation: state.generation,
      at: startedAt,
      source: caption.source,
      target: caption.target,
      latency: Date.now() - startedAt,
    })
  } catch (err: any) {
    if (state.stopped) return
    // The frame did not make it through: clear the gate so the next tick can
    // retry the same picture. Three consecutive failures stop the channel.
    state.lastSignature = []
    state.failures += 1
    if (state.failures >= MAX_CONSECUTIVE_FAILURES) {
      stopWithError(state, err?.message || '画面字幕连续失败，已停止')
    }
  } finally {
    clearTimeout(timeout)
    state.inFlight = false
  }
}

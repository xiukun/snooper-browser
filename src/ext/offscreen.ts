/**
 * RTTS Offscreen Document — v0.5 Streaming (TypeScript)
 *
 * Handles audio capture, WAV chunking, and STREAMING API calls for
 * transcription and translation. Runs as a single offscreen document
 * managing multiple independent tab sessions.
 *
 * Streaming Architecture (ADR-008):
 *   ASR:  POST /v1/audio/transcriptions + stream=true → SSE events
 *   LLM:  POST /v1/chat/completions + stream=true → SSE delta events
 *
 * Communication:
 *   ← background: START_CAPTURE, STOP_CAPTURE, ASK_QUESTION
 *   → background: CAPTURE_SUBTITLE_STREAMING (per-delta during translation)
 *                 CAPTURE_SUBTITLE (final, completed translation)
 *                 CAPTURE_ERROR
 */

import type { AppConfig, CapabilityKey } from '../lib/providers'
import { LANGUAGES } from '../lib/models'
import { buildTranscriptionFormData } from '../lib/transcription-request'
import { shouldSkipTranslation } from '../lib/passthrough'
import {
  isLikelyAsrHallucination,
  isLikelyAsrHallucinationSequence,
} from '../lib/asr-guard'
import {
  computeRMS,
  speechDurationMs,
  trimToSpeechBounds,
  SPEECH_RMS_THRESHOLD,
  MIN_SPEECH_MS,
} from '../lib/audio-segments'

/* ===== Constants ===== */

const WORKLET_PATH = chrome.runtime.getURL('audio-worklet.js');

// Audio capture constraints
const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 320; // 20ms at 16kHz
const MIN_SEGMENT_DURATION_MS = 800;
const MAX_SEGMENT_DURATION_MS = 4000;
const SILENCE_THRESHOLD_MS = 500;
/**
 * Used by the boundary detector (speech → silence transition). Anything that
 * decides *whether* audio is worth transcribing lives in lib/audio-segments.
 */
const SILENCE_RMS_THRESHOLD = 0.045;
const MAX_QUEUE_SIZE = 3;

// Build LANG_NAMES from shared LANGUAGES (single source of truth)
const LANG_NAMES: Record<string, string> = {};
for (const lang of LANGUAGES) {
  LANG_NAMES[lang.code] = lang.label;
}

/* ===== Helpers ===== */

function createWavBlob(pcmData: Int16Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.byteLength;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  new Int16Array(buffer, 44).set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function validateRoute(config: AppConfig, capability: CapabilityKey): { provider: any; route: any } {
  if (!config || !config.routes || !config.providers) {
    throw new Error('配置缺失');
  }
  const route = config.routes[capability];
  if (!route) throw new Error(`能力 "${capability}" 未配置路由`);
  const provider = config.providers.find((p) => p.id === route.providerId);
  if (!provider) throw new Error(`服务商 "${route.providerId}" 未找到`);
  if (!provider.baseUrl) throw new Error(`服务商 "${provider.name}" 缺少 Base URL`);
  if (!provider.apiKey) throw new Error(`服务商 "${provider.name}" 缺少 API Key`);
  if (!route.model) throw new Error(`能力 "${capability}" 未选择模型`);
  return { provider, route };
}

async function apiFetch(url: string, options: RequestInit): Promise<any> {
  const res = await fetch(url, options);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const text = await res.text();
      if (text) {
        try {
          const json = JSON.parse(text);
          msg = json.error?.message || json.message || text.slice(0, 240);
        } catch {
          msg = text.slice(0, 240);
        }
      }
    } catch {
      // keep default message
    }
    throw new Error(msg);
  }
  return res.json();
}

/* ===== SSE Streaming Engine ===== */

/**
 * Extract text content from an SSE JSON event.
 * Supports multiple formats:
 *   1. OpenAI chat completions: { choices: [{ delta: { content: "..." } }] }
 *   2. Direct text field: { text: "..." }
 *   3. Content field: { content: "..." }
 * Returns null if no extractable text found.
 */
function extractSSEDelta(json: any): string | null {
  // Format 1: OpenAI chat completions SSE delta
  if (json.choices && Array.isArray(json.choices) && json.choices[0]) {
    const delta = json.choices[0].delta;
    if (delta && typeof delta.content === 'string' && delta.content.length > 0) {
      return delta.content;
    }
    // Check for finish_reason (stream done, no content)
    if (json.choices[0].finish_reason) return null;
  }
  // Format 2: Direct text field (some transcription SSE)
  if (typeof json.text === 'string' && json.text.length > 0) return json.text;
  // Format 3: Content field
  if (typeof json.content === 'string' && json.content.length > 0) return json.content;
  // Format 4: Transcription segments
  if (json.segments && Array.isArray(json.segments) && json.segments.length > 0) {
    return json.segments.map((s: any) => s.text || '').join(' ');
  }
  return null;
}

interface SSECallbacks {
  onDelta: (delta: string) => void
  onDone: () => void
  onError: (err: Error) => void
  signal?: AbortSignal
  allowNonStreamingFallback?: boolean
}

/**
 * Stream a fetch response as SSE events.
 */
async function streamSSE(url: string, options: RequestInit, callbacks: SSECallbacks) {
  const { onDelta, onDone, onError, signal, allowNonStreamingFallback = true } = callbacks;
  let response: Response;

  try {
    response = await fetch(url, { ...options, signal });
  } catch (err: any) {
    if (err.name === 'AbortError') { onDone(); return; }
    onError(err);
    return;
  }

  if (!response.ok) {
    let errorBody = '';
    try { errorBody = await response.text(); } catch { /* ignore */ }
    onError(new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`));
    return;
  }

  // Determine if the response is a stream (has body)
  const isStream = !!response.body;

  if (!isStream) {
    // Non-streaming response: read entire body, parse as JSON
    try {
      const text = await response.text();
      if (allowNonStreamingFallback) {
        try {
          const json = JSON.parse(text);
          const content = extractSSEDelta(json);
          if (content) {
            onDelta(content);
            onDone();
            return;
          }
        } catch { /* not valid JSON */ }
        if (text && text.length > 0) {
          onDelta(text);
        }
      } else if (text && text.length > 0) {
        onDelta(text);
      }
    } catch (err: any) {
      onError(err);
      return;
    }
    onDone();
    return;
  }

  // SSE streaming via ReadableStream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamDone = false;
  let lastDataTime = Date.now();

  try {
    while (!streamDone) {
      // Timeout safeguard: if no data for 30s, abort
      if (Date.now() - lastDataTime > 30000) {
        onError(new Error('SSE stream timeout (30s no data)'));
        reader.cancel();
        return;
      }

      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err: any) {
        if (err.name === 'AbortError') { onDone(); return; }
        throw err;
      }

      const { done, value } = result;
      streamDone = done;
      if (value) {
        lastDataTime = Date.now();
        buffer += decoder.decode(value, { stream: true });
      }
      if (streamDone && !buffer) break;

      // Process complete SSE events (separated by double newline)
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (!part.trim()) continue;

        // Parse data lines from the event
        let dataContent: string | null = null;
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) {
            dataContent = line.slice(6).trim();
          }
          // Also handle bare JSON lines (some endpoints omit 'data: ' prefix)
          if (!line.startsWith('data:') && !line.startsWith(':') && line.trim().startsWith('{')) {
            try { JSON.parse(line.trim()); dataContent = line.trim(); } catch { /* not JSON */ }
          }
        }

        if (dataContent === null || dataContent === '') continue;
        if (dataContent === '[DONE]') {
          onDone();
          return;
        }

        try {
          const json = JSON.parse(dataContent);
          const delta = extractSSEDelta(json);
          if (delta !== null && delta !== undefined) {
            onDelta(delta);
          }
        } catch {
          // Malformed JSON — skip this event
        }
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') { onDone(); return; }
    onError(err);
    return;
  }

  onDone();
}

/* ===== Session Management ===== */

interface CaptureSession {
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
  videoEl: HTMLVideoElement | null
  /** Per-frame RMS, aligned with pcmBuffer, used to trim edges. */
  frameRms: number[]
  /** Per-frame sample counts, aligned with pcmBuffer. */
  frameLens: number[]
  /** True while the last few seconds produced nothing above the gate. */
  audioSilent: boolean
  recentContext?: { source: string; target: string }[]
  /** Recent ASR candidates used to identify multi-segment noise bursts. */
  recentAsrCandidates: string[]
}

/** @type {Map<number, CaptureSession>} */
const captureSessions = new Map<number, CaptureSession>();

/* ===== Context Tracking ===== */

const MAX_CONTEXT_ENTRIES = 5;

function getContextSummary(session: CaptureSession): string {
  const ctx = session.recentContext || [];
  if (ctx.length === 0) return '';
  return ctx
    .slice(-MAX_CONTEXT_ENTRIES)
    .map((c, i) => `[${i + 1}] ${c.source || '(silence)'} → ${c.target || '(silence)'}`)
    .join('\n');
}

function pushContext(session: CaptureSession, source: string, target: string) {
  if (!session.recentContext) session.recentContext = [];
  session.recentContext.push({ source, target });
  if (session.recentContext.length > MAX_CONTEXT_ENTRIES * 2) {
    session.recentContext = session.recentContext.slice(-MAX_CONTEXT_ENTRIES);
  }
}

/* ===== Audio Pipeline ===== */

async function startTabCapture({ tabId, streamId, sourceLang, targetLang, config, generation }: {
  tabId: number
  streamId: string
  sourceLang: string
  targetLang: string
  config: AppConfig
  generation: number
}) {
  await stopTabCapture(tabId);

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
    videoEl: null,
    frameRms: [],
    frameLens: [],
    audioSilent: false,
    recentAsrCandidates: [],
  };
  captureSessions.set(tabId, session);
  ensureKeepAlive();

  try {
    const audioConstraints = {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    } as any;
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
    } as any;

    let mediaStream: MediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints,
      });
    } catch (videoErr) {
      // A few tabs (DRM players, occluded windows) reject the video track.
      // Recording must never fail because of it; screenshots just degrade.
      console.warn('[RTTS] video track unavailable, falling back to audio only:', videoErr);
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
    }
    session.mediaStream = mediaStream;

    // A captured tab ignores (or pauses) tabCapture streams when the track
    // ends – e.g. the user stops sharing or the tab crashes. Without this the
    // toolbar kept saying "recording" forever.
    for (const track of mediaStream.getTracks()) {
      track.addEventListener('ended', () => {
        const current = captureSessions.get(tabId);
        // `stop()` normally does not fire `ended`, but guard anyway so a
        // teardown can never re-enter stopTabCapture.
        if (!current || current.aborted || current.generation !== generation) return;
        chrome.runtime.sendMessage({
          type: 'CAPTURE_ENDED',
          tabId,
          generation,
          reason: track.kind,
        }).catch(() => {});
        stopTabCapture(tabId);
      });
    }

    if (mediaStream.getVideoTracks().length > 0) {
      const videoEl = document.createElement('video');
      videoEl.srcObject = mediaStream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none';
      document.body.appendChild(videoEl);
      videoEl.play().catch(() => {});
      session.videoEl = videoEl;
    }

    session.audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    session.monitorAudioCtx = new AudioContext();

    const sourceNode = session.audioCtx.createMediaStreamSource(session.mediaStream);
    await session.audioCtx.audioWorklet.addModule(WORKLET_PATH);

    session.workletNode = new AudioWorkletNode(session.audioCtx, 'rtts-audio-processor', {
      processorOptions: { frameSize: FRAME_SIZE },
    });

    session.workletNode.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'pcm') {
        onPcmChunk(tabId, msg);
      }
    };

    sourceNode.connect(session.workletNode);

    // Monitor playback (prevents tab mute)
    const monitorSource = session.monitorAudioCtx.createMediaStreamSource(session.mediaStream);
    const monitorGain = session.monitorAudioCtx.createGain();
    monitorGain.gain.value = 1.0;
    monitorSource.connect(monitorGain);
    monitorGain.connect(session.monitorAudioCtx.destination);

    chrome.runtime.sendMessage({
      type: 'CAPTURE_STARTED',
      tabId,
      generation,
    });

    return { ok: true };
  } catch (err) {
    await stopTabCapture(tabId);
    throw err;
  }
}

function onPcmChunk(tabId: number, msg: any) {
  const session = captureSessions.get(tabId);
  if (!session || session.aborted) return;

  const pcmData = new Int16Array(msg.buffer);
  session.pcmBuffer.push(pcmData);
  session.lastChunkTime = Date.now();

  // Track energy per frame while it is still cheap: trimming and the
  // "is this segment worth transcribing at all" decision both need it.
  const rms = computeRMS(pcmData);
  session.frameRms.push(rms);
  session.frameLens.push(pcmData.length);

  checkSegment(tabId);
}

/**
 * Drop leading frames until the buffer is at most `maxMs` long. Used when the
 * ASR queue is saturated: without it the buffer grows without bound and one
 * enormous segment is eventually shipped, which both the model and the user
 * read as "subtitles unrelated to what is on screen".
 */
function trimBufferToMax(session: CaptureSession, maxMs: number) {
  const maxSamples = Math.floor((TARGET_SAMPLE_RATE * maxMs) / 1000);
  let total = session.pcmBuffer.reduce((sum, buf) => sum + buf.length, 0);
  while (total > maxSamples && session.pcmBuffer.length > 1) {
    const first = session.pcmBuffer[0]!;
    const excess = total - maxSamples;
    if (first.length <= excess) {
      session.pcmBuffer.shift();
      session.frameRms.shift();
      session.frameLens.shift();
      total -= first.length;
    } else {
      const kept = first.slice(excess);
      session.pcmBuffer[0] = kept;
      session.frameLens[0] = kept.length;
      total = maxSamples;
    }
  }
}

/** Let the UI explain "recording, but nothing is coming in". */
function reportAudioState(session: CaptureSession, silent: boolean) {
  if (session.audioSilent === silent) return;
  session.audioSilent = silent;
  chrome.runtime.sendMessage({
    type: 'CAPTURE_AUDIO_STATE',
    tabId: session.tabId,
    generation: session.generation,
    silent,
  }).catch(() => {
    // Background may be restarting; the next state change will retry.
  });
}

function checkSegment(tabId: number) {
  const session = captureSessions.get(tabId);
  if (!session || session.aborted) return;

  // Backpressure: never let the buffer grow past one segment's worth while a
  // slow ASR request is still in flight.
  if (session.pendingTranscriptions >= MAX_QUEUE_SIZE) {
    trimBufferToMax(session, MAX_SEGMENT_DURATION_MS);
    return;
  }

  const now = Date.now();
  const segmentDuration = now - session.segmentStartTime;

  if (segmentDuration < MIN_SEGMENT_DURATION_MS) return;

  const recentPcm = getRecentPcm(session, TARGET_SAMPLE_RATE * 0.2);
  const rms = computeRMS(recentPcm);

  if (rms < SILENCE_RMS_THRESHOLD) {
    if (!session.isSilent) {
      session.isSilent = true;
      session.lastSilenceTime = now;
    } else if (now - session.lastSilenceTime >= SILENCE_THRESHOLD_MS) {
      finalizeSegment(tabId);
    }
  } else {
    session.isSilent = false;
    session.lastSilenceTime = 0;
  }

  if (segmentDuration >= MAX_SEGMENT_DURATION_MS) {
    finalizeSegment(tabId);
  }
}

function getRecentPcm(session: CaptureSession, durationMs: number): Int16Array {
  const samplesNeeded = Math.floor(TARGET_SAMPLE_RATE * (durationMs / 1000));
  const allPcm = concatPcm(session.pcmBuffer);
  if (allPcm.length <= samplesNeeded) return allPcm;
  return allPcm.slice(allPcm.length - samplesNeeded);
}

function concatPcm(buffers: Int16Array[]): Int16Array {
  const totalLen = buffers.reduce((sum, buf) => sum + buf.length, 0);
  const result = new Int16Array(totalLen);
  let offset = 0;
  for (const buf of buffers) {
    result.set(buf, offset);
    offset += buf.length;
  }
  return result;
}

/* ===== API Calls ===== */

/** Transcribe one speech segment through the non-streaming MOSS endpoint. */
async function transcribeAudio(wavBlob: Blob, config: AppConfig, sourceLang: string): Promise<string> {
  const { provider, route } = validateRoute(config, 'audio');
  const form = buildTranscriptionFormData({
    model: route.model,
    file: wavBlob,
    sourceLang,
  });

  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const json = await apiFetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: form,
  });

  return (json.text || '').trim();
}

interface TranslateOptions {
  source: string
  target: string
  config: AppConfig
  context?: string
  onDelta?: (delta: string) => void
}

/**
 * Translate text via SSE streaming.
 * Calls onDelta for each text chunk as it arrives.
 */
async function translateTextStream(text: string, options: TranslateOptions): Promise<string> {
  if (!text) return '';

  const { onDelta } = options;
  const config = options.config;
  const { provider, route } = validateRoute(config, 'llm');

  const source = LANG_NAMES[options.source || 'auto'] || '自动检测';
  const target = LANG_NAMES[options.target || 'zh'] || '简体中文';

  // Build context-aware prompt
  const contextBlock = options.context
    ? `【上下文（最近的字幕）】\n${options.context}\n\n`
    : '';

  const promptText = [
    `你是一名专业的同声传译员。源语言：${source}；目标语言：${target}。`,
    '将下面的内容翻译为目标语言。只输出译文本身，不要解释、不要加引号、不要重复原文。',
    '保持口语化、简洁、适合作为实时字幕显示。',
    contextBlock ? `注意保持与上下文的连贯性，专有名词前后一致。\n${contextBlock}` : '',
    '',
    text,
  ].filter(Boolean).join('\n');

  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  let fullTranslation = '';
  let hasError = false;

  await streamSSE(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: route.model,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: promptText }],
          },
        ],
        temperature: 0.12,
        max_tokens: 512,
        stream: true,
      }),
    },
    {
      onDelta: (delta) => {
        fullTranslation += delta;
        if (onDelta) onDelta(delta);
      },
      onDone: () => {},
      onError: (err) => {
        console.warn('[RTTS] Translation SSE failed, falling back:', err.message);
        hasError = true;
      },
      allowNonStreamingFallback: true,
    }
  );

  if (hasError && !fullTranslation) {
    fullTranslation = await translateTextSync(text, options);
    if (onDelta && fullTranslation) {
      onDelta(fullTranslation);
    }
  }

  return fullTranslation
    .trim()
    .replace(/^["“「『]([\s\S]*)["”」』]$/, '$1')
    .trim();
}

/**
 * Non-streaming translation fallback.
 */
async function translateTextSync(text: string, options: TranslateOptions): Promise<string> {
  if (!text) return '';

  const config = options.config;
  const { provider, route } = validateRoute(config, 'llm');

  const source = LANG_NAMES[options.source || 'auto'] || '自动检测';
  const target = LANG_NAMES[options.target || 'zh'] || '简体中文';

  const contextBlock = options.context
    ? `【上下文（最近的字幕）】\n${options.context}\n\n`
    : '';

  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const json = await apiFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `你是一名专业的同声传译员。源语言：${source}；目标语言：${target}。`,
                '将下面的内容翻译为目标语言。只输出译文本身，不要解释、不要加引号、不要重复原文。',
                '保持口语化、简洁、适合作为实时字幕显示。',
                contextBlock ? `注意保持与上下文的连贯性，专有名词前后一致。\n${contextBlock}` : '',
                '',
                text,
              ].filter(Boolean).join('\n'),
            },
          ],
        },
      ],
      temperature: 0.12,
      max_tokens: 512,
      stream: false,
    }),
  });

  const answer = extractChatText(json);
  return answer
    .trim()
    .replace(/^["“「『]([\s\S]*)["”」』]$/, '$1')
    .trim();
}

/* ===== Segment Finalization (Streaming) ===== */

async function finalizeSegment(tabId: number) {
  const session = captureSessions.get(tabId);
  if (!session) return;

  if (session.pendingTranscriptions >= MAX_QUEUE_SIZE) return;

  const segmentStartTime = session.segmentStartTime;

  const rawPcm = concatPcm(session.pcmBuffer);
  const frameRms = session.frameRms;
  const frameLens = session.frameLens;
  const speechMs = speechDurationMs(frameRms, frameLens, TARGET_SAMPLE_RATE);
  const trimmedPcm = trimToSpeechBounds(rawPcm, frameRms, frameLens, TARGET_SAMPLE_RATE);

  // Reset the segment regardless of what happens next, otherwise one skipped
  // segment poisons every later one with stale audio.
  session.pcmBuffer = [];
  session.frameRms = [];
  session.frameLens = [];
  session.segmentStartTime = Date.now();
  session.isSilent = false;
  session.lastSilenceTime = 0;

  // A segment with essentially no audio is not speech. Sending it to a
  // Whisper-family model produces an invented sentence ("Who are you?",
  // "123456789", "请不吝点赞订阅…") which translation then makes look real.
  if (speechMs < MIN_SPEECH_MS) {
    reportAudioState(session, true);
    return;
  }
  reportAudioState(session, false);

  const pcmData = trimmedPcm;
  const durationMs = (pcmData.length / TARGET_SAMPLE_RATE) * 1000;
  if (durationMs < 300) return;

  session.pendingTranscriptions++;

  try {
    const wavBlob = createWavBlob(pcmData, TARGET_SAMPLE_RATE);
    const t0 = performance.now();

    // 1. Transcribe the complete audio segment.
    const transcription = await transcribeAudio(wavBlob, session.config, session.sourceLang);
    if (session.aborted) return;
    if (!transcription) return;
    // Segment-level ASR trace: the primary tool for diagnosing "subtitles
    // nobody said". Every accepted line records what audio produced it, so a
    // hallucination that slips through every guard can be traced back to its
    // segment shape (duration, speech ratio) and the raw model output.
    console.log('[RTTS] ASR segment:', {
      text: transcription,
      durationMs: Math.round(durationMs),
      speechMs,
      sourceLang: session.sourceLang,
    });
    const isHallucination = isLikelyAsrHallucinationSequence(
      session.recentAsrCandidates,
      transcription,
    );
    if (isHallucination) {
      // Loud music and encoder noise still reach the model even with energy
      // gating. Drop the stock phrases instead of translating them. The
      // duration and level make it possible to tune the energy gate when a
      // new hallucination pattern slips through.
      console.warn('[RTTS] dropped likely ASR hallucination:', {
        text: transcription,
        durationMs: Math.round(durationMs),
        speechMs,
        recentCandidates: [...session.recentAsrCandidates],
      });
      session.recentAsrCandidates = [
        ...session.recentAsrCandidates.slice(-5),
        transcription,
      ];
      return;
    }
    // A real subtitle breaks a suspected noise burst. Keeping only rejected
    // candidates avoids carrying a stale counting phrase into later dialogue.
    session.recentAsrCandidates = [];

    const asrLatency = Math.round(performance.now() - t0);

    // Same-language passthrough: when the transcript already is the target
    // language (e.g. zh audio with zh subtitles), displaying it directly is
    // faster, cheaper, and avoids the LLM rewriting correct text.
    if (shouldSkipTranslation(session.sourceLang, session.targetLang, transcription)) {
      const passthroughLatency = Math.round(performance.now() - t0 + (Date.now() - segmentStartTime));
      if (session.aborted) return;
      console.log('[RTTS] subtitle emitted:', {
        source: transcription,
        target: transcription,
        passthrough: true,
      });
      chrome.runtime.sendMessage({
        type: 'CAPTURE_SUBTITLE',
        tabId,
        generation: session.generation,
        at: segmentStartTime,
        endedAt: Date.now(),
        source: transcription,
        target: transcription,
        latency: passthroughLatency,
      }).catch(() => {
        // Background may be busy; the subtitle will appear on the next state sync.
      });
      return;
    }

    // 2. Build context for coherent translation
    const contextSummary = getContextSummary(session);

    // 3. Send initial streaming marker (so UI shows "translating..." immediately)
    chrome.runtime.sendMessage({
      type: 'CAPTURE_SUBTITLE_STREAMING',
      tabId,
      generation: session.generation,
      at: segmentStartTime,
      source: transcription,
      partialTarget: '',
      latency: asrLatency,
    });

    // 4. Translate via SSE streaming — each delta forwarded incrementally
    let fullTranslation = '';

    const translation = await translateTextStream(transcription, {
      source: session.sourceLang,
      target: session.targetLang,
      config: session.config,
      context: contextSummary,
      onDelta: (delta) => {
        if (session.aborted) return;
        fullTranslation += delta;
        const currentLatency = Math.round(
          performance.now() - t0 + (Date.now() - segmentStartTime)
        );
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
        });
      },
    });

    const totalLatency = Math.round(
      performance.now() - t0 + (Date.now() - segmentStartTime)
    );

    // 5. Track context for future coherence
    if (transcription && translation) {
      pushContext(session, transcription, translation);
    }

    // 6. Send final subtitle (triggers content script to finalize the entry)
    if (session.aborted) return;
    console.log('[RTTS] subtitle emitted:', {
      source: transcription,
      target: translation,
      passthrough: false,
    });
    chrome.runtime.sendMessage({
      type: 'CAPTURE_SUBTITLE',
      tabId,
      generation: session.generation,
      at: segmentStartTime,
      endedAt: Date.now(),
      source: transcription,
      target: translation,
      latency: totalLatency,
    });
  } catch (err: any) {
    if (session.aborted) return;
    console.warn('[RTTS] finalizeSegment error:', err.message);
    // Clear streaming state on error
    chrome.runtime.sendMessage({
      type: 'CAPTURE_SUBTITLE_STREAMING',
      tabId,
      generation: session.generation,
      at: segmentStartTime,
      source: '',
      partialTarget: '',
      latency: 0,
    }).catch(() => {});
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      tabId,
      generation: session.generation,
      error: err.message,
    });
  } finally {
    session.pendingTranscriptions--;
  }
}

/* ===== Sync Q&A ===== */

async function askQuestion({ question, context, config, sourceLang, targetLang, signal }: {
  question: string
  context: string
  config: AppConfig
  sourceLang: string
  targetLang: string
  signal?: AbortSignal
}): Promise<string> {
  const { provider, route } = validateRoute(config, 'llm');

  const source = LANG_NAMES[sourceLang || 'auto'] || '自动检测';
  const target = LANG_NAMES[targetLang || 'zh'] || '简体中文';

  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const json = await apiFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `你是一个视频伴学助手。视频音频的语言：${source}；字幕目标语言：${target}。`,
                '',
                context ? `【最近的字幕上下文】\n${context}\n` : '',
                '请基于以上字幕内容回答用户的问题。用简体中文回答，保持简洁准确。',
                '',
                `【用户提问】\n${question}`,
              ].join('\n'),
            },
          ],
        },
      ],
      temperature: 0.3,
      max_tokens: 2048,
      stream: false,
    }),
    signal,
  });

  return extractChatText(json).trim();
}

function extractChatText(json: any): string {
  const choice = json.choices?.[0];
  if (choice?.message?.content) {
    if (typeof choice.message.content === 'string') return choice.message.content;
    return choice.message.content.map((p: any) => p.text || '').join('');
  }
  if (choice?.text) return choice.text;
  if (json.output_text) return json.output_text;
  const output = json.output
    ?.flatMap((item: any) => item.content || [])
    .map((p: any) => p.text || '')
    .join('');
  return output || '';
}

/* ===== Stop Capture ===== */

async function stopTabCapture(tabId: number) {
  const session = captureSessions.get(tabId);
  if (!session) return;

  // Mark first: in-flight finalizeSegment calls check this after every await
  // and must not emit subtitles once the user has stopped.
  session.aborted = true;

  if (session.currentAskController) {
    session.currentAskController.abort();
    session.currentAskController = null;
  }

  if (session.workletNode) {
    session.workletNode.port.onmessage = null;
    session.workletNode.disconnect();
    session.workletNode = null;
  }

  if (session.videoEl) {
    session.videoEl.pause();
    session.videoEl.srcObject = null;
    session.videoEl.remove();
    session.videoEl = null;
  }

  if (session.mediaStream) {
    session.mediaStream.getTracks().forEach((track) => track.stop());
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
  ]);

  captureSessions.delete(tabId);
  stopKeepAliveIfIdle();
}

/* ===== Service-worker keepalive =====
 * MV3 background workers are suspended after ~30 s without events. A silent
 * stretch of video produced no subtitle messages, so the worker died; the
 * offscreen capture kept running, the toolbar showed "stopped", and starting
 * again failed with "Cannot capture a tab with an active stream." A message
 * every 15 s keeps the worker alive for as long as a capture exists.
 */
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function ensureKeepAlive() {
  if (keepAliveTimer !== null) return;
  keepAliveTimer = setInterval(() => {
    for (const [tabId, session] of captureSessions) {
      try {
        chrome.runtime.sendMessage({
          type: 'CAPTURE_KEEPALIVE',
          tabId,
          generation: session.generation,
        }).catch(() => {});
      } catch {
        // Extension context may be gone; the next stop will clear the timer.
      }
    }
  }, 15000);
}

function stopKeepAliveIfIdle() {
  if (captureSessions.size === 0 && keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

/* ===== Message Handler ===== */

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.target && message.target !== 'offscreen') return false;

  switch (message.type) {
    case 'START_CAPTURE': {
      const { tabId, streamId, sourceLang, targetLang, config, generation } = message;
      startTabCapture({ tabId, streamId, sourceLang, targetLang, config, generation })
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    case 'STOP_CAPTURE': {
      const tabId = message.tabId;
      stopTabCapture(tabId).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    case 'GET_CAPTURE_SESSIONS': {
      const sessions: Record<string, number> = {};
      for (const [tabId, session] of captureSessions) {
        sessions[String(tabId)] = session.generation;
      }
      sendResponse({
        ok: true,
        tabIds: Array.from(captureSessions.keys()),
        sessions,
      });
      return false;
    }

    case 'SET_LANG': {
      const tabId = message.tabId;
      const session = captureSessions.get(tabId);
      if (session) {
        if (message.sourceLang) session.sourceLang = message.sourceLang;
        if (message.targetLang) session.targetLang = message.targetLang;
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'CAPTURE_FRAME': {
      const tabId = message.tabId;
      const sess = captureSessions.get(tabId);
      if (!sess || sess.aborted || !sess.videoEl || !sess.videoEl.videoWidth) {
        sendResponse({ ok: false, error: '没有可用的视频帧' });
        return true;
      }
      try {
        const video = sess.videoEl;
        if (video.readyState < 2 || !video.videoWidth) {
          sendResponse({ ok: false, error: '视频尚未就绪' });
          return true;
        }
        const canvas = document.createElement('canvas');
        let w = video.videoWidth;
        let h = video.videoHeight;
        const maxW = 1600;
        if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        sendResponse({ ok: true, dataUrl });
      } catch (err: any) {
        sendResponse({ ok: false, error: err.message || '帧捕获失败' });
      }
      return true;
    }

    case 'ASK_QUESTION': {
      const { tabId, question, requestId, generation, config, context, sourceLang, targetLang } = message;
      const session = captureSessions.get(tabId);
      if (!session || session.generation !== generation) {
        sendResponse({ ok: false, error: '会话已过期' });
        return false;
      }
      if (session.currentAskController) session.currentAskController.abort();
      const controller = new AbortController();
      session.currentAskController = controller;

      askQuestion({ question, context: context || '', config, sourceLang, targetLang, signal: controller.signal })
        .then((answer) => {
          if (controller.signal.aborted) return;
          session.currentAskController = null;
          sendResponse({ ok: true, answer, requestId });
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          session.currentAskController = null;
          sendResponse({ ok: false, error: err.message, requestId });
        });
      return true;
    }

    default:
      sendResponse({ ok: false, error: `未知消息类型: ${message.type}` });
      return false;
  }
});

// Periodic segment check
setInterval(() => {
  for (const tabId of captureSessions.keys()) {
    checkSegment(tabId);
  }
}, 200);

console.log('[RTTS] Offscreen document v0.5 (TS) initialized');

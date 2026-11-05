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

/* ===== Constants ===== */

const WORKLET_PATH = chrome.runtime.getURL('audio-worklet.js');

// Audio capture constraints
const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 320; // 20ms at 16kHz
const MIN_SEGMENT_DURATION_MS = 800;
const MAX_SEGMENT_DURATION_MS = 4000;
const SILENCE_THRESHOLD_MS = 500;
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

function computeRMS(buffer: Int16Array): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const normalized = buffer[i] / 32768;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / buffer.length);
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
  recentContext?: { source: string; target: string }[]
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
  };
  captureSessions.set(tabId, session);

  try {
    session.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as any,
      video: false,
    });

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
  if (!session) return;

  const pcmData = new Int16Array(msg.buffer);
  session.pcmBuffer.push(pcmData);
  session.lastChunkTime = Date.now();
  checkSegment(tabId);
}

function checkSegment(tabId: number) {
  const session = captureSessions.get(tabId);
  if (!session || session.aborted) return;

  const now = Date.now();
  const segmentDuration = now - session.segmentStartTime;
  const pcmLength = session.pcmBuffer.reduce((sum, buf) => sum + buf.length, 0);

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

/* ===== Streaming API Calls ===== */

/**
 * Transcribe audio via SSE streaming.
 * Falls back to non-streaming REST if SSE is not supported.
 */
async function transcribeAudioStream(wavBlob: Blob, config: AppConfig): Promise<string> {
  const { provider, route } = validateRoute(config, 'audio');

  const form = new FormData();
  form.append('model', route.model);
  form.append('file', wavBlob, 'segment.wav');
  form.append('response_format', 'verbose_json');
  form.append('stream', 'true');

  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  let fullText = '';
  let hasError = false;

  await streamSSE(
    `${baseUrl}/audio/transcriptions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: form,
    },
    {
      onDelta: (delta) => { fullText += delta; },
      onDone: () => {},
      onError: (err) => { hasError = true; },
      allowNonStreamingFallback: true,
    }
  );

  if (hasError && !fullText) {
    return await transcribeAudioSync(wavBlob, config);
  }

  return fullText.trim();
}

/**
 * Non-streaming ASR fallback.
 */
async function transcribeAudioSync(wavBlob: Blob, config: AppConfig): Promise<string> {
  const { provider, route } = validateRoute(config, 'audio');

  const form = new FormData();
  form.append('model', route.model);
  form.append('file', wavBlob, 'segment.wav');
  form.append('response_format', 'json');

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

  const pcmData = concatPcm(session.pcmBuffer);
  session.pcmBuffer = [];
  session.segmentStartTime = Date.now();
  session.isSilent = false;
  session.lastSilenceTime = 0;

  const durationMs = (pcmData.length / TARGET_SAMPLE_RATE) * 1000;
  if (durationMs < 300) return;

  session.pendingTranscriptions++;

  try {
    const wavBlob = createWavBlob(pcmData, TARGET_SAMPLE_RATE);
    const t0 = performance.now();

    // 1. Transcribe via SSE streaming (collect full result)
    const transcription = await transcribeAudioStream(wavBlob, session.config);
    if (session.aborted) return;
    if (!transcription) return;

    const asrLatency = Math.round(performance.now() - t0);

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

  if (session.audioCtx && session.audioCtx.state !== 'closed') {
    await session.audioCtx.close();
  }
  if (session.monitorAudioCtx && session.monitorAudioCtx.state !== 'closed') {
    await session.monitorAudioCtx.close();
  }

  if (session.mediaStream) {
    session.mediaStream.getTracks().forEach((track) => track.stop());
  }

  captureSessions.delete(tabId);
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

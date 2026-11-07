/**
 * Offscreen audio utilities.
 *
 * PCM → WAV encoding and the SSE stream reader shared by transcription and
 * translation. Everything here is transport-level: no sessions, no chrome
 * messaging, no provider config.
 */

/* ===== Audio constants ===== */

export const TARGET_SAMPLE_RATE = 16000
export const FRAME_SIZE = 320 // 20ms at 16kHz
export const MIN_SEGMENT_DURATION_MS = 800
export const MAX_SEGMENT_DURATION_MS = 4000
export const SILENCE_THRESHOLD_MS = 500
/**
 * Used by the boundary detector (speech → silence transition). Anything that
 * decides *whether* audio is worth transcribing lives in lib/audio-segments.
 */
export const SILENCE_RMS_THRESHOLD = 0.045
export const MAX_QUEUE_SIZE = 3

/* ===== WAV encoding ===== */

export function createWavBlob(pcmData: Int16Array, sampleRate: number): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = pcmData.byteLength
  const bufferSize = 44 + dataSize

  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, bufferSize - 8, true)
  writeString(view, 8, 'WAVE')

  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  new Int16Array(buffer, 44).set(pcmData)

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/* ===== SSE streaming engine ===== */

/**
 * Extract text content from an SSE JSON event.
 * Supports multiple formats:
 *   1. OpenAI chat completions: { choices: [{ delta: { content: "..." } }] }
 *   2. Direct text field: { text: "..." }
 *   3. Content field: { content: "..." }
 * Returns null if no extractable text found.
 */
export function extractSSEDelta(json: any): string | null {
  // Format 1: OpenAI chat completions SSE delta
  if (json.choices && Array.isArray(json.choices) && json.choices[0]) {
    const delta = json.choices[0].delta
    if (delta && typeof delta.content === 'string' && delta.content.length > 0) {
      return delta.content
    }
    // Check for finish_reason (stream done, no content)
    if (json.choices[0].finish_reason) return null
  }
  // Format 2: Direct text field (some transcription SSE)
  if (typeof json.text === 'string' && json.text.length > 0) return json.text
  // Format 3: Content field
  if (typeof json.content === 'string' && json.content.length > 0) return json.content
  // Format 4: Transcription segments
  if (json.segments && Array.isArray(json.segments) && json.segments.length > 0) {
    return json.segments.map((s: any) => s.text || '').join(' ')
  }
  return null
}

export interface SSECallbacks {
  onDelta: (delta: string) => void
  onDone: () => void
  onError: (err: Error) => void
  signal?: AbortSignal
  allowNonStreamingFallback?: boolean
}

/**
 * Stream a fetch response as SSE events.
 */
export async function streamSSE(
  url: string,
  options: RequestInit,
  callbacks: SSECallbacks,
): Promise<void> {
  const { onDelta, onDone, onError, signal, allowNonStreamingFallback = true } = callbacks
  let response: Response

  try {
    response = await fetch(url, { ...options, signal })
  } catch (err: any) {
    if (err.name === 'AbortError') { onDone(); return }
    onError(err)
    return
  }

  if (!response.ok) {
    let errorBody = ''
    try { errorBody = await response.text() } catch { /* ignore */ }
    onError(new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`))
    return
  }

  // Determine if the response is a stream (has body)
  const isStream = !!response.body

  if (!isStream) {
    // Non-streaming response: read entire body, parse as JSON
    try {
      const text = await response.text()
      if (allowNonStreamingFallback) {
        try {
          const json = JSON.parse(text)
          const content = extractSSEDelta(json)
          if (content) {
            onDelta(content)
            onDone()
            return
          }
        } catch { /* not valid JSON */ }
        if (text && text.length > 0) {
          onDelta(text)
        }
      } else if (text && text.length > 0) {
        onDelta(text)
      }
    } catch (err: any) {
      onError(err)
      return
    }
    onDone()
    return
  }

  // SSE streaming via ReadableStream
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamDone = false
  let lastDataTime = Date.now()

  try {
    while (!streamDone) {
      // Timeout safeguard: if no data for 30s, abort
      if (Date.now() - lastDataTime > 30000) {
        onError(new Error('SSE stream timeout (30s no data)'))
        reader.cancel()
        return
      }

      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch (err: any) {
        if (err.name === 'AbortError') { onDone(); return }
        throw err
      }

      const { done, value } = result
      streamDone = done
      if (value) {
        lastDataTime = Date.now()
        buffer += decoder.decode(value, { stream: true })
      }
      if (streamDone && !buffer) break

      // Process complete SSE events (separated by double newline)
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''

      for (const part of parts) {
        if (!part.trim()) continue

        // Parse data lines from the event
        let dataContent: string | null = null
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) {
            dataContent = line.slice(6).trim()
          }
          // Also handle bare JSON lines (some endpoints omit 'data: ' prefix)
          if (!line.startsWith('data:') && !line.startsWith(':') && line.trim().startsWith('{')) {
            try { JSON.parse(line.trim()); dataContent = line.trim() } catch { /* not JSON */ }
          }
        }

        if (dataContent === null || dataContent === '') continue
        if (dataContent === '[DONE]') {
          onDone()
          return
        }

        try {
          const json = JSON.parse(dataContent)
          const delta = extractSSEDelta(json)
          if (delta !== null && delta !== undefined) {
            onDelta(delta)
          }
        } catch {
          // Malformed JSON — skip this event
        }
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') { onDone(); return }
    onError(err)
    return
  }

  onDone()
}

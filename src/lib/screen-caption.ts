/**
 * Screen-caption channel helpers (ADR-043).
 *
 * Burned-in subtitles live in the bottom strip of the video. The channel
 * samples that strip, drops frames that did not change, and turns the vision
 * model's reply into a subtitle line. Everything here is pure so the regression
 * script can exercise it without a browser.
 */

/** Bottom fraction of the frame that may contain burned-in subtitles. */
export const SCREEN_STRIP_RATIO = 0.22
export const SCREEN_STRIP_MIN_HEIGHT = 56
export const SCREEN_STRIP_MAX_HEIGHT = 200
export const SCREEN_STRIP_MAX_WIDTH = 960

/** How long a screen line keeps audio lines out of the overlay. */
export const SCREEN_AUDIO_YIELD_MS = 8000

/** Minimum gap between two vision requests. */
export const SCREEN_SAMPLE_INTERVAL_MS = 900

/** Mean per-channel difference below which two strips are the same frame. */
export const SCREEN_SIGNATURE_THRESHOLD = 6

export interface StripRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Geometry of the subtitle strip inside a video frame. Scaled to at most
 * `maxWidth` while preserving the strip's aspect ratio.
 */
export function computeStripRect(
  videoWidth: number,
  videoHeight: number,
  maxWidth = SCREEN_STRIP_MAX_WIDTH,
): StripRect | null {
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) return null
  if (videoWidth <= 0 || videoHeight <= 0) return null
  const rawHeight = Math.round(videoHeight * SCREEN_STRIP_RATIO)
  const height = Math.min(
    SCREEN_STRIP_MAX_HEIGHT,
    Math.max(SCREEN_STRIP_MIN_HEIGHT, Math.min(videoHeight, rawHeight)),
  )
  const width = Math.min(videoWidth, maxWidth)
  return {
    x: Math.round((videoWidth - width) / 2),
    y: videoHeight - height,
    width,
    height,
  }
}

/** 64×8 grayscale signature of an RGBA buffer. */
export function frameSignature(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  cols = 64,
  rows = 8,
): number[] {
  const out: number[] = []
  if (width <= 0 || height <= 0) return out
  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor((row * height) / rows)
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows))
    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor((col * width) / cols)
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / cols))
      let sum = 0
      let count = 0
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const i = (y * width + x) * 4
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
          count++
        }
      }
      out.push(count ? sum / count : 0)
    }
  }
  return out
}

/** Mean absolute difference between two signatures, in 0–255 units. */
export function signatureDistance(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** True when the new strip is visually the same as the last submitted one. */
export function isSameFrame(previous: number[], next: number[], threshold = SCREEN_SIGNATURE_THRESHOLD): boolean {
  if (!previous.length) return false
  return signatureDistance(previous, next) < threshold
}

export interface ScreenCaption {
  source: string
  target: string
}

const EMPTY_CAPTION: ScreenCaption = { source: '', target: '' }

/**
 * Pull the first JSON object out of a model reply. Models sometimes wrap it in
 * a ```json fence or add a sentence around it, so a bare JSON.parse is not
 * enough.
 */
export function extractCaptionPayload(text: string): Record<string, unknown> | null {
  if (!text) return null
  const cleaned = text.replace(/```json/gi, '```')
  const start = cleaned.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, i + 1))
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** Normalize a model reply into `{ source, target }`, empty strings on failure. */
export function parseScreenCaption(text: string): ScreenCaption {
  const payload = extractCaptionPayload(text)
  if (!payload) return { ...EMPTY_CAPTION }
  const source = typeof payload.source === 'string' ? payload.source.trim() : ''
  const target = typeof payload.target === 'string' ? payload.target.trim() : ''
  // A translation without source text is useless: the overlay would show a
  // line with no on-screen evidence.
  if (!source) return { ...EMPTY_CAPTION }
  return { source, target: target || source }
}

/** Audio lines are suppressed while a screen line is fresh. */
export function shouldYieldAudio(lastScreenAt: number, now: number, windowMs = SCREEN_AUDIO_YIELD_MS): boolean {
  if (!lastScreenAt || lastScreenAt <= 0) return false
  const delta = now - lastScreenAt
  return delta >= 0 && delta < windowMs
}

/** Consecutive duplicate screen lines are not appended twice. */
export function isDuplicateCaption(last: ScreenCaption | null, next: ScreenCaption): boolean {
  if (!last) return false
  return last.source === next.source && last.target === next.target
}

/** Prompt for one strip. Kept short: the model is billed per token, not per call. */
export function buildScreenCaptionPrompt(targetLanguage: string): string {
  return [
    'This image is the bottom subtitle strip of a video frame.',
    `Extract the on-screen text and translate it into ${targetLanguage}.`,
    'Reply with only a JSON object: {"source":"...","target":"..."}.',
    'Use empty strings when there is no readable text. No markdown.',
  ].join(' ')
}
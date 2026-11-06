/**
 * Pure audio-segmentation math.
 *
 * Lives outside `offscreen.ts` so the "is this segment worth transcribing"
 * decision can be tested without a browser. Every function here is total:
 * no globals, no chrome APIs, no state.
 */

/** RMS above which a frame counts as carrying audio at all. */
export const SPEECH_RMS_THRESHOLD = 0.012;
/** A segment needs at least this much audio before ASR is even called. */
export const MIN_SPEECH_MS = 320;
/** Air kept around the detected speech when trimming. */
export const SPEECH_PAD_MS = 120;

/** Root-mean-square of 16-bit PCM, normalized to 0..1. */
export function computeRMS(buffer: Int16Array): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const normalized = buffer[i]! / 32768;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / buffer.length);
}

/** Total milliseconds of frames whose RMS clears {@link SPEECH_RMS_THRESHOLD}. */
export function speechDurationMs(
  frameRms: number[],
  frameLens: number[],
  sampleRate: number,
): number {
  let ms = 0;
  for (let i = 0; i < frameRms.length; i++) {
    if (frameRms[i]! >= SPEECH_RMS_THRESHOLD) {
      const len = frameLens[i] ?? 0;
      ms += (len / sampleRate) * 1000;
    }
  }
  return ms;
}

/**
 * Slice PCM down to the first and last frame that carried audio, plus
 * {@link SPEECH_PAD_MS} of padding. Leading/trailing silence is the main thing
 * a speech model hallucinates over, so it never leaves the extension.
 *
 * Returns the input unchanged when no frame clears the gate.
 */
export function trimToSpeechBounds(
  pcm: Int16Array,
  frameRms: number[],
  frameLens: number[],
  sampleRate: number,
): Int16Array {
  if (frameRms.length === 0) return pcm;

  let first = -1;
  let last = -1;
  for (let i = 0; i < frameRms.length; i++) {
    if (frameRms[i]! >= SPEECH_RMS_THRESHOLD) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return pcm;

  const frameMs = frameLens[0] ? (frameLens[0] / sampleRate) * 1000 : 20;
  const pad = Math.max(0, Math.ceil(SPEECH_PAD_MS / frameMs));
  first = Math.max(0, first - pad);
  last = Math.min(frameRms.length - 1, last + pad);

  let startSample = 0;
  for (let i = 0; i < first; i++) startSample += frameLens[i] ?? 0;
  let endSample = startSample;
  for (let i = first; i <= last; i++) endSample += frameLens[i] ?? 0;
  endSample = Math.min(endSample, pcm.length);

  return endSample > startSample ? pcm.slice(startSample, endSample) : pcm;
}

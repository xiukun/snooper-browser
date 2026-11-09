/**
 * Spectrum-shape speech check — the general fix for the music-hallucination
 * class that the RMS-based gate (audio-noise-gate.ts) cannot catch.
 *
 * First principles: speech and music differ in *where* energy sits, not in
 * how it wiggles over time. Voiced speech concentrates energy in the
 * 300–3400 Hz formant band; music spreads energy across the whole spectrum
 * (kick <80 Hz, cymbals >8 kHz, harmonics everywhere). The ratio of in-band
 * energy to total energy separates them:
 *
 *   speech      → high speech-band ratio (most energy below 3.4 kHz)
 *   music/noise → energy spread wide; more share above the band
 *
 * This is deliberately *not* a VAD: it never looks at loudness, only at the
 * normalized shape of the spectrum, so loud music and quiet speech are judged
 * by the same rule. It also ignores *rhythm* — the exact property that lets
 * rhythmic BGM defeat the RMS-variation gate.
 */

/** FFT size (power of two; 512 @ 16 kHz = 32 ms window, 31.25 Hz bins). */
const FFT_SIZE = 512

/** Speech band edges in Hz for the ratio numerator. Low edge 85 Hz covers
 * male F0 (85–180 Hz) so the fundamental counts as speech; it still excludes
 * the 40–60 Hz kick/bass range where music concentrates energy. */
const SPEECH_BAND_LOW = 85
const SPEECH_BAND_HIGH = 3400

/**
 * Ratio threshold: fraction of in-band spectral energy expected for speech.
 * Calibrated conservatively low (0.55): we prefer letting a music segment
 * through (the text guards catch the residue) over eating real speech. Real
 * speech is typically ≥ 0.75; wideband music is typically < 0.45. Tune from
 * [RTTS] spectrum logs — live sources are the only real calibration set.
 */
const SPEECH_BAND_RATIO_MIN = 0.55

/**
 * Minimum analyzable audio: at least this many FFT windows must decode
 * before the gate votes. Below it the segment is too short to judge, so we
 * accept and let downstream guards decide.
 */
const MIN_WINDOWS = 8

/**
 * Iterative radix-2 FFT, in-place on re/im. n = 512, so the twiddle tables
 * are recomputed per butterfly pass — cheap at segment rates, no caching.
 */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  // Butterflies.
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size
    const stepCos = Math.cos(angle)
    const stepSin = Math.sin(angle)
    const half = size / 2
    for (let i = 0; i < n; i += size) {
      let wCos = 1
      let wSin = 0
      for (let j = 0; j < half; j++) {
        const a = i + j
        const b = a + half
        const tr = re[b]! * wCos - im[b]! * wSin
        const ti = re[b]! * wSin + im[b]! * wCos
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
        const nCos = wCos * stepCos - wSin * stepSin
        wSin = wSin * stepCos + wCos * stepSin
        wCos = nCos
      }
    }
  }
}

export interface SpectrumGateResult {
  accept: boolean
  reason: 'ok' | 'music-like' | 'unanalyzable'
  /** Median fraction of spectral energy inside the speech band. */
  speechBandRatio: number
  windows: number
}

/**
 * Classify one segment's PCM (Int16 mono, arbitrary length).
 *
 * Windows of 512 samples with 50% overlap, Hann-windowed FFT, per-window
 * speech-band ratio, then the *median* window ratio — robust against a few
 * transient frames (a door slam inside speech must not flip the verdict).
 */
export function classifyPcmSpectrum(pcm: Int16Array, sampleRate: number): SpectrumGateResult {
  const hop = FFT_SIZE / 2
  const windowCount = Math.max(0, Math.floor((pcm.length - FFT_SIZE) / hop) + 1)
  if (windowCount < MIN_WINDOWS) {
    return { accept: true, reason: 'unanalyzable', speechBandRatio: 1, windows: 0 }
  }

  const hann = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
  }

  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)
  const ratios: number[] = []
  const lowBin = Math.ceil((SPEECH_BAND_LOW * FFT_SIZE) / sampleRate)
  const highBin = Math.floor((SPEECH_BAND_HIGH * FFT_SIZE) / sampleRate)

  for (let w = 0; w < windowCount; w++) {
    const offset = w * hop
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (pcm[offset + i]! / 32768) * hann[i]!
      im[i] = 0
    }
    fft(re, im)
    let total = 0
    let inBand = 0
    for (let bin = 1; bin < FFT_SIZE / 2; bin++) {
      const power = re[bin]! * re[bin]! + im[bin]! * im[bin]!
      total += power
      if (bin >= lowBin && bin <= highBin) inBand += power
    }
    if (total > 1e-9) ratios.push(inBand / total)
  }

  if (ratios.length === 0) {
    return { accept: true, reason: 'unanalyzable', speechBandRatio: 1, windows: 0 }
  }
  ratios.sort((a, b) => a - b)
  const median = ratios[Math.floor(ratios.length / 2)]!
  const accept = median >= SPEECH_BAND_RATIO_MIN
  return {
    accept,
    reason: accept ? 'ok' : 'music-like',
    speechBandRatio: median,
    windows: ratios.length,
  }
}

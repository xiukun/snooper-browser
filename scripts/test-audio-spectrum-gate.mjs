/**
 * Tests for the spectrum-shape gate: FFT correctness, band-ratio math, and
 * classification of synthetic speech-like vs music-like signals.
 *
 * Signals are synthesized at 16 kHz:
 *   - speech-like: 150 Hz F0 + falling harmonic stack up to ~3 kHz
 *   - music-like:  bass 60 Hz + mid 1200 Hz + white hiss (full-band energy)
 *   - pure tone inside the band (must pass: shape is speech-band-shaped)
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-spectrum-gate-'))
const out = join(outDir, 'audio-spectrum-gate.mjs')

try {
  execSync(
    `npx esbuild src/lib/audio-spectrum-gate.ts --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  )
  const { classifyPcmSpectrum } = await import(pathToFileURL(out).href)

  let passed = 0
  const failures = []
  const check = (name, actual, expected) => {
    if (actual === expected) passed++
    else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  }

  const SR = 16000

  // Speech-like: 150 Hz F0 with falling harmonics (1/h^2), syllabic AM.
  function speechSignal(seconds) {
    const n = Math.floor(SR * seconds)
    const out = new Int16Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / SR
      let sample = 0
      for (let h = 1; h <= 20; h++) {
        if (150 * h > 3400) break
        sample += Math.sin(2 * Math.PI * 150 * h * t) / (h * h)
      }
      const mod = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)
      out[i] = Math.round(sample * mod * 6000)
    }
    return out
  }

  // Music-like: bass 60 Hz + mid 1200 Hz + white hiss — energy across band.
  function musicSignal(seconds) {
    const n = Math.floor(SR * seconds)
    const out = new Int16Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / SR
      const sample =
        Math.sin(2 * Math.PI * 60 * t) * 0.5 +
        Math.sin(2 * Math.PI * 1200 * t) * 0.3 +
        (Math.random() * 2 - 1) * 0.2
      out[i] = Math.round(sample * 6000)
    }
    return out
  }

  // Pure 1 kHz tone inside the band — passes (shape-only gate).
  function toneInBand(seconds) {
    const n = Math.floor(SR * seconds)
    const out = new Int16Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / SR
      out[i] = Math.round(Math.sin(2 * Math.PI * 1000 * t) * 6000)
    }
    return out
  }

  const speech = classifyPcmSpectrum(speechSignal(3), SR)
  check('speech accepted', speech.accept, true)
  check('speech ratio >= 0.75', speech.speechBandRatio >= 0.75, true)

  const music = classifyPcmSpectrum(musicSignal(2), SR)
  check('music rejected', music.accept, false)
  check('music ratio < 0.45', music.speechBandRatio < 0.45, true)

  const tone = classifyPcmSpectrum(toneInBand(2), SR)
  check('in-band tone accepted', tone.accept, true)

  const tiny = classifyPcmSpectrum(new Int16Array(100), SR)
  check('too-short -> unanalyzable', tiny.reason, 'unanalyzable')

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`spectrum-gate tests passed (${passed} checks)`)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

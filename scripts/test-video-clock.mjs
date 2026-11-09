/**
 * Tests for the video-timeline resolver (ADR-033).
 *
 * Covers normal interpolation, playback rate, pauses, forward/backward seeks,
 * extrapolation before the first / after the last sample, staleness bounds,
 * and sample sanitization.
 *
 *   node scripts/test-video-clock.mjs
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-video-clock-'))
const out = join(outDir, 'video-clock.mjs')

try {
  execSync(
    `npx esbuild src/lib/video-clock.ts --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  )
  const { formatVideoTime, resolveVideoTimeAt, sanitizeVideoClockSample } = await import(
    pathToFileURL(out).href
  )

  let passed = 0
  const failures = []
  const check = (name, actual, expected) => {
    if (actual === expected) passed++
    else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  }
  const checkClose = (name, actual, expected, tolerance = 0.01) => {
    if (typeof actual === 'number' && Math.abs(actual - expected) <= tolerance) passed++
    else failures.push(`${name}: got ${JSON.stringify(actual)}, want ~${expected}`)
  }

  /* ---------- formatting ---------- */
  check('format: zero', formatVideoTime(0), '00:00')
  check('format: seconds', formatVideoTime(95.9), '01:35')
  check('format: hour boundary', formatVideoTime(3600), '1:00:00')
  check('format: long video', formatVideoTime(3723), '1:02:03')
  check('format: invalid', formatVideoTime(Number.NaN), '00:00')

  /* ---------- sanitization ---------- */
  check('sanitize: null', sanitizeVideoClockSample(null), null)
  check('sanitize: missing time', sanitizeVideoClockSample({ at: 1 }), null)
  check('sanitize: negative time', sanitizeVideoClockSample({ at: 1, videoTime: -1 }), null)
  check('sanitize: negative at', sanitizeVideoClockSample({ at: -1, videoTime: 3 }), null)
  {
    const sample = sanitizeVideoClockSample({ at: 1_000, videoTime: 12.5, rate: 99 })
    check('sanitize: rate clamps', sample.rate, 16)
    check('sanitize: paused defaults false', sample.paused, false)
    check('sanitize: time kept', sample.videoTime, 12.5)
  }

  const at = (seconds) => 1_000_000 + seconds * 1000
  const sample = (seconds, videoTime, extra = {}) => ({
    at: at(seconds),
    videoTime,
    paused: false,
    rate: 1,
    ...extra,
  })

  /* ---------- interpolation ---------- */
  {
    const samples = [sample(0, 100), sample(1, 101), sample(2, 102)]
    checkClose('interpolate: midpoint', resolveVideoTimeAt(samples, at(1.5)), 101.5)
    checkClose('interpolate: exact sample', resolveVideoTimeAt(samples, at(1)), 101)
    checkClose('interpolate: quarter', resolveVideoTimeAt(samples, at(0.25)), 100.25)
  }

  /* ---------- playback rate ---------- */
  {
    const samples = [sample(0, 100, { rate: 2 }), sample(1, 102, { rate: 2 })]
    checkClose('rate: 2x midpoint', resolveVideoTimeAt(samples, at(0.5)), 101)
    const samples15 = [sample(0, 100, { rate: 1.5 }), sample(1, 101.5, { rate: 1.5 })]
    checkClose('rate: 1.5x', resolveVideoTimeAt(samples15, at(0.4)), 100.6)
  }

  /* ---------- pause ---------- */
  {
    const samples = [
      sample(0, 100),
      sample(1, 101),
      sample(2, 101, { paused: true }),
      sample(3, 101, { paused: true }),
      sample(4, 101),
    ]
    checkClose('pause: stays flat', resolveVideoTimeAt(samples, at(2.5)), 101)
    checkClose('pause: resumes after', resolveVideoTimeAt(samples, at(3.5)), 101)
  }

  /* ---------- seeks ---------- */
  {
    const forward = [sample(0, 10), sample(1, 11), sample(2, 300)]
    // The nearest endpoint wins inside a discontinuity: 1.4 s is closer to 1.
    checkClose('seek: forward uses prev', resolveVideoTimeAt(forward, at(1.4)), 11)
    checkClose('seek: forward uses next', resolveVideoTimeAt(forward, at(1.6)), 300)

    const backward = [sample(0, 300), sample(1, 301), sample(2, 20)]
    checkClose('seek: backward uses prev', resolveVideoTimeAt(backward, at(1.4)), 301)
    checkClose('seek: backward uses next', resolveVideoTimeAt(backward, at(1.6)), 20)
  }

  /* ---------- extrapolation ---------- */
  {
    const samples = [sample(10, 200), sample(11, 201)]
    checkClose('before first: extrapolates', resolveVideoTimeAt(samples, at(9.5)), 199.5)
    checkClose('after last: extrapolates', resolveVideoTimeAt(samples, at(11.5)), 201.5)
    const paused = [sample(10, 200, { paused: true }), sample(11, 200, { paused: true })]
    checkClose('after last: paused stays flat', resolveVideoTimeAt(paused, at(11.5)), 200)
  }

  /* ---------- staleness bounds ---------- */
  {
    const samples = [sample(10, 200), sample(11, 201)]
    check('too far before: null', resolveVideoTimeAt(samples, at(-21)), null)
    check('too far after: null', resolveVideoTimeAt(samples, at(42)), null)
    check('empty: null', resolveVideoTimeAt([], at(11)), null)
    check('invalid at: null', resolveVideoTimeAt(samples, Number.NaN), null)
  }

  /* ---------- long bracket ---------- */
  {
    const samples = [sample(0, 100), sample(120, 400)]
    checkClose('long bracket: nearest prev', resolveVideoTimeAt(samples, at(30)), 100)
    checkClose('long bracket: nearest next', resolveVideoTimeAt(samples, at(90)), 400)
  }

  /* ---------- unsorted input ---------- */
  {
    const samples = [sample(2, 102), sample(0, 100), sample(1, 101)]
    checkClose('unsorted: still interpolates', resolveVideoTimeAt(samples, at(1.5)), 101.5)
  }

  /* ---------- clamping ---------- */
  {
    const samples = [sample(0, 0.2), sample(1, 1.2)]
    checkClose('clamp: never negative', resolveVideoTimeAt(samples, at(-0.5)), 0)
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`video clock tests passed (${passed} checks)`)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

/**
 * ADR-035 deep-link builder tests. Pure functions, no DOM.
 *
 *   node scripts/test-deep-link.mjs
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-deep-link-'))
const out = join(outDir, 'deep-link.mjs')

try {
  execSync(
    `npx esbuild src/lib/deep-link.ts --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  )
  const { videoDeepLink } = await import(pathToFileURL(out).href)

  let passed = 0
  let failed = 0
  const check = (name, actual, expected) => {
    if (actual === expected) {
      passed += 1
    } else {
      failed += 1
      console.error(`  ✗ ${name}\n    expected: ${expected}\n    actual:   ${actual}`)
    }
  }

  /* ---------- Bilibili ---------- */

  check('bilibili BV watch page',
    videoDeepLink('https://www.bilibili.com/video/BV1JRWt6kEtp/?spm_id_from=333.788', 90.4),
    'https://www.bilibili.com/video/BV1JRWt6kEtp/?t=90')

  check('bilibili floors fractional seconds',
    videoDeepLink('https://www.bilibili.com/video/BV1xx411c7mD', 12.98),
    'https://www.bilibili.com/video/BV1xx411c7mD?t=12')

  check('bilibili av page',
    videoDeepLink('https://www.bilibili.com/video/av170001', 0),
    'https://www.bilibili.com/video/av170001?t=0')

  check('bilibili bangumi path preserved',
    videoDeepLink('https://www.bilibili.com/bangumi/play/ep123456', 61),
    'https://www.bilibili.com/bangumi/play/ep123456?t=61')

  check('bilibili part preserved',
    videoDeepLink('https://www.bilibili.com/video/BV1xx411c7mD?p=2', 90),
    'https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=90')
  for (const p of ['0', '-1', 'no', '1.5', '', '2&p=3']) {
    check(`invalid part ${p} cannot create a seek link`, videoDeepLink(`https://www.bilibili.com/video/BV1?p=${p}`, 10), null)
  }
  check('unknown time cannot create a zero anchor', videoDeepLink('https://youtu.be/abc', null), null)

  /* ---------- YouTube ---------- */

  check('youtube watch page',
    videoDeepLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc', 125),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s')

  check('youtu.be short form',
    videoDeepLink('https://youtu.be/dQw4w9WgXcQ?si=x', 3),
    'https://youtu.be/dQw4w9WgXcQ?t=3s')

  check('youtube shorts keeps its path shape',
    videoDeepLink('https://www.youtube.com/shorts/abcdefghijk', 7),
    'https://www.youtube.com/shorts/abcdefghijk?t=7s')

  /* ---------- Degradation ---------- */

  check('unknown site returns null',
    videoDeepLink('https://example.com/lecture/1', 10), null)

  check('vimeo returns null',
    videoDeepLink('https://vimeo.com/123456', 10), null)

  check('missing url returns null',
    videoDeepLink(undefined, 10), null)
  check('null url returns null',
    videoDeepLink(null, 10), null)
  check('empty url returns null',
    videoDeepLink('', 10), null)

  check('malformed url returns null',
    videoDeepLink('not a url', 10), null)

  check('NaN seconds return null',
    videoDeepLink('https://www.bilibili.com/video/BV1', NaN), null)
  check('negative seconds return null',
    videoDeepLink('https://www.bilibili.com/video/BV1', -1), null)
  check('infinite seconds return null',
    videoDeepLink('https://www.bilibili.com/video/BV1', Infinity), null)

  console.log(`deep-link: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

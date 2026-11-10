/**
 * Tests for the auto-show video gate (ADR-041).
 *
 * The toolbar must appear on real players and stay hidden on pages whose
 * videos are hover previews, tiny inline clips or stale player clones.
 *
 *   node scripts/test-video-presence.mjs
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-video-presence-'))
const out = join(outDir, 'video-presence.mjs')

execSync(
  `npx esbuild src/lib/video-presence.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
)

const { isPresentableVideo, AUTO_SHOW_MIN_VIEWPORT_RATIO, AUTO_SHOW_MIN_WIDTH, AUTO_SHOW_MIN_HEIGHT } =
  await import(pathToFileURL(out).href)

let pass = 0
let fail = 0

function check(name, actual, expected) {
  if (actual === expected) {
    pass++
    return
  }
  console.error(`✗ ${name}: expected ${expected}, got ${actual}`)
  fail++
}

const desktop = { width: 1920, height: 1080 }
const laptop = { width: 1280, height: 720 }

// Main players on common layouts.
check('B 站 normal player', isPresentableVideo({ width: 1100, height: 620 }, desktop), true)
check('B 站 theater mode', isPresentableVideo({ width: 1600, height: 900 }, desktop), true)
check('YouTube watch player', isPresentableVideo({ width: 1000, height: 560 }, desktop), true)
check('small laptop main player', isPresentableVideo({ width: 1000, height: 560 }, laptop), true)

// Hover previews and small embeds stay hidden.
check('B 站 card preview', isPresentableVideo({ width: 320, height: 180 }, desktop), false)
check('YouTube hover preview', isPresentableVideo({ width: 400, height: 225 }, desktop), false)
check('tiny inline clip', isPresentableVideo({ width: 240, height: 135 }, desktop), false)
check('minimum size exactly on the edge (small window)', isPresentableVideo({ width: 320, height: 180 }, { width: 800, height: 600 }), true)

// Degenerate values never throw or pass.
check('zero rect', isPresentableVideo({ width: 0, height: 0 }, desktop), false)
check('NaN width', isPresentableVideo({ width: NaN, height: 400 }, desktop), false)
check('zero viewport', isPresentableVideo({ width: 800, height: 450 }, { width: 0, height: 0 }), false)
check('negative rect', isPresentableVideo({ width: -800, height: -450 }, desktop), false)

// A generous player on a tiny window still passes the ratio gate only when
// it really covers the screen (fullscreen phone landscape).
check('fullscreen on phone', isPresentableVideo({ width: 844, height: 390 }, { width: 844, height: 390 }), true)

// Thresholds are exported for tuning and stay in sync with the docs.
check('min width constant', AUTO_SHOW_MIN_WIDTH, 320)
check('min height constant', AUTO_SHOW_MIN_HEIGHT, 180)
check('ratio constant', AUTO_SHOW_MIN_VIEWPORT_RATIO, 0.12)

// Just below the ratio gate on a tall viewport: 950×530 / (1920×1200) = 21.8%
// is fine, but 700×394 / (1920×1200) = 11.97% must fail.
check('ratio just below gate', isPresentableVideo({ width: 700, height: 394 }, { width: 1920, height: 1200 }), false)
check('ratio just above gate', isPresentableVideo({ width: 700, height: 400 }, { width: 1920, height: 1200 }), true)

rmSync(outDir, { recursive: true, force: true })

if (fail > 0) {
  console.error(`\n${fail} failed, ${pass} passed`)
  process.exit(1)
}
console.log(`video presence: ${pass} passed, 0 failed`)

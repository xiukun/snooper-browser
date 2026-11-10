/**
 * Tests for the content-script install marker (extension-reload recovery).
 *
 * A stale marker (left by a content script whose extension context died after
 * a reload) must allow re-injection; a live marker must still prevent two
 * toolbars and two message listeners in one page.
 *
 *   node scripts/test-content-install.mjs
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-content-install-'))
const out = join(outDir, 'content-install.mjs')

execSync(
  `npx esbuild src/lib/content-install.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
)

const { shouldSkipContentInstall } = await import(pathToFileURL(out).href)

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

// Nothing installed: a fresh injection must boot.
check('undefined marker', shouldSkipContentInstall(undefined), false)
check('null marker', shouldSkipContentInstall(null), false)
check('false marker', shouldSkipContentInstall(false), false)

// Legacy boolean markers cannot prove liveness. The only path that injects is
// a failed send, so the listener is gone and the marker must not block boot.
check('legacy true marker', shouldSkipContentInstall(true), false)

// Current marker: a live instance keeps the guard, a dead one is replaced.
check('live marker', shouldSkipContentInstall({ alive: () => true }), true)
check('dead marker', shouldSkipContentInstall({ alive: () => false }), false)
check('throwing probe', shouldSkipContentInstall({ alive: () => { throw new Error('Extension context invalidated') } }), false)
check('missing probe', shouldSkipContentInstall({}), false)
check('non-function probe', shouldSkipContentInstall({ alive: true }), false)

// Corrupt/foreign values must never block recovery.
check('string marker', shouldSkipContentInstall('installed'), false)
check('number marker', shouldSkipContentInstall(1), false)

// The side panel and the toolbar path must not inject content.js directly:
// a direct injection keeps the stale marker and re-creates the dead loop.
const injectorSources = ['src/ext/background/lifecycle.ts', 'src/ext/sidepanel/panel.ts']
const directInjectors = injectorSources.filter((file) =>
  /files:\s*\[\s*'content\.js'\s*\]/.test(readFileSync(file, 'utf8')),
)
check('no direct content.js injection', directInjectors.join(', '), '')

rmSync(outDir, { recursive: true, force: true })

if (fail > 0) {
  console.error(`\n${fail} failed, ${pass} passed`)
  process.exit(1)
}
console.log(`content install: ${pass} passed, 0 failed`)

/**
 * Tests for the tail-drain rule (ADR-031).
 *
 * A final subtitle that arrives after STOP belongs to the capture being torn
 * down only while that capture's teardown is in progress. Anything else must
 * be dropped, otherwise a restarted session would absorb a stale line.
 *
 *   node scripts/test-session-state.mjs
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-session-state-'))
const out = join(outDir, 'session-state.mjs')

execSync(
  `npx esbuild src/ext/session-state.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
)

const mod = await import(pathToFileURL(out).href)

let passed = 0
const failures = []
function check(name, actual, expected) {
  const got = JSON.stringify(actual)
  const want = JSON.stringify(expected)
  if (got === want) passed += 1
  else failures.push(`${name}: got ${got}, want ${want}`)
}

/* ---------- reconcileSessionWithCapture ---------- */

{
  const running = { state: 'running', generation: 7, streamId: '', configSnapshot: null, streamingSubtitle: null }
  check('same generation keeps the object', mod.reconcileSessionWithCapture(running, 7) === running, true)
}

{
  const idle = { state: 'idle', generation: 8, streamId: '', configSnapshot: null, streamingSubtitle: null }
  const next = mod.reconcileSessionWithCapture(idle, 9)
  check('live capture revives an idle session', next.state, 'running')
  check('revived session adopts the live generation', next.generation, 9)
  check('revival does not mutate the input', idle.state, 'idle')
}

{
  const stopping = { state: 'stopping', generation: 10, streamId: '', configSnapshot: null, streamingSubtitle: null }
  check(
    'stopping is never revived by a live capture',
    mod.reconcileSessionWithCapture(stopping, 10) === stopping,
    true,
  )
}

{
  const running = { state: 'running', generation: 11, streamId: '', configSnapshot: null, streamingSubtitle: null }
  check(
    'no live capture leaves the session untouched',
    mod.reconcileSessionWithCapture(running, undefined) === running,
    true,
  )
}

rmSync(outDir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n❌ session-state: ${failures.length} failed, ${passed} passed`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`✅ session-state: ${passed} checks passed`)

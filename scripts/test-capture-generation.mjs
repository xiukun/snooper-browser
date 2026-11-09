/** Regression tests for capture START/STOP generation fencing. */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-capture-generation-'))
const out = join(outDir, 'capture-generation.mjs')

try {
  execSync(
    `npx esbuild src/lib/capture-generation.ts --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  )
  const {
    isCurrentCaptureGeneration,
    requestCaptureGeneration,
    stopCaptureGeneration,
  } = await import(pathToFileURL(out).href)

  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }

  // STOP for a pending current generation cancels the request even before a
  // CaptureSession exists, and it also releases an older active session.
  {
    const state = { stopped: -1 }
    assert(requestCaptureGeneration(state, 2), 'generation 2 should be accepted')
    const result = stopCaptureGeneration(state, 1, 2)
    assert(result.cancelRequested, 'current pending generation was not cancelled')
    assert(result.stopActive, 'older active generation was not selected for cleanup')
    assert(!isCurrentCaptureGeneration(state, 2), 'stopped generation remained current')
  }

  // A stale STOP only stops the matching old session and leaves a newer
  // pending START intact.
  {
    const state = { stopped: -1 }
    assert(requestCaptureGeneration(state, 2), 'generation 2 should be accepted')
    const result = stopCaptureGeneration(state, 1, 1)
    assert(!result.cancelRequested, 'stale STOP cancelled a newer request')
    assert(result.stopActive, 'matching old session was not selected for cleanup')
    assert(isCurrentCaptureGeneration(state, 2), 'newer request was invalidated')
  }

  // An unversioned teardown invalidates pending work and stops the active
  // session, which is required for tab close/navigation cleanup.
  {
    const state = { stopped: -1 }
    assert(requestCaptureGeneration(state, 3), 'generation 3 should be accepted')
    const result = stopCaptureGeneration(state, 1)
    assert(result.cancelRequested && result.stopActive, 'unversioned stop did not fence capture')
  }

  console.log('capture generation tests passed')
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

/**
 * Regression tests for per-key async coordination used by capture startup.
 *
 * No test framework: bundle the small TypeScript helper with esbuild and
 * exercise both coalescing and serialization semantics.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-keyed-task-'))
const out = join(outDir, 'keyed-task.mjs')

try {
  execSync(
    `npx esbuild src/lib/keyed-task.ts --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  )
  const { runKeyedTask } = await import(pathToFileURL(out).href)

  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  // Share mode: concurrent callers receive the same promise and invoke the
  // factory exactly once.
  {
    const tasks = new Map()
    let calls = 0
    let release
    const pending = new Promise((resolve) => { release = resolve })
    const first = runKeyedTask(tasks, 'tab', 'share', async () => {
      calls++
      return pending
    })
    const second = runKeyedTask(tasks, 'tab', 'share', async () => {
      calls++
      return 'unexpected'
    })
    assert(first === second, 'share mode should return the same promise')
    assert(calls === 1, 'share mode should invoke one factory')
    release('started')
    assert(await first === 'started', 'shared result should reach the caller')
    await wait(0)
    assert(tasks.size === 0, 'settled shared task should be removed')
  }

  // Queue mode: calls for one key never overlap and preserve order.
  {
    const tasks = new Map()
    const events = []
    let active = 0
    const makeTask = (name, delay) => () => (async () => {
      active++
      assert(active === 1, `${name} overlapped a previous task`)
      events.push(`${name}:start`)
      await wait(delay)
      events.push(`${name}:end`)
      active--
      return name
    })()

    const first = runKeyedTask(tasks, 'tab', 'queue', makeTask('first', 5))
    const second = runKeyedTask(tasks, 'tab', 'queue', makeTask('second', 0))
    assert(await first === 'first', 'first queued task should resolve')
    assert(await second === 'second', 'second queued task should resolve')
    assert(events.join(',') === 'first:start,first:end,second:start,second:end', 'queue order changed')
  }

  // A rejected queue item must not block the next item.
  {
    const tasks = new Map()
    const first = runKeyedTask(tasks, 'tab', 'queue', async () => {
      throw new Error('expected failure')
    })
    const second = runKeyedTask(tasks, 'tab', 'queue', async () => 'recovered')
    try {
      await first
    } catch (error) {
      assert(error.message === 'expected failure', 'unexpected first rejection')
    }
    assert(await second === 'recovered', 'queue did not recover after rejection')
  }

  console.log('keyed-task tests passed')
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

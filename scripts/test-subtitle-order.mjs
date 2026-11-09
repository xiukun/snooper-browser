/**
 * Tests for subtitle ordering (ADR-038).
 *
 * Segments finish concurrently, so arrival order is not speech order. `at`
 * is the authoritative key; insertion must keep the overlay and export
 * chronological without reordering equal timestamps.
 *
 *   node scripts/test-subtitle-order.mjs
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-subtitle-order-'))
const out = join(outDir, 'subtitle-order.mjs')

execSync(
  `npx esbuild src/lib/subtitle-order.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
)

const { startOf, compareStart, sortByStart, insertByStart } = await import(
  pathToFileURL(out).href
)

let passed = 0
const failures = []
const check = (name, actual, expected) => {
  const got = JSON.stringify(actual)
  const want = JSON.stringify(expected)
  if (got === want) passed += 1
  else failures.push(`${name}: got ${got}, want ${want}`)
}

/* ---------- startOf ---------- */
check('start: finite value', startOf({ at: 1712345678901 }), 1712345678901)
check('start: missing is zero', startOf({}), 0)
check('start: null is zero', startOf({ at: null }), 0)
check('start: NaN is zero', startOf({ at: Number.NaN }), 0)
check('start: negative is zero', startOf({ at: -5 }), 0)

/* ---------- sortByStart ---------- */
{
  const input = [{ at: 3000, id: 'c' }, { at: 1000, id: 'a' }, { at: 2000, id: 'b' }]
  const sorted = sortByStart(input)
  check('sort: speech order', sorted.map((item) => item.id), ['a', 'b', 'c'])
  check('sort: returns a copy', sorted === input, false)
  check('sort: input untouched', input.map((item) => item.id), ['c', 'a', 'b'])
}

{
  const input = [{ at: 2000, id: 'first' }, { at: 2000, id: 'second' }]
  check('sort: equal starts stay stable', sortByStart(input).map((item) => item.id), ['first', 'second'])
}

{
  const input = [{ at: 2000, id: 'timed' }, { id: 'legacy' }, { at: 1000, id: 'older' }]
  check('sort: untimed lines sort first', sortByStart(input).map((item) => item.id), ['legacy', 'older', 'timed'])
}

/* ---------- insertByStart ---------- */
{
  const items = [{ at: 1000, id: 'a' }, { at: 3000, id: 'c' }]
  insertByStart(items, { at: 2000, id: 'b' })
  check('insert: lands between', items.map((item) => item.id), ['a', 'b', 'c'])
}

{
  const items = [{ at: 1000, id: 'a' }, { at: 2000, id: 'b' }]
  const returned = insertByStart(items, { at: 3000, id: 'c' })
  check('insert: latest appends', items.map((item) => item.id), ['a', 'b', 'c'])
  check('insert: same reference returned', returned === items, true)
}

{
  const items = [{ at: 2000, id: 'first' }, { at: 3000, id: 'later' }]
  insertByStart(items, { at: 2000, id: 'second' })
  check('insert: equal start appends after existing', items.map((item) => item.id), ['first', 'second', 'later'])
}

{
  const items = [{ at: 2000, id: 'second' }]
  insertByStart(items, { at: 1000, id: 'first' })
  check('insert: earlier goes first', items.map((item) => item.id), ['first', 'second'])
}

{
  const items = []
  insertByStart(items, { at: 5000, id: 'only' })
  check('insert: empty list', items.map((item) => item.id), ['only'])
}

check('compare: earlier first', compareStart({ at: 1 }, { at: 2 }) < 0, true)
check('compare: equal', compareStart({ at: 2 }, { at: 2 }), 0)

rmSync(outDir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${passed} passed, ${failures.length} failed`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}

console.log(`subtitle order: ${passed} passed, 0 failed`)

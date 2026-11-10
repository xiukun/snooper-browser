/**
 * Static wiring check for the subtitle view's DOM refs.
 *
 * `createSubtitleView` requires every element it touches, but the refs object
 * is built by hand in `src/ext/content.ts`. When ADR-040 added the listening
 * row, `subListening` reached `subtitle-view.ts` but not that object, so the
 * first render threw `Cannot read properties of undefined (reading
 * 'classList')` and the toolbar could not open at all.
 *
 * TypeScript would catch this, but the extension sources have no tsconfig or
 * type-check step. This script is the cheap equivalent: it parses the
 * interface and the object literal and fails on a missing key.
 *
 *   node scripts/test-content-refs.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(relative) {
  return readFileSync(join(root, relative), 'utf8')
}

/** Keys declared by `export interface SubtitleViewRefs { ... }`. */
function declaredRefs(source) {
  const match = source.match(/interface\s+SubtitleViewRefs\s*\{([\s\S]*?)\n\}/)
  if (!match) throw new Error('SubtitleViewRefs interface not found')
  return Object.keys(
    Object.fromEntries(
      [...match[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => [m[1], true]),
    ),
  )
}

/** Keys present in the `refs: { ... }` literal passed to createSubtitleView. */
function wiredRefs(source) {
  const call = source.indexOf('createSubtitleView({')
  if (call < 0) throw new Error('createSubtitleView call not found')
  const refsStart = source.indexOf('refs: {', call)
  if (refsStart < 0) throw new Error('refs literal not found in createSubtitleView')
  const bodyStart = source.indexOf('{', refsStart) + 1
  const bodyEnd = source.indexOf('\n    },', bodyStart)
  if (bodyEnd < 0) throw new Error('refs literal is not terminated as expected')
  const body = source.slice(bodyStart, bodyEnd)
  return Object.keys(
    Object.fromEntries(
      [...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*(?::|,)/gm)].map((m) => [m[1], true]),
    ),
  )
}

const viewSource = read('src/ext/content/subtitle-view.ts')
const contentSource = read('src/ext/content.ts')

const declared = declaredRefs(viewSource)
const wired = new Set(wiredRefs(contentSource))

const missing = declared.filter((key) => !wired.has(key))
const extra = [...wired].filter((key) => !declared.includes(key))

let failed = 0
if (missing.length > 0) {
  console.error(`✗ missing refs in src/ext/content.ts: ${missing.join(', ')}`)
  failed++
}
if (extra.length > 0) {
  // Extra keys are harmless (they are ignored), but usually mean a rename that
  // forgot one side.
  console.error(`✗ refs passed but not declared: ${extra.join(', ')}`)
  failed++
}

if (failed > 0) {
  console.error(`\ncontent refs: ${missing.length + extra.length} problem(s)`)
  process.exit(1)
}
console.log(`content refs: ${declared.length} declared, all wired`)

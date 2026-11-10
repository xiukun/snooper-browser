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

/** Keys declared by an interface in a source file. */
function declaredRefs(source, name) {
  const match = source.match(new RegExp(`interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`${name} interface not found`)
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

/** Keys destructured from collectRefs(). */
function destructuredRefs(source) {
  const start = source.indexOf('} = collectRefs(shadow);')
  if (start < 0) throw new Error('collectRefs destructuring not found')
  const open = source.lastIndexOf('const {', start)
  if (open < 0) throw new Error('collectRefs destructuring start not found')
  const body = source.slice(open + 'const {'.length, start)
  return Object.keys(
    Object.fromEntries(
      [...body.matchAll(/([A-Za-z_$][\w$]*)\s*,?/g)].map((m) => [m[1], true]),
    ),
  )
}

/**
 * Keys present in the `collectRefs()` return literal, with the element id each
 * one queries. A field declared on `ContentRefs` but absent here is
 * `undefined` at runtime, so the first `.querySelector` / `.classList` on it
 * throws and the whole toolbar dies — the ADR-043 screen toggle shipped with
 * exactly that bug (`screenBtn` was declared, destructured, bound, and never
 * collected).
 */
function collectedRefs(source) {
  const start = source.indexOf('export function collectRefs(')
  if (start < 0) throw new Error('collectRefs not found')
  const body = source.slice(start)
  const collected = {}
  for (const match of body.matchAll(/^\s*([A-Za-z_$][\w$]*):\s*shadow\.getElementById\('([^']+)'\)/gm)) {
    collected[match[1]] = match[2]
  }
  return collected
}

const viewSource = read('src/ext/content/subtitle-view.ts')
const refsSource = read('src/ext/content/refs.ts')
const contentSource = read('src/ext/content.ts')
const templateSource = read('src/ext/content/template.ts')

const declared = declaredRefs(viewSource, 'SubtitleViewRefs')
const allRefs = declaredRefs(refsSource, 'ContentRefs')
const wired = new Set(wiredRefs(contentSource))
const destructured = new Set(destructuredRefs(contentSource))

const missing = declared.filter((key) => !wired.has(key) || !destructured.has(key))
const extra = [...wired].filter((key) => !declared.includes(key))
const notDestructured = allRefs.filter((key) => !destructured.has(key))
const collected = collectedRefs(refsSource)
const notCollected = allRefs.filter((key) => !(key in collected))
const notInTemplate = Object.keys(collected).filter(
  (key) => !templateSource.includes(`id="${collected[key]}"`),
)
const destructuredButUndefined = [...destructured].filter(
  (key) => !allRefs.includes(key) && key !== 'refs',
)

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
if (notDestructured.length > 0) {
  // A ref that exists in ContentRefs and in the view but is never destructured
  // from collectRefs() is a bare identifier: the bundle throws
  // "subListening is not defined" and the whole content script dies.
  console.error(`✗ refs declared but not destructured: ${notDestructured.join(', ')}`)
  failed++
}
if (notCollected.length > 0) {
  // Declared and destructured, but collectRefs() never queries it: the value
  // is undefined and the first property access throws.
  console.error(`✗ refs declared but not collected in collectRefs(): ${notCollected.join(', ')}`)
  failed++
}
if (notInTemplate.length > 0) {
  // The id is queried but no element carries it, so getElementById returns
  // null. That is the other half of the same failure.
  console.error(`✗ collected ids missing from template.ts: ${notInTemplate.join(', ')}`)
  failed++
}
if (destructuredButUndefined.length > 0) {
  console.error(`✗ destructured but not declared in ContentRefs: ${destructuredButUndefined.join(', ')}`)
  failed++
}

if (failed > 0) {
  const problems =
    missing.length +
    extra.length +
    notDestructured.length +
    notCollected.length +
    notInTemplate.length +
    destructuredButUndefined.length
  console.error(`\ncontent refs: ${problems} problem(s)`)
  process.exit(1)
}
console.log(
  `content refs: ${declared.length} subtitle refs wired, ${allRefs.length} refs destructured, ${Object.keys(collected).length} collected`,
)

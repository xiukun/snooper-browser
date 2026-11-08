/**
 * Guards against Vite-only globals leaking into esbuild-built extension
 * bundles. import.meta.env does not exist in MV3 service workers; a module
 * top-level reference crashes the whole worker at evaluation (which took
 * down the toolbar, the drawer, and every message handler at once).
 *
 * Root cause class: extension code importing from src/lib/moss.ts (or any
 * module whose top level touches Vite globals). Keep extension-facing
 * helpers in zero-dependency modules instead.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const offenders = []
for (const name of readdirSync('ext')) {
  const path = join('ext', name)
  if (!statSync(path).isFile() || !name.endsWith('.js')) continue
  if (readFileSync(path, 'utf8').includes('import.meta.env')) offenders.push(path)
}
if (offenders.length) {
  console.error(`import.meta.env found in built bundles: ${offenders.join(', ')}`)
  process.exit(1)
}
console.log('ext bundles clean of import.meta.env')

/**
 * Guards against Vite-only globals leaking into esbuild-built extension
 * bundles. import.meta.env does not exist in MV3 service workers; an unsafe
 * reference at module evaluation can crash every message handler at once.
 *
 * Extension builds define this value as an empty object. Keep this guard so a
 * future bundle change cannot silently restore an unguarded env reference.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const offenders = []
for (const name of readdirSync('ext')) {
  const path = join('ext', name)
  if (!statSync(path).isFile() || !name.endsWith('.js')) continue
  const source = readFileSync(path, 'utf8')
  const executableSource = source.replace(/^\s*\/\/.*$/gm, '')
  if (/import\.meta\.env|import_meta\.env/.test(executableSource)) offenders.push(path)
}
if (offenders.length) {
  console.error(`import.meta.env found in built bundles: ${offenders.join(', ')}`)
  process.exit(1)
}
console.log('ext bundles clean of import.meta.env')

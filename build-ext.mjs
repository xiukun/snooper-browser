/**
 * Build extension TypeScript sources (src/ext/) into loadable JS (ext/).
 * Uses esbuild via npx for fast, type-stripping compilation.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const entries = [
  // Background service worker – must be ESM (manifest "type": "module")
  { in: 'src/ext/background.ts', out: 'ext/background.js', format: 'esm' },
  // Offscreen document – loaded as regular script via offscreen.html
  { in: 'src/ext/offscreen.ts', out: 'ext/offscreen.js', format: 'iife' },
  // Content script – injected as regular script
  { in: 'src/ext/content.ts', out: 'ext/content.js', format: 'iife' },
  // Fullscreen bridge – MAIN world, regular script
  { in: 'src/ext/fullscreen-bridge.ts', out: 'ext/fullscreen-bridge.js', format: 'iife' },
  // Side panel – loaded as regular script via index.html
  { in: 'src/ext/sidepanel/panel.ts', out: 'ext/sidepanel/panel.js', format: 'iife' },
];

// Single version source: package.json. The manifest is tracked so the store
// and the release workflow can read it without running this script, so the
// build keeps it in lockstep instead of letting the two drift.
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifestPath = 'ext/manifest.json';
const manifestRaw = readFileSync(manifestPath, 'utf8');
const manifestSynced = manifestRaw.replace(/(\"version\"\s*:\s*\")[^\"]*(\")/, `$1${version}$2`);
if (manifestSynced !== manifestRaw) {
  writeFileSync(manifestPath, manifestSynced);
  console.log(`  ✅ manifest version → ${version}`);
}

console.log('🔨 Building extension...');

for (const entry of entries) {
  // Extension settings are stored in chrome.storage; Vite's SPA env is not
  // present in MV3 pages and must not be embedded into extension bundles.
  const cmd = `npx esbuild ${entry.in} --bundle --format=${entry.format} --platform=browser --target=chrome116 --define:import.meta.env={} --outfile=${entry.out}`;
  try {
    execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
    console.log(`  ✅ ${entry.in} → ${entry.out} (${entry.format})`);
  } catch (err) {
    console.error(`  ❌ ${entry.in} failed`);
    process.exit(1);
  }
}

mkdirSync('ext/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  cpSync(`icons/icon${size}.png`, `ext/icons/icon${size}.png`);
  console.log(`  ✅ icons/icon${size}.png → ext/icons/icon${size}.png`);
}

mkdirSync('ext/assets', { recursive: true });
cpSync('src/ext/assets', 'ext/assets', { recursive: true });

console.log('✅ Build complete');

/**
 * Build extension TypeScript sources (src/ext/) into loadable JS (ext/).
 * Uses esbuild via npx for fast, type-stripping compilation.
 */
import { execSync } from 'node:child_process';

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

console.log('🔨 Building extension...');

for (const entry of entries) {
  const cmd = `npx esbuild ${entry.in} --bundle --format=${entry.format} --platform=browser --target=chrome116 --outfile=${entry.out}`;
  try {
    execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
    console.log(`  ✅ ${entry.in} → ${entry.out} (${entry.format})`);
  } catch (err) {
    console.error(`  ❌ ${entry.in} failed`);
    process.exit(1);
  }
}

console.log('✅ Build complete');

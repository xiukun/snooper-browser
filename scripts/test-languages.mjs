/**
 * Regression tests for the separate subtitle source and translation target
 * language lists.
 *
 *   node scripts/test-languages.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'snooper-languages-'));
const out = join(outDir, 'models.mjs');
execSync(
  `npx esbuild src/lib/models.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
);

const { SOURCE_LANGUAGES, TARGET_LANGUAGES } = await import(pathToFileURL(out).href);
const codes = (languages) => languages.map(({ code }) => code);
const sourceCodes = codes(SOURCE_LANGUAGES);
const targetCodes = codes(TARGET_LANGUAGES);

const expectedSource = ['auto', 'zh', 'en'];
const expectedTarget = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'ar', 'pt'];
const failures = [];
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
};

check('source language codes', sourceCodes, expectedSource);
check('target language codes', targetCodes, expectedTarget);
if (targetCodes.includes('auto')) failures.push('target languages must not include auto');
if (new Set(sourceCodes).size !== sourceCodes.length) failures.push('source language codes must be unique');
if (new Set(targetCodes).size !== targetCodes.length) failures.push('target language codes must be unique');

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} failed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('4 passed, 0 failed');

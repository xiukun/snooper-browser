/**
 * Regression tests for the MOSS transcription request shape.
 *
 *   node scripts/test-transcription-request.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'snooper-transcription-request-'));
const out = join(outDir, 'transcription-request.mjs');
execSync(
  `npx esbuild src/lib/transcription-request.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
);

const { buildTranscriptionFormData } = await import(pathToFileURL(out).href);
const file = new Blob(['audio'], { type: 'audio/wav' });

const read = async (sourceLang) => {
  const form = buildTranscriptionFormData({
    model: 'moss-transcribe-1.0',
    file,
    sourceLang,
  });
  return Object.fromEntries(form.entries());
};

let passed = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (actual === expected) passed++;
  else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

{
  const fields = await read('zh');
  check('model', fields.model, 'moss-transcribe-1.0');
  check('response format', fields.response_format, 'json');
  check('temperature', fields.temperature, '0');
  check('explicit language', fields.language, 'zh');
  check('no stream field', 'stream' in fields, false);
}

{
  const fields = await read('auto');
  check('auto language omitted', 'language' in fields, false);
}

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`${passed} passed, 0 failed`);

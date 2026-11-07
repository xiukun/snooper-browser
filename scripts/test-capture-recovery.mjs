/**
 * Regression tests for orphaned tab-capture recovery.
 *
 *   node scripts/test-capture-recovery.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'snooper-capture-recovery-'));
const out = join(outDir, 'capture-recovery.mjs');

execSync(
  `npx esbuild src/ext/capture-recovery.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
);

const { forceReleaseOffscreenDocument, waitForCaptureRelease } = await import(pathToFileURL(out).href);

let passed = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (actual === expected) passed++;
  else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

{
  let polls = 0;
  const released = await waitForCaptureRelease(
    async () => {
      polls++;
      return polls < 3;
    },
    { maxAttempts: 5, delayMs: 0, sleep: async () => {} },
  );
  check('waits until the live capture disappears', released, true);
  check('polls through a delayed teardown', polls, 3);
}

{
  let polls = 0;
  const released = await waitForCaptureRelease(
    async () => {
      polls++;
      return true;
    },
    { maxAttempts: 3, delayMs: 0, sleep: async () => {} },
  );
  check('reports a teardown timeout', released, false);
  check('honors the maximum poll count', polls, 3);
}

{
  let closed = false;
  const result = await forceReleaseOffscreenDocument(
    async () => [42],
    async () => { closed = true; },
    async () => false,
    { delayMs: 0, sleep: async () => {} },
  );
  check('does not close offscreen while another tab is recording', result, 'busy');
  check('keeps other captures alive', closed, false);
}

{
  let closed = false;
  let checks = 0;
  const result = await forceReleaseOffscreenDocument(
    async () => [],
    async () => { closed = true; },
    async () => {
      checks++;
      return checks === 1;
    },
    { maxAttempts: 3, delayMs: 0, sleep: async () => {} },
  );
  check('closes an orphaned offscreen document', result, 'released');
  check('calls closeDocument before checking release', closed, true);
}

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`${passed} passed, 0 failed`);

/**
 * Build a diagnostic list of other installed extensions that hold the
 * `tabCapture` permission — the only extensions Chrome allows to own a tab
 * capture stream. When "reset the offscreen document" still reports
 * `active stream`, the holder is one of these (or a second copy of snooper).
 *
 *   node scripts/test-capture-suspects.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'snooper-capture-suspects-'));
const out = join(outDir, 'capture-suspects.mjs');
execSync(
  `npx esbuild src/ext/capture-recovery.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
);

const { describeCaptureSuspects } = await import(pathToFileURL(out).href);

let passed = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

{
  const message = describeCaptureSuspects([
    { name: 'snooper-browser', id: 'aaa' },
    { name: 'ViiTor', id: 'bbb' },
  ]);
  check('names foreign capture holders', message, 'ViiTor');
}

{
  const message = describeCaptureSuspects([
    { name: 'snooper-browser', id: 'aaa' },
    { name: 'snooper-browser', id: 'bbb' },
  ]);
  check('flags a duplicate snooper copy', message, '另一份 snooper-browser');
}

{
  const message = describeCaptureSuspects([{ name: 'snooper-browser', id: 'aaa' }]);
  check('reports an empty suspect list', message, '');
}

{
  const message = describeCaptureSuspects([
    { name: 'snooper-browser', id: 'aaa' },
    { name: 'A', id: 'b1' },
    { name: 'B', id: 'b2' },
  ]);
  check('joins multiple suspects with a separator', message, 'A、B');
}

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`${passed} passed, 0 failed`);

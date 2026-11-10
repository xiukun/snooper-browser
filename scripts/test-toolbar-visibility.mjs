/**
 * Regression tests for page-scoped toolbar visibility (ADR-041 follow-up).
 *
 * The reported bug: after using the toolbar on a video site, it showed up on
 * every later page of that origin — including pages with no player. The
 * persisted flag lived in `localStorage`, which those pages share.
 *
 *   node scripts/test-toolbar-visibility.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'snooper-visibility-'));
const out = join(outDir, 'visibility-policy.mjs');
execSync(
  `npx esbuild src/ext/content/visibility-policy.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
);

const { settleAfterCapture, shouldRestoreUiHidden } = await import(pathToFileURL(out).href);

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

/* ===== Restoring the persisted choice ===== */

eq('nothing stored', shouldRestoreUiHidden(null, null, false), false);
eq('empty storage string is a stored value', shouldRestoreUiHidden('', null, false), false);

// The bug: a choice written on a video page must not follow the user onto a
// page without a player.
eq('video page choice, next page has no player', shouldRestoreUiHidden('0', 'video', false), true);
eq('other page choice stays on other pages', shouldRestoreUiHidden('0', 'other', false), false);
eq('missing scope is not trusted', shouldRestoreUiHidden('1', null, false), false);

// A hidden choice on a video page is restored too — the rule is about the
// page kind, not about the direction of the choice.
eq('hidden choice on a video page', shouldRestoreUiHidden('1', 'video', false), true);

// A running capture must always be reachable, whatever the scope says.
eq('capture overrides the scope gate', shouldRestoreUiHidden('0', 'other', true), true);
eq('capture overrides a missing scope', shouldRestoreUiHidden('1', null, true), true);
eq('capture does not invent a choice', shouldRestoreUiHidden(null, 'other', true), false);

/* ===== Settling after a capture ===== */

eq('already hidden stays hidden', settleAfterCapture(false, true), 'hidden');
eq('player page keeps the toolbar', settleAfterCapture(true, true), 'keep');
eq('no player hides the toolbar', settleAfterCapture(true, false), 'hide');

rmSync(outDir, { recursive: true, force: true });

console.log(`toolbar visibility: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

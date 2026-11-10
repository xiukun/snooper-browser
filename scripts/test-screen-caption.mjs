/**
 * Regression tests for the screen-caption channel helpers (ADR-043).
 *
 * Pure functions only: strip geometry, the frame-change gate, reply parsing and
 * the audio-yield rule. The browser plumbing is exercised by loading the built
 * extension.
 *
 *   node scripts/test-screen-caption.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'snooper-screen-'));
const bundle = (entry, name) => {
  const out = join(outDir, name);
  execSync(
    `npx esbuild ${entry} --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  );
  return out;
};

const {
  SCREEN_AUDIO_YIELD_MS,
  SCREEN_SIGNATURE_THRESHOLD,
  buildScreenCaptionPrompt,
  computeStripRect,
  extractCaptionPayload,
  frameSignature,
  isDuplicateCaption,
  isSameFrame,
  parseScreenCaption,
  shouldYieldAudio,
  signatureDistance,
} = await import(pathToFileURL(bundle('src/lib/screen-caption.ts', 'screen-caption.mjs')).href);

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

/* ===== Strip geometry ===== */

eq('1080p strip', computeStripRect(1920, 1080), { x: 480, y: 880, width: 960, height: 200 });
eq('360p strip', computeStripRect(640, 360), { x: 0, y: 281, width: 640, height: 79 });
eq('narrow strip keeps full width', computeStripRect(320, 240), { x: 0, y: 184, width: 320, height: 56 });
eq('zero width', computeStripRect(0, 720), null);
eq('NaN height', computeStripRect(1280, Number.NaN), null);

const tiny = computeStripRect(200, 100);
check('tiny frame keeps minimum height', !!tiny && tiny.height >= 56, JSON.stringify(tiny));
check('tiny strip fits the frame', !!tiny && tiny.y >= 0 && tiny.y + tiny.height <= 100, JSON.stringify(tiny));

/* ===== Signature gate ===== */

const black = new Uint8ClampedArray(64 * 8 * 4);
for (let i = 0; i < black.length; i += 4) {
  black[i] = 10; black[i + 1] = 10; black[i + 2] = 10; black[i + 3] = 255;
}
const white = new Uint8ClampedArray(64 * 8 * 4);
for (let i = 0; i < white.length; i += 4) {
  white[i] = 250; white[i + 1] = 250; white[i + 2] = 250; white[i + 3] = 255;
}

const sigBlack = frameSignature(black, 64, 8);
const sigWhite = frameSignature(white, 64, 8);
check('signature length', sigBlack.length === 64 * 8, `got ${sigBlack.length}`);
eq('identical distance', signatureDistance(sigBlack, sigBlack), 0);
check('black vs white distance', signatureDistance(sigBlack, sigWhite) > SCREEN_SIGNATURE_THRESHOLD);
check('same frame detection', isSameFrame(sigBlack, sigBlack) === true);
check('changed frame detection', isSameFrame(sigBlack, sigWhite) === false);
check('first frame is never "same"', isSameFrame([], sigBlack) === false);
eq('mismatched signature length', signatureDistance([1], [1, 2]), Infinity);

/* ===== Reply parsing ===== */

eq('plain json', extractCaptionPayload('{"source":"A","target":"B"}'), { source: 'A', target: 'B' });
eq('fenced json', extractCaptionPayload('```json\n{"source":"A","target":"B"}\n```'), { source: 'A', target: 'B' });
eq('prose around json', extractCaptionPayload('Sure: {"source":"A","target":"B"} done'), { source: 'A', target: 'B' });
eq('nested braces', extractCaptionPayload('{"source":"a {b}","target":"c"}'), { source: 'a {b}', target: 'c' });
eq('no json', extractCaptionPayload('no text here'), null);
eq('broken json', extractCaptionPayload('{"source": }'), null);

eq('parse plain', parseScreenCaption('{"source":" Hello ","target":" 你好 "}'), { source: 'Hello', target: '你好' });
eq('missing target falls back to source', parseScreenCaption('{"source":"Hello"}'), { source: 'Hello', target: 'Hello' });
eq('blank target falls back to source', parseScreenCaption('{"source":"Hi","target":"   "}'), { source: 'Hi', target: 'Hi' });
eq('empty source is no caption', parseScreenCaption('{"source":"","target":"你好"}'), { source: '', target: '' });
eq('garbage is no caption', parseScreenCaption('抱歉，我看不清'), { source: '', target: '' });

/* ===== Audio yield ===== */

check('never seen a screen line', shouldYieldAudio(0, 1000) === false);
check('screen line just landed', shouldYieldAudio(1000, 1500) === true);
check('yield window boundary is exclusive', shouldYieldAudio(1000, 1000 + SCREEN_AUDIO_YIELD_MS) === false);
check('inside the window', shouldYieldAudio(1000, 1000 + SCREEN_AUDIO_YIELD_MS - 1) === true);
check('clock skew does not lock audio out', shouldYieldAudio(2000, 1000) === false);

/* ===== Duplicates and prompt ===== */

check('duplicate caption', isDuplicateCaption({ source: 'A', target: 'B' }, { source: 'A', target: 'B' }) === true);
check('changed target is not duplicate', isDuplicateCaption({ source: 'A', target: 'B' }, { source: 'A', target: 'C' }) === false);
check('no previous caption', isDuplicateCaption(null, { source: 'A', target: 'B' }) === false);

const prompt = buildScreenCaptionPrompt('简体中文');
check('prompt names the target language', prompt.includes('简体中文'));
check('prompt asks for json', prompt.includes('{"source"'));
check('prompt asks for no markdown', /no markdown/i.test(prompt));

rmSync(outDir, { recursive: true, force: true });

console.log(`screen-caption: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
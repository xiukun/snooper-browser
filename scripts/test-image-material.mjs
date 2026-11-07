/**
 * Regression tests for remote image materialisation.
 *
 * The important behaviours are security and honesty:
 * - the provider key only travels to the provider's own origin;
 * - a 200 HTML error page never becomes a broken <img>;
 * - oversized or timed-out downloads fail loudly instead of silently.
 *
 *   node scripts/test-image-material.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'snooper-image-material-'));
const out = join(outDir, 'image-material.mjs');

execSync(
  `npx esbuild src/lib/image-material.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
);

const {
  planImageFetch,
  detectImageMime,
  materializeImage,
  MAX_IMAGE_BYTES,
} = await import(pathToFileURL(out).href);

let passed = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};
const expectThrow = async (name, fn, includes) => {
  try {
    await fn();
    failures.push(`${name}: expected a rejection`);
  } catch (error) {
    if (includes && !String(error?.message || error).includes(includes)) {
      failures.push(`${name}: message ${JSON.stringify(error?.message)} lacks ${JSON.stringify(includes)}`);
    } else {
      passed++;
    }
  }
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = new Uint8Array([...'GIF89a'].map((char) => char.charCodeAt(0)));
const WEBP = new Uint8Array([...'RIFF????WEBP'].map((char) => char.charCodeAt(0)));
const BMP = new Uint8Array([...'BM????'].map((char) => char.charCodeAt(0)));
const HTML = new Uint8Array([...'<!doctype html>'].map((char) => char.charCodeAt(0)));

/* ---------- 1. URL and key policy ---------- */

check(
  'absolute URL keeps the provider origin',
  planImageFetch('https://cdn.example.com/a.png', 'https://api.example.com/v1', 'sk-secret'),
  { url: 'https://cdn.example.com/a.png', headers: {} },
);
check(
  'same-origin URL carries the key',
  planImageFetch('https://api.example.com/images/a.png', 'https://api.example.com/v1', 'sk-secret'),
  { url: 'https://api.example.com/images/a.png', headers: { Authorization: 'Bearer sk-secret' } },
);
check(
  'relative URL resolves against the provider base',
  planImageFetch('images/a.png', 'https://api.example.com/v1', 'sk-secret'),
  { url: 'https://api.example.com/v1/images/a.png', headers: { Authorization: 'Bearer sk-secret' } },
);
await expectThrow(
  'rejects non-http protocols',
  async () => planImageFetch('file:///etc/passwd', 'https://api.example.com/v1', ''),
  '不支持的图片协议',
);

/* ---------- 2. Content sniffing ---------- */

check('trusts an explicit image content type', detectImageMime('image/png; charset=binary', HTML), 'image/png');
check('detects PNG magic bytes', detectImageMime('application/octet-stream', PNG), 'image/png');
check('detects JPEG magic bytes', detectImageMime('', JPEG), 'image/jpeg');
check('detects GIF magic bytes', detectImageMime('application/octet-stream', GIF), 'image/gif');
check('detects WebP magic bytes', detectImageMime('application/octet-stream', WEBP), 'image/webp');
check('detects BMP magic bytes', detectImageMime('application/octet-stream', BMP), 'image/bmp');
check('rejects a 200 HTML error page', detectImageMime('text/html', HTML), null);
check('rejects HTML mislabelled as a stream', detectImageMime('application/octet-stream', HTML), null);

/* ---------- 3. Download + data URL ---------- */

const calls = [];
const fakeFetch = (responses) => async (url, init = {}) => {
  calls.push({ url, headers: init.headers || {} });
  const response = responses.shift();
  if (response instanceof Error) throw response;
  return response;
};
const response = (body, type = 'application/octet-stream', headers = {}) => ({
  ok: true,
  status: 200,
  headers: {
    get: (name) => {
      const key = name.toLowerCase();
      if (key === 'content-type') return type;
      return headers[key] ?? null;
    },
  },
  arrayBuffer: async () => body.buffer ?? body,
});

calls.length = 0;
const dataUrl = await materializeImage(
  'https://api.example.com/a.png',
  'https://api.example.com/v1',
  'sk-secret',
  { fetchImpl: fakeFetch([response(PNG)]) },
);
check('materialises a PNG into a data URL', dataUrl.startsWith('data:image/png;base64,'), true);
check('sends the key to the provider', calls[0].headers.Authorization, 'Bearer sk-secret');

calls.length = 0;
await materializeImage(
  'https://cdn.example.com/a.png',
  'https://api.example.com/v1',
  'sk-secret',
  { fetchImpl: fakeFetch([response(PNG)]) },
);
check('never sends the key to a CDN', calls[0].headers.Authorization, undefined);

calls.length = 0;
const passthrough = await materializeImage('data:image/png;base64,AAAA', 'https://api.example.com/v1', '');
check('passes data URLs through unchanged', passthrough, 'data:image/png;base64,AAAA');
check('does not fetch a data URL', calls.length, 0);

await expectThrow(
  'rejects an HTML body',
  async () => materializeImage('https://api.example.com/a.png', 'https://api.example.com/v1', '', {
    fetchImpl: fakeFetch([response(HTML, 'text/html')]),
  }),
  '不是图片',
);

await expectThrow(
  'rejects a declared oversized body',
  async () => materializeImage('https://api.example.com/a.png', 'https://api.example.com/v1', '', {
    fetchImpl: fakeFetch([response(PNG, 'image/png', { 'content-length': String(MAX_IMAGE_BYTES + 1) })]),
  }),
  '超过 12 MB',
);

const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
await expectThrow(
  'rejects an oversized body without content-length',
  async () => materializeImage('https://api.example.com/a.png', 'https://api.example.com/v1', '', {
    fetchImpl: fakeFetch([response(huge, 'image/png')]),
  }),
  '超过 12 MB',
);

await expectThrow(
  'rejects an HTTP error',
  async () => materializeImage('https://api.example.com/a.png', 'https://api.example.com/v1', '', {
    fetchImpl: fakeFetch([{ ok: false, status: 502, headers: { get: () => null } }]),
  }),
  'HTTP 502',
);

await expectThrow(
  'reports a timeout',
  async () => materializeImage('https://api.example.com/a.png', 'https://api.example.com/v1', '', {
    timeoutMs: 5,
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  }),
  '超时',
);

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`✅ ${passed} image-material checks passed`);

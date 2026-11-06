import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionDir = join(root, 'ext');
const manifestPath = join(extensionDir, 'manifest.json');
const outputDir = join(root, 'dist-extension');

// Build first. A clean checkout has no ext/*.js yet, so validating artifacts
// before this step made `npm run package:ext` fail on first use.
execSync('node build-ext.mjs', { cwd: root, stdio: 'inherit' });

if (!existsSync(manifestPath)) {
  throw new Error('ext/manifest.json does not exist after the extension build.');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error(`Invalid extension version: ${manifest.version}`);
}

function manifestReferences(m) {
  const refs = new Set(['manifest.json']);
  const add = (value) => { if (typeof value === 'string') refs.add(value); };
  add(m.background?.service_worker);
  add(m.side_panel?.default_path);
  for (const script of m.content_scripts || []) {
    for (const file of script.js || []) add(file);
    for (const file of script.css || []) add(file);
  }
  for (const resource of m.web_accessible_resources || []) {
    for (const file of resource.resources || []) add(file);
  }
  for (const file of Object.values(m.icons || {})) add(file);
  for (const file of Object.values(m.action?.default_icon || {})) add(file);
  return [...refs].sort();
}

const references = manifestReferences(manifest);
const missing = references.filter((ref) => !existsSync(join(extensionDir, ref)));
if (missing.length > 0) {
  throw new Error(`Manifest references missing files:\n${missing.map((ref) => `  - ext/${ref}`).join('\n')}`);
}

// Apache-2.0 requires recipients of a binary distribution to receive the
// license and NOTICE. Copy them to the archive root so they ship inside the ZIP.
const legalFiles = ['LICENSE', 'NOTICE'];
for (const file of legalFiles) {
  const source = join(root, file);
  if (!existsSync(source)) {
    throw new Error(`Refusing to package without ${file}; Apache-2.0 distributions must include it.`);
  }
  cpSync(source, join(extensionDir, file));
}

// Never ship source maps, TypeScript sources, editor metadata, or test files.
const forbiddenFile = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX)(\/|$)|\.(ts|tsx|map)$|(^|\/)(src|test|tests|node_modules)(\/|$)/;
const forbidden = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(extensionDir, full).split('\\').join('/');
    if (forbiddenFile.test(rel)) forbidden.push(rel);
    if (statSync(full).isDirectory()) walk(full);
  }
}
walk(extensionDir);
if (forbidden.length > 0) {
  throw new Error(`Refusing to package non-runtime files:\n${forbidden.map((file) => `  - ext/${file}`).join('\n')}`);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const archiveName = `snooper-browser-v${manifest.version}.zip`;
const archivePath = join(outputDir, archiveName);
execFileSync('zip', ['-qrX', archivePath, '.', '-x', '*.DS_Store', '*/.*', '*.map', '*.ts'], {
  cwd: extensionDir,
  stdio: 'inherit',
});

const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
  .split('\n')
  .map((entry) => entry.trim())
  .filter(Boolean);
for (const required of ['manifest.json', ...legalFiles]) {
  if (!entries.includes(required)) {
    throw new Error(`Archive ${archiveName} is missing ${required}.`);
  }
}

const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
writeFileSync(`${archivePath}.sha256`, `${digest}  ${basename(archivePath)}\n`);

console.log(`Packaged ${archivePath}`);
console.log(`SHA-256 ${digest}`);

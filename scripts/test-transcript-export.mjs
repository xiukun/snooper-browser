/** Exercise actual toolbar handlers, including ZIP's record.md body. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'snooper-export-'))
const out = join(dir, 'actions.mjs')
execFileSync('node_modules/.bin/esbuild', ['src/ext/content/actions.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'])
const { bindActions } = await import(pathToFileURL(out))
const listeners = {}, notices = [], files = [], blobs = new Map()
const refs = Object.fromEntries(['copy', 'exportTxt', 'exportMd', 'note', 'summary', 'image', 'screenshot'].map(key => [key, { addEventListener(_, cb) { listeners[key] = cb }, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} }]))
globalThis.location = { href: 'https://example.test/course' }
globalThis.document = { title: '课程', createElement() { return { click() { files.push({ name: this.download, blob: blobs.get(this.href) }) } } } }
URL.createObjectURL = blob => { const url = `blob:${blobs.size}`; blobs.set(url, blob); return url }
URL.revokeObjectURL = () => {}
const all = Array.from({ length: 450 }, (_, i) => ({ id: `line${i}`, at: i, source: `source-${i}`, target: `target-${i}` }))
const session = { sourceLang: 'en', targetLang: 'zh', subtitles: all.slice(-200), messages: [], notes: [] }
let complete = true
bindActions({ refs, getSession: () => session, getTranscript: async () => ({ subtitles: complete ? all : [all[0]], complete }), toast: text => notices.push(text), flashChip() {}, addNoteEntry: async () => false, openImagePanel() {}, captureVideoFrame: async () => ({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', cropped: true }), openShotPreview() {}, summarize: async () => ({ ok: true, summary: 'summary' }), openNotes() {} })
await listeners.exportTxt()
assert.match(await files.at(-1).blob.text(), /source-0/)
assert.match(await files.at(-1).blob.text(), /target-449/)
await listeners.exportMd()
assert.match(await files.at(-1).blob.text(), /source-0/)
session.notes.push({ id: 'note', title: '图', createdAt: 1, updatedAt: 1, entries: [{ id: 'image', type: 'screenshot', at: 1, imageUrl: 'data:image/png;base64,iVBORw0KGgo=' }] })
await listeners.exportMd()
assert.match(files.at(-1).name, /\.zip$/)
const bytes = new Uint8Array(await files.at(-1).blob.arrayBuffer())
const view = new DataView(bytes.buffer)
const nameLength = view.getUint16(26, true), size = view.getUint32(18, true)
const md = new TextDecoder().decode(bytes.subarray(30 + nameLength, 30 + nameLength + size))
assert.match(md, /source-0/)
assert.match(md, /target-449/)
complete = false
await listeners.exportTxt()
assert.match(notices.at(-1), /仅导出可用内容/)
assert.match(await files.at(-1).blob.text(), /source-0/)
const before = notices.length
await listeners.note()
await listeners.summary()
await listeners.screenshot()
assert.equal(notices.slice(before).some(n => /已.*笔记/.test(n)), false)
rmSync(dir, { recursive: true, force: true })
console.log('✅ transcript-export: TXT/Markdown/ZIP full bodies, partial labels and failed-save feedback passed')

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'snooper-notes-'))
const out = join(dir, 'store.mjs')
const bundleEntry = join(dir, 'entry.ts')
writeFileSync(bundleEntry, `export * from '${resolve('src/ext/background/notes-store.ts')}'; export { notesHandlers } from '${resolve('src/ext/background/router/notes.ts')}'; export * as client from '${resolve('src/ext/content/notes-store.ts')}';`)
execFileSync('node_modules/.bin/esbuild', [bundleEntry, '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' })
const values = {}
let fail = ''
const fault = method => { if (fail === method) { fail = ''; throw new Error('injected ' + method) } }
globalThis.chrome = { storage: { local: {
  async get(keys) { fault('get'); return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in values).map(k => [k, structuredClone(values[k])])) },
  async set(items) { fault('set'); Object.assign(values, structuredClone(items)) },
  async remove(keys) { fault('remove'); for (const k of Array.isArray(keys) ? keys : [keys]) delete values[k] },
} } }
const notes = await import(pathToFileURL(out))
const entry = (id, text) => ({ id, type: 'text', at: 1, text })
const mirror = new Map()
let afterList = null
globalThis.localStorage = { getItem: key => mirror.get(key) ?? null, setItem: (key,value) => mirror.set(key,value), removeItem: key => mirror.delete(key) }
chrome.runtime = { sendMessage: message => new Promise(resolve => notes.notesHandlers[message.type](message, { sendResponse: result => { if (message.type === 'NOTES_LIST') afterList?.(); resolve(structuredClone(result)) } })) }
const oldNotes = [{ id: 'legacy-origin-a', title: '旧课程', createdAt: 1, updatedAt: 1, entries: [entry('old-1', '原手机课程')] }]
// P1: the sidepanel has no page-local legacy data. Its empty read must not
// consume a later page's migration or authorize removing the only old copy.
assert.deepEqual(await notes.listNotes(), [])
assert.equal(Object.keys(values).length, 0, 'a no-data read must not initialize storage')
assert.deepEqual(await notes.listNotes([]), [])
assert.equal(Object.keys(values).length, 0, 'an empty legacy array must not initialize storage')
mirror.set(notes.NOTES_STORAGE_KEY, JSON.stringify(oldNotes))
assert.deepEqual((await notes.client.loadNotes()).map(n => n.id), ['legacy-origin-a'], 'empty first read must allow the later page legacy body to migrate')
assert.equal(mirror.has(notes.NOTES_STORAGE_KEY), false, 'acknowledged migrated mirror can be removed')
// A different origin can have genuinely unseen old data. If automatic merge
// is unsafe after initialization, its original must stay available explicitly.
const otherOrigin = [{ ...oldNotes[0], id: 'legacy-origin-b' }]
mirror.set(notes.NOTES_STORAGE_KEY, JSON.stringify(otherOrigin))
await notes.client.loadNotes()
assert.equal(mirror.get(notes.NOTES_STORAGE_KEY), JSON.stringify(otherOrigin))
assert.equal(notes.client.hasRetainedLegacyNotes(), true)
assert.equal(notes.client.readRetainedLegacyNotes(), JSON.stringify(otherOrigin))
// Even acknowledgement of the submitted snapshot cannot remove a copy that
// the page updated while the asynchronous migration request was pending.
mirror.set(notes.NOTES_STORAGE_KEY, JSON.stringify(oldNotes))
afterList = () => { mirror.set(notes.NOTES_STORAGE_KEY, JSON.stringify(otherOrigin)); afterList = null }
await notes.client.loadNotes()
assert.equal(mirror.get(notes.NOTES_STORAGE_KEY), JSON.stringify(otherOrigin))
for (const key of Object.keys(values)) delete values[key]
mirror.clear()

await Promise.all([
  notes.addNoteEntry({ noteId: 'n1', entry: entry('e1', '手机') }),
  notes.addNoteEntry({ noteId: 'n1', entry: entry('e2', '电脑') }),
])
assert.deepEqual((await notes.listNotes())[0].entries.map(e => e.id).sort(), ['e1', 'e2'])
await notes.addNoteEntry({ noteId: 'n1', entry: entry('e1', '手机') })
assert.equal((await notes.listNotes())[0].entries.length, 2)
fail = 'set'
await assert.rejects(notes.addNoteEntry({ noteId: 'n1', entry: entry('e3', '失败') }), /injected/)
assert.equal((await notes.listNotes())[0].entries.length, 2)
fail = 'get'
await assert.rejects(notes.listNotes(), /injected/)
fail = 'get'
await assert.rejects(notes.addNoteEntry({ noteId: 'n1', entry: entry('e3', '失败') }), /injected/)
await notes.deleteNoteEntry('n1', 'e1')
assert.deepEqual((await notes.listNotes())[0].entries.map(e => e.id), ['e2'])
fail = 'set'
await assert.rejects(notes.deleteNoteDocuments(['n1']), /injected/)
assert.equal((await notes.listNotes()).length, 1)
await notes.deleteNoteDocuments(['n1'])
const legacy = [{ id: 'n1', title: '旧镜像', createdAt: 1, updatedAt: 1, entries: [entry('e1', '手机')] }]
assert.deepEqual(await notes.listNotes(legacy), [])
mirror.set(notes.NOTES_STORAGE_KEY, JSON.stringify(legacy))
assert.deepEqual(await notes.client.loadNotes(), [])
assert.equal(mirror.get(notes.NOTES_STORAGE_KEY), JSON.stringify(legacy), 'unacknowledged stale mirror stays intact without reviving deleted notes')
assert.equal(notes.client.hasRetainedLegacyNotes(), true)
// Clearing the shared key cannot turn a stale page mirror into a fresh migration.
delete values[notes.NOTES_STORAGE_KEY]
assert.deepEqual(await notes.listNotes(legacy), [])
// A failed cleanup is surfaced, and the committed migration is safe to retry.
for (const key of Object.keys(values)) delete values[key]
fail = 'remove'
await assert.rejects(notes.listNotes(legacy), /injected/)
assert.equal((await notes.listNotes(legacy))[0].entries.length, 1)
rmSync(dir, { recursive: true, force: true })
console.log('✅ notes-store: concurrency, idempotency, read/write/delete failures, migration and stale-mirror checks passed')

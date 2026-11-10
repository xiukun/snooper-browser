import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'snooper-notes-'))
const out = join(dir, 'store.mjs')
execFileSync('node_modules/.bin/esbuild', ['src/ext/background/notes-store.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' })
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

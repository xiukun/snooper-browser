/** Real session/store integration under sustained failure and worker recovery. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'snooper-session-persist-'))
const entry = join(dir, 'entry.ts'), out = join(dir, 'test.mjs')
writeFileSync(entry, `export * from '${resolve('src/ext/background/session-store.ts')}'; export * from '${resolve('src/ext/background/transcript-store.ts')}'; export * from '${resolve('src/ext/background/recovery.ts')}'; export * from '${resolve('src/ext/background/lifecycle.ts')}';`)
execFileSync('node_modules/.bin/esbuild', [entry, '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error', '--define:import.meta.env={}'])
const values = {}, snapshot = {}, messages = [], events = {}
const listen = name => ({ addListener(fn) { events[name] = fn } })
let rejectLocal = false, stopCount = 0
let onLocalGet = null, onLocalSet = null
const area = (store, local = false) => ({
  async get(keys) { if (local) await onLocalGet?.(keys); return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in store).map(k => [k, structuredClone(store[k])])) },
  async set(items) { if (local && rejectLocal) throw new Error('quota'); Object.assign(store, structuredClone(items)); if (local) await onLocalSet?.(items) },
  async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k] },
})
globalThis.chrome = {
  storage: { local: area(values, true), session: area(snapshot) },
  tabs: { onRemoved: listen('removed'), onUpdated: listen('updated'), onActivated: listen('activated'), async sendMessage(_, message) { messages.push(message) } },
  action: { onClicked: listen('clicked') },
  runtime: { onInstalled: listen('installed'), getURL: p => `chrome-extension://test/${p}`, async getContexts() { return [] }, async sendMessage(m) { if (m.type === 'STOP_CAPTURE') stopCount++; return { ok: true } } },
  offscreen: { async hasDocument() { return true }, async closeDocument() {} },
}
const mod = await import(pathToFileURL(out))
const session = mod.createSession(1)
session.state = 'running'; session.generation = 1
await mod.ensureTranscript(session)
rejectLocal = true
for (let i = 0; i < mod.MAX_UNSAVED_SESSION_LINES; i++) {
  mod.saveSessionSubtitle(session, { id: `line-${i}`, at: i, endedAt: null, videoTime: null, source: `手机 ${i}`, target: `电脑 ${i}`, latency: 0 })
  await new Promise(resolve => setTimeout(resolve, 0))
}
assert.equal(session.pendingTranscriptLines.length, 180)
assert.equal(session.saveState.status, 'error')
assert.equal(session.state, 'idle')
assert.equal(stopCount, 1)
assert.equal(mod.safeSession(session).pendingTranscriptCount, 180)
assert.ok(messages.some(m => m.session?.saveState.status === 'error'))
assert.equal(JSON.parse(snapshot[mod.SESSION_RECOVERY_KEY])['1'].pendingTranscriptLines.length, 180)
// Explicit STOP increments generation before a failed tail is saved.
session.generation = 2
mod.persistSessions()
// Simulate a new worker after failed local writes; preserve recovery snapshot.
rejectLocal = false
const restarted = await import(`${pathToFileURL(out)}?restart`)
await restarted.recoverSessions()
const recovered = restarted.sessions.get(1)
assert.equal(recovered.pendingTranscriptLines.length, 180)
await restarted.retrySessionTranscript(recovered)
await restarted.finishSessionTranscript(recovered)
const lines = await restarted.readTranscript(recovered.transcriptId)
assert.equal(lines.length, 180)
assert.equal(lines[0].id, 'line-0')
assert.equal(lines.at(-1).id, 'line-179')
assert.equal(recovered.saveState.status, 'saved')
assert.equal(recovered.pendingTranscriptLines.length, 0)
// Closing a tab during a storage failure must retain its rescue draft.
restarted.registerLifecycleListeners()
const closing = restarted.createSession(2)
closing.state = 'running'; closing.generation = 2
await restarted.ensureTranscript(closing)
rejectLocal = true
restarted.saveSessionSubtitle(closing, { id:'closed-line', at:1, endedAt:null, videoTime:null, source:'关闭标签仍保留', target:'内容', latency:0 })
await new Promise(resolve => setTimeout(resolve, 0))
events.removed(2)
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(restarted.sessions.get(2).pendingTranscriptLines[0].id, 'closed-line')
assert.equal(JSON.parse(snapshot[mod.SESSION_RECOVERY_KEY])['2'].saveState.status, 'error')
rejectLocal = false
await restarted.retrySessionTranscript(closing)
await restarted.finishSessionTranscript(closing)
assert.equal((await restarted.readTranscript(closing.transcriptId))[0].id, 'closed-line')
// P2: hold a queued history read between the first append's index commit
// and the session's final flush, then deliver another subtitle in that gap.
const racing = restarted.createSession(3)
racing.state = 'running'; racing.generation = 3
await restarted.ensureTranscript(racing)
const heldRead = Promise.withResolvers(), releaseRead = Promise.withResolvers()
let historyRead
onLocalSet = items => {
  if (!items[mod.TRANSCRIPT_INDEX_KEY]?.some(r => r.id === racing.transcriptId && r.subtitleCount === 1)) return
  onLocalSet = null
  onLocalGet = async keys => {
    if (!(Array.isArray(keys) ? keys : [keys]).includes(mod.TRANSCRIPT_INDEX_KEY)) return
    onLocalGet = null
    heldRead.resolve()
    await releaseRead.promise
  }
  historyRead = restarted.listTranscripts()
}
const raceLine = id => ({ id, at: 1, endedAt: null, videoTime: null, source: id, target: id, latency: 0 })
restarted.saveSessionSubtitle(racing, raceLine('race-first'))
const attempt = restarted.retrySessionTranscript(racing)
await heldRead.promise
restarted.saveSessionSubtitle(racing, raceLine('race-during-flush'))
releaseRead.resolve()
await historyRead
await attempt
assert.equal(racing.pendingTranscriptLines.length, 0, 'final flush must recheck newly arrived session rows before reporting saved')
assert.equal(racing.saveState.status, 'saved')
assert.deepEqual((await restarted.readTranscript(racing.transcriptId)).map(l => l.id), ['race-first', 'race-during-flush'])
rmSync(dir, { recursive: true, force: true })
console.log('✅ session-persistence: bounded stop, error propagation, restart replay and retry without loss passed')

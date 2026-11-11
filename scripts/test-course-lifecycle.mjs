/** Actual-module regression for confirmed deletion and bounded automatic STOP. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'snooper-course-lifecycle-'))
const out = join(dir, 'actual.mjs')
let instance = 0
const fresh = () => import(`${pathToFileURL(out)}?instance=${++instance}`)
function environment(seed = {}) {
  const local = structuredClone(seed.local || {}), snapshot = structuredClone(seed.snapshot || {}), sent = [], events = {}
  const controls = { beforeLocalSet: null, beforeSessionSet: null, beforeRemove: null, stop: null, liveCapture: null }
  const area = (values, session = false) => ({
    async get(keys) {
      return Object.fromEntries((keys === null ? Object.keys(values) : Array.isArray(keys) ? keys : [keys]).filter(k => k in values).map(k => [k, structuredClone(values[k])]))
    },
    async set(items) {
      const cloned = structuredClone(items)
      await (session ? controls.beforeSessionSet : controls.beforeLocalSet)?.(cloned)
      Object.assign(values, cloned)
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys]
      await controls.beforeRemove?.(list, session)
      for (const key of list) delete values[key]
    },
    async getBytesInUse() { return JSON.stringify(values).length },
  })
  globalThis.chrome = {
    storage: { local: area(local), session: area(snapshot, true) },
    tabs: { async sendMessage() {} },
    runtime: { onMessage: { addListener(fn) { events.message = fn } }, getURL: p => `chrome-extension://test/${p}`, async getContexts() { return [] }, async sendMessage(message) {
      sent.push(structuredClone(message))
      if (message.type === 'GET_CAPTURE_SESSIONS') return controls.liveCapture || { ok: true, sessions: {}, sources: {} }
      if (message.type === 'STOP_CAPTURE') return controls.stop ? controls.stop(message) : { ok: true }
      return { ok: true }
    } },
    offscreen: { async hasDocument() { return true }, async closeDocument() {} },
  }
  return { local, snapshot, sent, controls, async event(message) {
    return new Promise(resolve => events.message(message, { url: chrome.runtime.getURL('offscreen.html') }, resolve))
  } }
}
const line = (owner, id) => ({ id, sourceRef: owner.sourceRef, at: 1, endedAt: null, videoTime: 4, source: `手机 ${id}`, target: `电脑 ${id}`, latency: 0 })
async function bound(mod, tabId = 41) {
  const owner = mod.createSession(tabId)
  owner.state = 'running'; owner.generation = tabId + 100
  mod.bindInitialSource(owner, `https://www.youtube.com/watch?v=course${tabId}`, `Course ${tabId}`)
  await mod.ensureTranscript(owner)
  return owner
}
async function saved(mod, tabId = 41) {
  const owner = await bound(mod, tabId)
  const entry = line(owner, `saved-${tabId}`)
  owner.subtitles.push(entry); mod.saveSessionSubtitle(owner, entry)
  await mod.retrySessionTranscript(owner)
  owner.state = 'idle'; await mod.finishSessionTranscript(owner)
  await mod.persistSessionsStrict()
  await mod.setFavorite({ kind: 'transcript', recordId: owner.transcriptId, lineId: entry.id }, true)
  return owner
}
async function deletion() {
  const env = environment(), mod = await fresh(), owner = await saved(mod)
  const id = owner.transcriptId
  const preview = await mod.prepareDelete({ transcriptIds: [id] })
  const deleted = await mod.confirmDelete(preview.token)
  assert.equal(deleted.completed.length, 1); assert.equal(deleted.pending.length, 0)
  await mod.persistSessionsStrict()
  const restarted = await fresh(); await restarted.recoverSessions()
  const recovered = restarted.sessions.get(41)
  assert.equal(recovered.pendingTranscriptLines.length, 0)
  assert.equal(recovered.saveState.status, 'saved', 'F1: confirmed deletion must not become a false unsaved error after recovery')
  assert.equal(recovered.transcriptId, null)
  await restarted.retrySessionTranscript(recovered)
  assert.equal(await restarted.getTranscriptRecord(id), null)
  assert.deepEqual(env.local[mod.FAVORITES_KEY], [])
  const response = await new Promise(resolve => restarted.sessionHandlers.START({}, { tabId: 41, sendResponse: resolve }))
  assert.equal(response.code, 'CONFIG_REQUIRED', 'next START must reach normal configuration handling')
  await restarted.persistSessionsStrict()
  console.log('course-lifecycle F1: confirmed deletion/recovery/retry/START passed')
}
async function automaticStop(finalizeFault = false) {
  const env = environment(), mod = await fresh(), owner = await bound(mod)
  const id = owner.transcriptId
  const held = Promise.withResolvers(), release = Promise.withResolvers()
  env.controls.beforeLocalSet = async () => { env.controls.beforeLocalSet = null; held.resolve(); await release.promise }
  mod.saveSessionSubtitle(owner, line(owner, 'row-0'))
  await held.promise
  for (let i = 1; i < 180; i++) mod.saveSessionSubtitle(owner, line(owner, `row-${i}`))
  if (finalizeFault) env.controls.beforeLocalSet = async items => {
    if (items[mod.TRANSCRIPT_INDEX_KEY]?.some(record => record.id === id && record.status === 'completed')) throw new Error('finalize quota')
  }
  release.resolve()
  if (finalizeFault) {
    await assert.rejects(mod.retrySessionTranscript(owner), /finalize quota/)
    assert.equal(owner.state, 'idle'); assert.equal(owner.saveState.status, 'error')
    assert.equal(owner.transcriptFinalizationPending, true)
    assert.equal(owner.pendingTranscriptLines.length, 0)
    assert.equal((await mod.readTranscript(id)).length, 180)
    env.controls.beforeLocalSet = null
  }
  await mod.retrySessionTranscript(owner)
  const record = await mod.getTranscriptRecord(id), rows = await mod.readTranscript(id)
  assert.equal(env.sent.filter(m => m.type === 'STOP_CAPTURE').length, 1)
  assert.equal(owner.state, 'idle'); assert.equal(owner.saveState.status, 'saved')
  assert.equal(owner.pendingTranscriptLines.length, 0)
  assert.equal(rows.length, 180); assert.equal(new Set(rows.map(row => row.id)).size, 180)
  assert.equal(record.status, 'completed', 'F2: successful bounded STOP must complete the durable record')
  const preview = await mod.prepareDelete({ transcriptIds: [id] })
  assert.deepEqual(preview.targets, [{ kind: 'transcript', recordId: id }])
  await mod.persistSessionsStrict()
  console.log(`course-lifecycle F2: ${finalizeFault ? 'finalization fault/retry' : 'delayed first write'}/180 unique rows/STOP/completed/delete eligible passed`)
}
async function deletionRetryAndCrash() {
  let env = environment(), mod = await fresh(), owner = await saved(mod)
  const id = owner.transcriptId
  const preview = await mod.prepareDelete({ transcriptIds: [id] })
  env.controls.beforeRemove = async (keys, session) => {
    if (!session && keys.some(key => key.startsWith(mod.TRANSCRIPT_CHUNK_PREFIX))) throw new Error('delete quota')
  }
  const failed = await mod.confirmDelete(preview.token)
  assert.equal(failed.pending.length, 1); assert.equal(owner.transcriptId, id)
  assert.equal(owner.subtitles.length, 1)
  env.controls.beforeRemove = null
  const retried = await mod.retryDelete(preview.token)
  assert.equal(retried.completed.length, 1); assert.equal(retried.pending.length, 0)
  assert.equal(owner.transcriptId, null); assert.deepEqual(env.local[mod.FAVORITES_KEY], [])
  await mod.persistSessionsStrict()
  console.log('course-lifecycle F1: failed body deletion leaves projection; authorized retry detaches it passed')

  env = environment(); mod = await fresh(); owner = await saved(mod)
  const crashId = owner.transcriptId
  const before = JSON.parse(env.snapshot[mod.SESSION_RECOVERY_KEY])
  const token = (await mod.prepareDelete({ transcriptIds: [crashId] })).token
  // Capture cloned storage exactly after body deletion, before favorites and
  // session snapshot cleanup; the fresh worker gets no old module caches.
  const held = Promise.withResolvers(), release = Promise.withResolvers()
  env.controls.beforeLocalSet = async items => {
    if (!(mod.FAVORITES_KEY in items)) return
    env.controls.beforeLocalSet = null; held.resolve(); await release.promise
  }
  const deleting = mod.confirmDelete(token)
  await held.promise
  const crashed = { local: structuredClone(env.local), snapshot: structuredClone(env.snapshot) }
  assert.equal(crashed.local[mod.TRANSCRIPT_INDEX_KEY].some(r => r.id === crashId), false)
  assert.equal(JSON.parse(crashed.snapshot[mod.SESSION_RECOVERY_KEY])['41'].transcriptId, crashId)
  release.resolve(); await deleting; await mod.persistSessionsStrict()
  env = environment(crashed); mod = await fresh(); await mod.recoverSessions()
  const recovered = mod.sessions.get(41)
  assert.equal(recovered.transcriptId, null); assert.equal(recovered.saveState.status, 'saved')
  assert.deepEqual(env.local[mod.FAVORITES_KEY], [])
  assert.equal(await mod.getTranscriptRecord(crashId), null)
  assert.equal((await mod.retryDelete(token)).pending.length, 0)
  // Even a stale pre-deletion snapshot remains recognizable after the outer
  // operation is completed; authorization is not discarded with the body.
  await mod.persistSessionsStrict()
  env.snapshot[mod.SESSION_RECOVERY_KEY] = JSON.stringify(before)
  const restarted = await fresh(); await restarted.recoverSessions()
  assert.equal(restarted.sessions.get(41).transcriptId, null)
  assert.equal(restarted.sessions.get(41).saveState.status, 'saved')
  await restarted.persistSessionsStrict()
  console.log('course-lifecycle F1: crash at body/snapshot boundary and completed-journal stale snapshot passed')
}
async function deletionScope() {
  const env = environment(), mod = await fresh(), deleted = await saved(mod)
  const deletedId = deleted.transcriptId
  const active = await bound(mod, 42)
  const activeId = active.transcriptId
  const old = await saved(mod, 43), oldId = old.transcriptId
  // Construct a retired, fully saved owner by the actual transition + drain.
  old.state = 'running'
  const next = await mod.transitionSource(43, { url: 'https://youtu.be/newLesson', title: 'New' })
  await mod.drainSource(next, old.sourceEpoch)
  const nextId = next.transcriptId
  assert.equal(next.retiringSources[0], old)
  const keepRetired = await saved(mod, 44)
  next.retiringSources.push(keepRetired)
  keepRetired.sourceDrained = true
  // A second projection with an invalid source binding must never be erased.
  const corrupt = structuredClone(deleted)
  corrupt.sourceEpoch = 'wrong-epoch'
  next.retiringSources.push(corrupt); corrupt.sourceDrained = true
  // A real pending row is retained even if it references the authorized ID.
  const pending = structuredClone(deleted)
  pending.pendingTranscriptLines = [line(deleted, 'genuinely-unsaved')]
  pending.saveState = { status: 'error', message: 'quota' }; pending.sourceDrained = true
  next.retiringSources.push(pending)
  await mod.persistSessionsStrict()
  const preview = await mod.prepareDelete({ transcriptIds: [deletedId, oldId] })
  const result = await mod.confirmDelete(preview.token)
  assert.equal(result.completed.length, 2)
  assert.equal(deleted.transcriptId, null); assert.equal(old.transcriptId, null)
  assert.equal(active.transcriptId, activeId); assert.equal(active.state, 'running')
  assert.equal(next.transcriptId, nextId); assert.equal(next.state, 'running')
  assert.equal(keepRetired.subtitles.length, 1); assert.notEqual(keepRetired.transcriptId, null)
  assert.equal(corrupt.transcriptId, deletedId)
  assert.equal(pending.transcriptId, deletedId); assert.equal(pending.pendingTranscriptLines[0].id, 'genuinely-unsaved')
  await mod.persistSessionsStrict()
  const restarted = await fresh(); await restarted.recoverSessions()
  const restored = restarted.sessions.get(43)
  const retainedPending = restored.retiringSources.find(s => s.pendingTranscriptLines.length)
  const retainedCorrupt = restored.retiringSources.find(s => s.sourceEpoch === 'wrong-epoch')
  assert.equal(retainedPending.pendingTranscriptLines[0].id, 'genuinely-unsaved')
  assert.equal(retainedPending.transcriptId, deletedId); assert.equal(retainedPending.saveState.status, 'error')
  await assert.rejects(restarted.retrySessionTranscript(retainedPending), /课节绑定无法核验/)
  await assert.rejects(restarted.retrySessionTranscript(retainedCorrupt), /课节绑定无法核验/)
  assert.equal(await restarted.getTranscriptRecord(deletedId), null)
  assert.equal(await restarted.getTranscriptRecord(oldId), null)
  assert.equal(env.local[mod.FAVORITES_KEY].some(f => f.ref.recordId === deletedId || f.ref.recordId === oldId), false)
  await restarted.persistSessionsStrict()
  const stored = JSON.parse(env.snapshot[mod.SESSION_RECOVERY_KEY])
  assert.ok(stored['42'] && stored['44'], 'reconciliation snapshots must preserve unvisited unrelated owners')
  console.log('course-lifecycle F1: scoped current/retired cleanup preserves active/unrelated/pending/corrupt owners passed')
}
async function oldEpochTail(failOld = false) {
  const env = environment(), mod = await fresh(), old = await bound(mod)
  const current = await mod.transitionSource(41, { url: 'https://youtu.be/secondLesson', title: 'Second' })
  const oldId = old.transcriptId, currentId = current.transcriptId, generation = old.generation
  mod.registerOffscreenEventRouter()
  const held = Promise.withResolvers(), release = Promise.withResolvers(), stopHeld = Promise.withResolvers(), releaseStop = Promise.withResolvers()
  env.controls.beforeLocalSet = async () => { env.controls.beforeLocalSet = null; held.resolve(); await release.promise }
  env.controls.stop = async () => { stopHeld.resolve(); await releaseStop.promise; return { ok: true } }
  mod.saveSessionSubtitle(current, line(current, 'current-0')); await held.promise
  for (let i = 1; i < 180; i++) mod.saveSessionSubtitle(current, line(current, `current-${i}`))
  await stopHeld.promise
  assert.equal(current.state, 'stopping')
  // Explicit STOP and a teardown finalizer share the ongoing automatic STOP;
  // neither may complete before the real offscreen tail acknowledgement.
  let finished = false
  const finish = mod.finishSessionTranscript(current).then(() => { finished = true })
  const explicit = new Promise(resolve => mod.sessionHandlers.STOP({}, { tabId: 41, sendResponse: resolve }))
  await env.event({ type: 'CAPTURE_SUBTITLE', tabId: 41, generation, sourceEpoch: old.sourceEpoch, at: 100, source: 'old audio tail', target: 'old audio tail' })
  await env.event({ type: 'CAPTURE_SCREEN_SUBTITLE', tabId: 41, generation, sourceEpoch: old.sourceEpoch, at: 101, source: 'old screen tail', target: 'old screen tail' })
  if (failOld) env.controls.beforeLocalSet = async items => {
    if (Object.keys(items).some(key => key.startsWith(mod.TRANSCRIPT_CHUNK_PREFIX + oldId))) throw new Error('old tail quota')
  }
  release.resolve()
  await mod.flushTranscript(currentId)
  assert.equal(finished, false)
  releaseStop.resolve()
  const finishing = Promise.all([finish, explicit, mod.retrySessionTranscript(current)])
  if (failOld) {
    await assert.rejects(finishing, /old tail quota/)
    assert.equal(mod.safeSession(current).saveState.status, 'error')
    assert.equal(old.pendingTranscriptLines.length, 2)
    env.controls.beforeLocalSet = null
    await mod.retrySessionTranscript(current)
  } else await finishing
  assert.equal(current.state, 'idle'); assert.equal(current.pendingTranscriptLines.length, 0)
  assert.equal((await mod.readTranscript(currentId)).length, 180)
  assert.deepEqual((await mod.readTranscript(oldId)).map(l => l.source), ['old audio tail', 'old screen tail'])
  assert.equal((await mod.getTranscriptRecord(oldId)).status, 'completed')
  assert.equal((await mod.getTranscriptRecord(currentId)).status, 'completed')
  assert.equal(mod.safeSession(current).saveState.status, 'saved')
  assert.equal(env.sent.filter(m => m.type === 'STOP_CAPTURE').length, 1)
  await mod.persistSessionsStrict()
  console.log(`course-lifecycle F2: actual old-epoch audio/screen tail + concurrent STOP/finalizer ${failOld ? 'failure/retry' : 'drain'} passed`)
}
async function supersededStop(sameOwner = false, rejectStop = false) {
  const env = environment(), mod = await fresh(), owner = await bound(mod)
  const held = Promise.withResolvers(), release = Promise.withResolvers()
  env.controls.stop = async () => { held.resolve(); await release.promise; if (rejectStop) throw new Error('obsolete stop'); return { ok: true } }
  const stop = mod.stopSessionCapture(owner)
  await held.promise
  const replacement = sameOwner ? owner : mod.createSession(41)
  replacement.generation = 999; replacement.state = 'running'
  replacement.saveState = { status: 'pending' }; replacement.transcriptId = 'replacement-owned-record'
  const before = structuredClone(replacement)
  release.resolve(); await stop
  assert.deepEqual(replacement, before, 'obsolete STOP must not clear or publish a newer owner/generation')
  await mod.persistSessionsStrict()
  console.log(`course-lifecycle F2: superseded ${sameOwner ? 'generation' : 'owner'} / ${rejectStop ? 'rejected' : 'successful'} STOP fenced passed`)
}
async function supersededFinalize() {
  const env = environment(), mod = await fresh(), owner = await bound(mod)
  const id = owner.transcriptId
  mod.saveSessionSubtitle(owner, line(owner, 'saved-before-stop'))
  await mod.retrySessionTranscript(owner)
  const held = Promise.withResolvers(), release = Promise.withResolvers()
  env.controls.beforeLocalSet = async items => {
    if (!items[mod.TRANSCRIPT_INDEX_KEY]?.some(record => record.id === id && record.status === 'completed')) return
    env.controls.beforeLocalSet = null; held.resolve(); await release.promise
  }
  const stop = mod.stopSessionCapture(owner); await held.promise
  owner.generation = 999; owner.state = 'running'; owner.transcriptId = 'new-record'
  owner.saveState = { status: 'pending' }
  const before = structuredClone(owner)
  release.resolve(); await stop
  assert.deepEqual(owner, before, 'late old finalization must not mark a superseding generation saved')
  assert.equal((await mod.getTranscriptRecord(id)).status, 'completed')
  await mod.persistSessionsStrict()
  console.log('course-lifecycle F2: supersession during final index write preserves newer owner passed')
}
async function unacknowledgedStop() {
  const env = environment(), mod = await fresh(), owner = await bound(mod)
  mod.saveSessionSubtitle(owner, line(owner, 'before-nack')); await mod.retrySessionTranscript(owner)
  env.controls.stop = async () => ({ ok: false, error: 'capture still active' })
  await assert.rejects(mod.stopSessionCapture(owner), /capture still active/)
  assert.equal(owner.state, 'error'); assert.equal(owner.saveState.status, 'error')
  assert.equal((await mod.getTranscriptRecord(owner.transcriptId)).status, 'recording')
  env.controls.stop = null
  await mod.retrySessionTranscript(owner)
  assert.equal(owner.state, 'idle'); assert.equal(owner.saveState.status, 'saved')
  assert.equal((await mod.getTranscriptRecord(owner.transcriptId)).status, 'completed')
  await mod.persistSessionsStrict()
  console.log('course-lifecycle F2: unacknowledged STOP remains visible and retries actual capture teardown passed')
}
function survivingCapture(owner, generation) {
  return { ok: true, sessions: { [owner.tabId]: generation }, sources: {
    [owner.tabId]: { sourceEpoch: owner.sourceEpoch, bindings: {
      [owner.sourceEpoch]: { sourceRef: owner.sourceRef, pending: 0 },
    } },
  } }
}
async function liveStopRetry(restart = false, missingLiveRead = false) {
  let env = environment(), mod = await fresh(), owner = await bound(mod)
  const id = owner.transcriptId, epoch = owner.sourceEpoch, generation = owner.generation
  owner.subtitles.push(line(owner, 'before-live-stop'))
  mod.saveSessionSubtitle(owner, owner.subtitles[0]); await mod.retrySessionTranscript(owner)
  env.controls.liveCapture = survivingCapture(owner, generation)
  if (restart) {
    const held = Promise.withResolvers(), release = Promise.withResolvers()
    env.controls.stop = async () => { held.resolve(); await release.promise; return { ok: false, error: 'capture still active' } }
    const stopped = mod.stopSessionCapture(owner).catch(error => error)
    await held.promise; await mod.persistSessionsStrict()
    const crashed = { local: structuredClone(env.local), snapshot: structuredClone(env.snapshot) }
    release.resolve(); await stopped; await mod.persistSessionsStrict()
    const live = survivingCapture(owner, generation)
    env = environment(crashed); env.controls.liveCapture = missingLiveRead ? null : live
    mod = await fresh(); await mod.recoverSessions(); owner = mod.sessions.get(41)
    assert.equal((await mod.getTranscriptRecord(id)).status, 'recording', 'pending teardown must survive an unavailable live capture read')
    env.controls.liveCapture = live
  } else {
    env.controls.stop = async () => ({ ok: false, error: 'capture still active' })
    await assert.rejects(mod.stopSessionCapture(owner), /capture still active/)
  }
  env.controls.stop = async () => ({ ok: false, error: 'capture still active' })
  // The real GET_SESSION dependency is allowed to restore presentation state.
  await mod.reconcileSessionState(41)
  assert.equal(owner.state, 'running'); assert.equal(owner.generation, generation)
  assert.equal(owner.transcriptFinalizationPending, true)
  assert.equal((await mod.getTranscriptRecord(id)).status, 'recording')
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(mod.retrySessionTranscript(owner), /capture still active/, 'N1: retry must retry unacknowledged teardown after live reconciliation')
    assert.equal((await mod.getTranscriptRecord(id)).status, 'recording', 'a surviving capture must never be finalized')
    assert.equal(owner.saveState.status, 'error')
    assert.equal(owner.transcriptId, id); assert.equal(owner.sourceEpoch, epoch)
    await mod.reconcileSessionState(41)
  }
  await assert.rejects(mod.finishSessionTranscript(owner), /capture still active/, 'public finalization must also wait for teardown proof')
  assert.equal((await mod.getTranscriptRecord(id)).status, 'recording')
  const beforeAck = env.sent.filter(m => m.type === 'STOP_CAPTURE').length
  env.controls.stop = async () => { env.controls.liveCapture = { ok: true, sessions: {}, sources: {} }; return { ok: true } }
  await mod.retrySessionTranscript(owner)
  assert.equal(env.sent.filter(m => m.type === 'STOP_CAPTURE').length, beforeAck + 1)
  assert.equal(env.sent.filter(m => m.type === 'STOP_CAPTURE').every(m => m.generation === generation), true)
  assert.equal(owner.state, 'idle'); assert.equal(owner.saveState.status, 'saved')
  assert.equal(owner.transcriptId, id); assert.equal(owner.sourceEpoch, epoch)
  assert.equal(owner.transcriptFinalizationPending, false)
  assert.equal((await mod.getTranscriptRecord(id)).status, 'completed')
  assert.deepEqual((await mod.readTranscript(id)).map(row => row.id), ['before-live-stop'])
  await mod.persistSessionsStrict()
  console.log(`course-lifecycle N1: ${restart ? 'interrupted STOP/fresh worker/' + (missingLiveRead ? 'missing live read' : 'live capture') : 'negative STOP/live GET_SESSION reconciliation'}/repeated NACK/eventual ACK passed`)
}
async function storageFinalizeRestart() {
  let env = environment(), mod = await fresh(), owner = await bound(mod)
  const id = owner.transcriptId, epoch = owner.sourceEpoch
  owner.subtitles.push(line(owner, 'storage-only'))
  mod.saveSessionSubtitle(owner, owner.subtitles[0]); await mod.retrySessionTranscript(owner)
  const failFinalization = async items => {
    if (items[mod.TRANSCRIPT_INDEX_KEY]?.some(r => r.id === id && r.status === 'completed')) throw new Error('finalization-only quota')
  }
  env.controls.beforeLocalSet = failFinalization
  await assert.rejects(mod.stopSessionCapture(owner), /finalization-only quota/)
  assert.equal(owner.pendingCaptureStopGeneration, undefined, 'acknowledged STOP must leave only storage work pending')
  await mod.persistSessionsStrict()
  env = environment({ local: env.local, snapshot: env.snapshot }); env.controls.beforeLocalSet = failFinalization
  mod = await fresh(); await mod.recoverSessions(); owner = mod.sessions.get(41)
  assert.equal(owner.pendingCaptureStopGeneration, undefined)
  assert.equal(owner.transcriptFinalizationPending, true)
  env.controls.beforeLocalSet = null
  await mod.retrySessionTranscript(owner)
  assert.equal(env.sent.filter(m => m.type === 'STOP_CAPTURE' || m.type === 'START_CAPTURE').length, 0)
  assert.equal(owner.transcriptId, id); assert.equal(owner.sourceEpoch, epoch)
  assert.equal(owner.saveState.status, 'saved')
  assert.equal((await mod.getTranscriptRecord(id)).status, 'completed')
  await mod.persistSessionsStrict()
  console.log('course-lifecycle N1: confirmed STOP/storage-only fault/fresh worker/retry without capture changes passed')
}
try {
  await build({ stdin: { resolveDir: process.cwd(), contents: ['session-store', 'transcript-store', 'source-sessions', 'recovery', 'library-store', 'router/session', 'router/offscreen-events'].map(p => `export * from '${resolve(`src/ext/background/${p}.ts`)}';`).join('\n') }, bundle: true, format: 'esm', outfile: out, logLevel: 'silent', define: { 'import.meta.env': '{}' } })
  if (!process.argv[2] || process.argv[2] === 'n1-live') await liveStopRetry()
  if (!process.argv[2] || process.argv[2] === 'n1-restart') { await liveStopRetry(true); await liveStopRetry(true, true); await storageFinalizeRestart() }
  if (!process.argv[2] || process.argv[2] === 'deletion') { await deletion(); await deletionRetryAndCrash(); await deletionScope() }
  if (!process.argv[2] || process.argv[2] === 'stop') {
    await automaticStop(); await automaticStop(true); await oldEpochTail(); await oldEpochTail(true)
    await supersededFinalize(); await unacknowledgedStop()
    for (const sameOwner of [false, true]) for (const rejected of [false, true]) await supersededStop(sameOwner, rejected)
  }
} finally { rmSync(dir, { recursive: true, force: true }) }

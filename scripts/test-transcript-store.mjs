/**
 * Tests for the durable transcript store (ADR-031).
 *
 * Covers chunk rollover without truncation, summary reads that omit bodies,
 * finalization, empty-session deletion, recording protection, legacy
 * migration, crash recovery, index repair, and the completed-record cap.
 *
 *   node scripts/test-transcript-store.mjs
 */
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-transcript-'))
const out = join(outDir, 'transcript-store.mjs')

execSync(
  `npx esbuild src/ext/background/transcript-store.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
)

/* In-memory chrome.storage.local. Values are cloned like the real API. */
const store = {}
let fail = null
function inject(method, key) { fail = { method, key } }
function fault(method, keys) {
  if (fail?.method === method && (!fail.key || keys.includes(fail.key))) {
    fail = null
    throw new Error('injected storage failure')
  }
}
const clone = (value) => (value === undefined ? undefined : structuredClone(value))

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys]
        fault('get', list)
        const result = {}
        for (const key of list) {
          if (typeof key === 'string' && key in store) result[key] = clone(store[key])
        }
        return result
      },
      async set(items) {
        fault('set', Object.keys(items))
        for (const [key, value] of Object.entries(items)) store[key] = clone(value)
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys]
        fault('remove', list)
        for (const key of list) delete store[key]
      },
    },
  },
}

let importCounter = 0
/** A new module instance simulates a service-worker restart; storage persists. */
async function loadModule() {
  importCounter += 1
  return import(`${pathToFileURL(out).href}?v=${importCounter}`)
}

async function freshStore() {
  for (const key of Object.keys(store)) delete store[key]
  return loadModule()
}

let passed = 0
const failures = []
function check(name, actual, expected) {
  const got = JSON.stringify(actual)
  const want = JSON.stringify(expected)
  if (got === want) passed += 1
  else failures.push(`${name}: got ${got}, want ${want}`)
}

function line(index, tag = '') {
  return {
    at: index,
    endedAt: null,
    source: `s${tag}${index}`,
    target: `t${tag}${index}`,
    latency: 1,
  }
}

/* ---------- 1. Chunked append never truncates ---------- */

{
  const mod = await freshStore()
  const record = await mod.beginTranscript({
    tabId: 1,
    generation: 1,
    pageTitle: 'Video A',
    url: 'https://example.test/a',
    sourceLang: 'en',
    targetLang: 'zh',
  })
  check('begin returns a recording record', record.status, 'recording')

  for (let i = 0; i < 450; i += 1) {
    await mod.appendTranscriptLine(record.id, line(i))
  }

  const rows = await mod.readTranscript(record.id)
  check('all 450 rows survive', rows.length, 450)
  check('first row intact', rows[0].source, 's0')
  check('last row intact', rows[449].target, 't449')

  const chunkKeys = Object.keys(store).filter((key) => key.startsWith(mod.TRANSCRIPT_CHUNK_PREFIX))
  check('450 rows span three chunks', chunkKeys.length, 3)
  check(
    'each chunk is bounded',
    chunkKeys.every((key) => store[key].length <= mod.TRANSCRIPT_CHUNK_SIZE),
    true,
  )

  const summaries = await mod.listTranscripts()
  check('summary omits subtitle bodies', 'subtitles' in summaries[0], false)
  check('summary counts every row', summaries[0].subtitleCount, 450)
  check('summary keeps page title', summaries[0].pageTitle, 'Video A')
}

/* ---------- 2. Empty sessions are deleted ---------- */

{
  const mod = await freshStore()
  const record = await mod.beginTranscript({ tabId: 2, generation: 2 })
  check('empty transcript is not kept', await mod.finalizeTranscript(record.id), false)
  check('empty transcript leaves no history', (await mod.listTranscripts()).length, 0)
}

/* ---------- 3. Finalization keeps the body ---------- */

{
  const mod = await freshStore()
  const record = await mod.beginTranscript({ tabId: 3, generation: 3 })
  for (let i = 0; i < 3; i += 1) {
    await mod.appendTranscriptLine(record.id, line(i))
  }

  check('non-empty transcript is kept', await mod.finalizeTranscript(record.id), true)
  const summary = (await mod.listTranscripts())[0]
  check('finalized status', summary.status, 'completed')
  check('finalized has endedAt', typeof summary.endedAt === 'number' && summary.endedAt > 0, true)
  check('finalized body readable', (await mod.readTranscript(record.id)).length, 3)
  check('finalize is idempotent', await mod.finalizeTranscript(record.id), true)
}

/* ---------- 3b. Video anchors survive the chunk round trip (ADR-033) ---------- */

{
  const mod = await freshStore()
  const record = await mod.beginTranscript({ tabId: 33, generation: 33 })
  await mod.appendTranscriptLine(record.id, { ...line(1), videoTime: 95.25 })
  await mod.appendTranscriptLine(record.id, line(2))
  await mod.finalizeTranscript(record.id)

  const rows = await mod.readTranscript(record.id)
  check('video anchor kept', rows[0].videoTime, 95.25)
  check('unanchored row normalizes to null', rows[1].videoTime, null)
}

/* ---------- 4. Recording records are protected from deletion ---------- */

{
  const mod = await freshStore()
  const live = await mod.beginTranscript({ tabId: 4, generation: 4 })
  await mod.appendTranscriptLine(live.id, line(1))

  const done = await mod.beginTranscript({ tabId: 5, generation: 5 })
  await mod.appendTranscriptLine(done.id, line(2))
  await mod.finalizeTranscript(done.id)

  check(
    'delete removes completed and skips recording',
    await mod.deleteTranscripts([live.id, done.id]),
    { deleted: 1, skipped: 1 },
  )
  check('completed chunks removed', (await mod.readTranscript(done.id)).length, 0)
  check('recording body survives', (await mod.readTranscript(live.id)).length, 1)

  check('clear all skips recording', await mod.clearTranscripts(), { deleted: 0, skipped: 1 })
  check('recording still listed', (await mod.listTranscripts()).length, 1)
}

/* ---------- 5. Legacy history migration ---------- */

{
  const mod = await freshStore()
  store[mod.LEGACY_HISTORY_KEY] = [{
    id: 'legacy-1',
    pageTitle: 'Legacy',
    url: 'https://old.test',
    startedAt: 1000,
    endedAt: 2000,
    sourceLang: 'ja',
    targetLang: 'zh',
    subtitleCount: 2,
    subtitles: [line(1), line(2)],
  }]

  const summaries = await mod.listTranscripts()
  check('legacy record migrated', summaries.length, 1)
  check('legacy key removed after write', mod.LEGACY_HISTORY_KEY in store, false)
  check('legacy body migrated', (await mod.readTranscript('legacy-1')).length, 2)
  check('legacy record is completed', summaries[0].status, 'completed')
}

/* ---------- 6. Recovery finalizes orphans and reattaches live records ---------- */

{
  const mod = await freshStore()
  const orphan = await mod.beginTranscript({ tabId: 6, generation: 6 })
  await mod.appendTranscriptLine(orphan.id, line(1))
  await mod.appendTranscriptLine(orphan.id, line(2))

  const liveRecord = await mod.beginTranscript({ tabId: 7, generation: 7 })
  await mod.appendTranscriptLine(liveRecord.id, line(3))

  const restarted = await loadModule()
  const live = await restarted.recoverTranscripts({ 7: 7 })
  check('live transcript is reattached', live.get(7), liveRecord.id)
  check('orphan is not reported live', live.has(6), false)

  const summaries = await restarted.listTranscripts()
  const orphanSummary = summaries.find((item) => item.id === orphan.id)
  check('orphan finalized', orphanSummary.status, 'completed')
  check('orphan prefix kept', orphanSummary.subtitleCount, 2)
  check(
    'live record stays recording',
    summaries.find((item) => item.id === liveRecord.id).status,
    'recording',
  )

  await restarted.appendTranscriptLine(liveRecord.id, line(4))
  check('appends resume after recovery', (await restarted.readTranscript(liveRecord.id)).length, 2)
}

/* ---------- 7. Index repair after a crash between chunk and index writes ---------- */

{
  const mod = await freshStore()
  const record = await mod.beginTranscript({ tabId: 8, generation: 8 })
  await mod.appendTranscriptLine(record.id, line(1))

  const chunkKey = `${mod.TRANSCRIPT_CHUNK_PREFIX}${record.id}.0`
  store[chunkKey] = [...store[chunkKey], line(2)]
  store[mod.TRANSCRIPT_INDEX_KEY][0].subtitleCount = 1

  const restarted = await loadModule()
  await restarted.recoverTranscripts({})
  const summary = (await restarted.listTranscripts()).find((item) => item.id === record.id)
  check('repair counts the extra chunk row', summary.subtitleCount, 2)
  check('repair keeps the extra row', (await restarted.readTranscript(record.id)).length, 2)
}

/* ---------- 8. Begin idempotency and stale-record finalization ---------- */

{
  const mod = await freshStore()
  const first = await mod.beginTranscript({ tabId: 9, generation: 9 })
  const same = await mod.beginTranscript({ tabId: 9, generation: 9 })
  check('begin is idempotent for one generation', same.id, first.id)

  await mod.appendTranscriptLine(first.id, line(1))
  const next = await mod.beginTranscript({ tabId: 9, generation: 10 })
  check('a new generation gets a new record', next.id !== first.id, true)
  check(
    'the stale recording is finalized',
    (await mod.listTranscripts()).find((item) => item.id === first.id).status,
    'completed',
  )
}

/* ---------- 9. Lazy ensureTranscript ---------- */

{
  const mod = await freshStore()
  const session = {
    tabId: 10,
    generation: 10,
    transcriptId: null,
    sourceLang: 'en',
    targetLang: 'zh',
  }
  const id = await mod.ensureTranscript(session, { pageTitle: 'Ensure' })
  check('ensure creates a record', typeof id, 'string')
  check('ensure attaches the id', session.transcriptId, id)
  check('ensure reuses the attached id', await mod.ensureTranscript(session), id)

  await mod.appendTranscriptLine(id, line(1))
  await mod.finalizeTranscript(id)
  check('ensure keeps metadata', (await mod.listTranscripts())[0].pageTitle, 'Ensure')
}

/* ---------- 10. Retention caps completed records only ---------- */

{
  const mod = await freshStore()
  const live = await mod.beginTranscript({ tabId: 900, generation: 1 })
  await mod.appendTranscriptLine(live.id, line(0))

  const ids = []
  for (let i = 0; i < 150; i += 1) {
    const record = await mod.beginTranscript({ tabId: 1000 + i, generation: 100 + i })
    await mod.appendTranscriptLine(record.id, line(i))
    await mod.finalizeTranscript(record.id)
    ids.push(record.id)
  }

  const summaries = await mod.listTranscripts()
  const completed = summaries.filter((item) => item.status === 'completed')
  check('150 completed records retained', completed.length, 150)
  check('oldest completed record retained', summaries.some((item) => item.id === ids[0]), true)
  check('recording record never evicted', summaries.some((item) => item.id === live.id), true)
  check(
    'oldest body retained',
    Object.keys(store).some((key) => key.startsWith(`${mod.TRANSCRIPT_CHUNK_PREFIX}${ids[0]}.`)),
    true,
  )
}

/* ---------- 11. Tab lookups ---------- */

{
  const mod = await freshStore()
  const record = await mod.beginTranscript({ tabId: 11, generation: 11 })
  await mod.appendTranscriptLine(record.id, line(1))
  check('latest id for tab', await mod.findLatestTranscriptIdForTab(11), record.id)
  check('read for tab', (await mod.readTranscriptForTab(11)).length, 1)
  check('unknown tab is empty', (await mod.readTranscriptForTab(999)).length, 0)
}

/* ---------- 12. Finalization waits for in-flight appends ---------- */

{
  const mod = await freshStore()
  const record = await mod.beginTranscript({ tabId: 12, generation: 12 })
  await mod.appendTranscriptLine(record.id, line(1))
  // A tail line from the STOP drain: the append is still queued when the
  // background finalizes the record.
  const tail = mod.appendTranscriptLine(record.id, line(2))
  const finalized = await mod.finalizeTranscript(record.id)
  await tail

  check('finalize after a queued append keeps the record', finalized, true)
  check('tail line survives finalization', (await mod.readTranscript(record.id)).length, 2)
  const summary = (await mod.listTranscripts()).find((item) => item.id === record.id)
  check('tail line is counted in the summary', summary.subtitleCount, 2)
  check('tail line cannot reopen a finalized record', await mod.finalizeTranscript(record.id), true)
}

/* ---------- 13. An unterminated append after finalize is dropped ---------- */

{
  const mod = await freshStore()
  const record = await mod.beginTranscript({ tabId: 13, generation: 13 })
  await mod.appendTranscriptLine(record.id, line(1))
  await mod.finalizeTranscript(record.id)
  // Late append for an already closed record must not resurrect it.
  await mod.appendTranscriptLine(record.id, line(2))
  check('completed record ignores late appends', (await mod.readTranscript(record.id)).length, 1)
  check(
    'completed record stays completed',
    (await mod.listTranscripts()).find((item) => item.id === record.id).status,
    'completed',
  )
}


/* ---------- Legacy/recovery retention preserves 150 complete bodies ---------- */
{
  const mod = await freshStore()
  store[mod.LEGACY_HISTORY_KEY] = Array.from({ length: 150 }, (_, i) => ({ id: `legacy-${i}`, startedAt: i + 1, subtitles: [line(0, `first-${i}-`), line(500, `last-${i}-`)] }))
  assert.equal((await mod.listTranscripts()).length, 150)
  const newRecord = await mod.beginTranscript({ tabId: 5000, generation: 1 })
  await mod.appendTranscriptLine(newRecord.id, line(1))
  const restarted = await loadModule()
  await restarted.recoverTranscripts()
  assert.equal((await restarted.listTranscripts()).length, 151)
  assert.equal((await restarted.readTranscript('legacy-0'))[0].source, 'sfirst-0-0')
  assert.equal((await restarted.readTranscript('legacy-149'))[1].target, 'tlast-149-500')
  passed += 4
}

/* ---------- Storage failures are observable and retryable ---------- */
{
  const mod = await freshStore()
  inject('set', mod.TRANSCRIPT_INDEX_KEY)
  await assert.rejects(mod.beginTranscript({ tabId: 77, generation: 1 }), /injected/)
  const record = await mod.beginTranscript({ tabId: 77, generation: 1 })
  for (let i = 0; i < 199; i++) await mod.appendTranscriptLine(record.id, { ...line(i), id: `e${i}` })
  inject('set', `${mod.TRANSCRIPT_CHUNK_PREFIX}${record.id}.0`)
  await assert.rejects(mod.appendTranscriptLine(record.id, { ...line(199), id: 'e199' }), /injected/)
  assert.equal(store[mod.TRANSCRIPT_INDEX_KEY][0].subtitleCount, 199)
  await mod.appendTranscriptLine(record.id, { ...line(199), id: 'e199' })
  inject('set', mod.TRANSCRIPT_INDEX_KEY)
  await assert.rejects(mod.appendTranscriptLine(record.id, { ...line(200), id: 'e200' }), /injected/)
  await mod.appendTranscriptLine(record.id, { ...line(200), id: 'e200' })
  assert.equal((await mod.readTranscript(record.id)).length, 201)
  inject('set', mod.TRANSCRIPT_INDEX_KEY)
  await assert.rejects(mod.finalizeTranscript(record.id), /injected/)
  assert.equal((await mod.getTranscriptRecord(record.id)).status, 'recording')
  await mod.finalizeTranscript(record.id)
  const page = await mod.readTranscriptPage(record.id, 1)
  assert.equal(page.lines.length, 1)
  assert.equal(page.lines[0].id, 'e200')
  assert.equal(page.nextChunkIndex, null)
  delete store[`${mod.TRANSCRIPT_CHUNK_PREFIX}${record.id}.0`]
  await assert.rejects(mod.readTranscript(record.id), /缺|missing/i)
  inject('remove')
  await assert.rejects(mod.deleteTranscripts([record.id]), /injected/)
  await mod.deleteTranscripts([record.id])
  assert.equal((await mod.listTranscripts()).length, 0)
  passed += 10
}
{
  const mod = await freshStore()
  store[mod.LEGACY_HISTORY_KEY] = [{ id: 'legacy-failure', startedAt: 1, subtitles: [line(2), { ...line(1), kind: 'screen' }] }]
  inject('set', mod.TRANSCRIPT_INDEX_KEY)
  await assert.rejects(mod.listTranscripts(), /injected/)
  assert.ok(store[mod.LEGACY_HISTORY_KEY])
  const rows = await mod.readTranscript('legacy-failure')
  assert.equal(rows[0].kind, 'screen')
  assert.equal(rows[0].id, 'legacy-failure:0:1')
  assert.equal(rows[1].id, 'legacy-failure:0:0')
  assert.equal(store[mod.LEGACY_HISTORY_KEY], undefined)
  passed += 6
}

rmSync(outDir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n❌ transcript-store: ${failures.length} failed, ${passed} passed`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`✅ transcript-store: ${passed} checks passed`)

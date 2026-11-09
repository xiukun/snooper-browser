/**
 * Full-session transcript store (ADR-031).
 *
 * A transcript is append-only and chunked: the index holds one summary per
 * recording, and each chunk holds up to CHUNK_SIZE final subtitle lines.
 * Every final subtitle flushes its current chunk, so a service-worker restart
 * or browser crash cannot lose the body of a long session.
 *
 * The live `SessionState.subtitles` array is only a display window. This
 * module is the single source of truth for history, copy, and export.
 */

export const TRANSCRIPT_INDEX_KEY = 'snooper.extension.transcripts.v1'
export const TRANSCRIPT_CHUNK_PREFIX = 'snooper.extension.transcript.v1.'
export const LEGACY_HISTORY_KEY = 'snooper.extension.history.v1'

/** Rows per storage chunk. Also the maximum size of a single chunk write. */
export const TRANSCRIPT_CHUNK_SIZE = 200
/** Completed transcripts kept in history. Recording transcripts are never evicted. */
export const MAX_COMPLETED_TRANSCRIPTS = 100

export type TranscriptStatus = 'recording' | 'completed'

export interface TranscriptLine {
  id?: string
  at: number
  endedAt: number | null
  /** Video-timeline position (seconds) for `at` (ADR-033). */
  videoTime?: number | null
  source: string
  target: string
  latency: number
}

export interface TranscriptRecord {
  id: string
  tabId: number
  generation: number
  pageTitle: string
  url: string
  startedAt: number
  endedAt: number | null
  sourceLang: string
  targetLang: string
  subtitleCount: number
  chunkCount: number
  status: TranscriptStatus
  lastAt: number
}

/** The shape returned by GET_HISTORY; never includes subtitle bodies. */
export interface TranscriptSummary {
  id: string
  pageTitle: string
  url: string
  startedAt: number
  endedAt: number | null
  sourceLang: string
  targetLang: string
  subtitleCount: number
  status: TranscriptStatus
  lastAt: number
}

export interface BeginTranscriptInput {
  tabId: number
  generation: number
  pageTitle?: string
  url?: string
  sourceLang?: string
  targetLang?: string
  startedAt?: number
}

/** Minimal session shape needed by the lifecycle helpers. */
export interface TranscriptSessionLike {
  tabId: number
  generation: number
  transcriptId: string | null
  sourceLang: string
  targetLang: string
}

export interface TranscriptMeta {
  pageTitle?: string
  url?: string
  sourceLang?: string
  targetLang?: string
  startedAt?: number
}

interface ActiveTranscript {
  record: TranscriptRecord
  chunkIndex: number
  lines: TranscriptLine[]
  writing: boolean
  pending: boolean
  writePromise: Promise<void> | null
}

const active = new Map<string, ActiveTranscript>()
const appendQueues = new Map<string, Promise<void>>()
const beginAttempts = new Map<string, Promise<TranscriptRecord>>()

let indexCache: TranscriptRecord[] | null = null
let indexLoad: Promise<TranscriptRecord[]> | null = null
let indexWrite: Promise<void> = Promise.resolve()

/* ===== Normalization ===== */

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeLine(raw: any): TranscriptLine | null {
  if (!raw || typeof raw !== 'object') return null
  const source = typeof raw.source === 'string' ? raw.source : ''
  const target = typeof raw.target === 'string' ? raw.target : ''
  if (!source && !target) return null
  const videoTime = typeof raw.videoTime === 'number' && Number.isFinite(raw.videoTime) && raw.videoTime >= 0
    ? raw.videoTime
    : null
  return {
    ...(typeof raw.id === 'string' && raw.id ? { id: raw.id } : {}),
    at: toNumber(raw.at),
    endedAt: raw.endedAt == null ? null : toNumber(raw.endedAt),
    videoTime,
    source,
    target,
    latency: toNumber(raw.latency),
  }
}

function normalizeRecord(raw: any): TranscriptRecord | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null
  const startedAt = toNumber(raw.startedAt, Date.now())
  const status: TranscriptStatus = raw.status === 'recording' ? 'recording' : 'completed'
  return {
    id: raw.id,
    tabId: toNumber(raw.tabId, -1),
    generation: toNumber(raw.generation, 0),
    pageTitle: typeof raw.pageTitle === 'string' ? raw.pageTitle.slice(0, 300) : '',
    url: typeof raw.url === 'string' ? raw.url.slice(0, 2048) : '',
    startedAt,
    endedAt: raw.endedAt == null ? null : toNumber(raw.endedAt),
    sourceLang: typeof raw.sourceLang === 'string' ? raw.sourceLang : 'auto',
    targetLang: typeof raw.targetLang === 'string' ? raw.targetLang : 'zh',
    subtitleCount: Math.max(0, Math.floor(toNumber(raw.subtitleCount))),
    chunkCount: Math.max(0, Math.floor(toNumber(raw.chunkCount))),
    status,
    lastAt: toNumber(raw.lastAt, startedAt),
  }
}

function normalizeIndex(raw: any): TranscriptRecord[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const records: TranscriptRecord[] = []
  for (const item of raw) {
    const record = normalizeRecord(item)
    if (!record || seen.has(record.id)) continue
    seen.add(record.id)
    records.push(record)
  }
  return records.sort((a, b) => b.startedAt - a.startedAt)
}

function toSummary(record: TranscriptRecord): TranscriptSummary {
  return {
    id: record.id,
    pageTitle: record.pageTitle,
    url: record.url,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    sourceLang: record.sourceLang,
    targetLang: record.targetLang,
    subtitleCount: record.subtitleCount,
    status: record.status,
    lastAt: record.lastAt,
  }
}

/* ===== Storage keys ===== */

function chunkKey(id: string, chunkIndex: number): string {
  return `${TRANSCRIPT_CHUNK_PREFIX}${id}.${chunkIndex}`
}

function chunkKeys(record: TranscriptRecord): string[] {
  const count = Math.max(record.chunkCount, Math.ceil(record.subtitleCount / TRANSCRIPT_CHUNK_SIZE))
  return Array.from({ length: count }, (_, index) => chunkKey(record.id, index))
}

/* ===== Index persistence ===== */

async function loadIndexFromStorage(): Promise<TranscriptRecord[]> {
  const got = await chrome.storage.local.get([TRANSCRIPT_INDEX_KEY, LEGACY_HISTORY_KEY])
  let records = normalizeIndex(got[TRANSCRIPT_INDEX_KEY])
  const legacy = got[LEGACY_HISTORY_KEY]

  if (Array.isArray(legacy) && legacy.length > 0) {
    const existing = new Set(records.map((record) => record.id))
    const migrated = await migrateLegacy(legacy, existing)
    if (migrated.length > 0) {
      records = [...migrated, ...records].sort((a, b) => b.startedAt - a.startedAt)
      await writeIndexNow(records)
    }
    // The legacy key is only removed after the new index is safely written.
    await chrome.storage.local.remove(LEGACY_HISTORY_KEY)
  }

  indexCache = records
  return records
}

async function getIndex(): Promise<TranscriptRecord[]> {
  if (indexCache) return indexCache
  if (!indexLoad) {
    indexLoad = loadIndexFromStorage().finally(() => {
      indexLoad = null
    })
  }
  return indexLoad
}

/**
 * Serialize index writes. Chunk writes can overlap; index snapshots must not
 * land out of order or an older summary would overwrite a newer count.
 */
function writeIndexNow(records: TranscriptRecord[]): Promise<void> {
  const snapshot = records.map((record) => ({ ...record }))
  indexWrite = indexWrite
    .then(() => chrome.storage.local.set({ [TRANSCRIPT_INDEX_KEY]: snapshot }))
    .catch((err) => {
      console.warn('[RTTS] transcript index write failed:', err)
    })
  return indexWrite
}

async function persistRecord(record: TranscriptRecord): Promise<void> {
  const records = await getIndex()
  if (!records.includes(record)) return
  await writeIndexNow(records)
}

async function removeChunks(records: TranscriptRecord[]): Promise<void> {
  const keys = records.flatMap(chunkKeys)
  if (keys.length === 0) return
  try {
    await chrome.storage.local.remove(keys)
  } catch (err) {
    console.warn('[RTTS] transcript chunk removal failed:', err)
  }
}

/* ===== Legacy migration ===== */

async function migrateLegacy(
  legacy: any[],
  existingIds: Set<string>,
): Promise<TranscriptRecord[]> {
  const records: TranscriptRecord[] = []
  for (const raw of legacy) {
    if (!raw || typeof raw.id !== 'string' || !raw.id || existingIds.has(raw.id)) continue
    const lines = Array.isArray(raw.subtitles)
      ? raw.subtitles.map(normalizeLine).filter((line: TranscriptLine | null): line is TranscriptLine => !!line)
      : []
    const startedAt = toNumber(raw.startedAt, Date.now())
    const endedAt = toNumber(raw.endedAt, startedAt)
    const record: TranscriptRecord = {
      id: raw.id,
      tabId: -1,
      generation: 0,
      pageTitle: typeof raw.pageTitle === 'string' ? raw.pageTitle.slice(0, 300) : '',
      url: typeof raw.url === 'string' ? raw.url.slice(0, 2048) : '',
      startedAt,
      endedAt,
      sourceLang: typeof raw.sourceLang === 'string' ? raw.sourceLang : 'auto',
      targetLang: typeof raw.targetLang === 'string' ? raw.targetLang : 'zh',
      subtitleCount: Math.max(lines.length, Math.floor(toNumber(raw.subtitleCount, lines.length))),
      chunkCount: Math.ceil(lines.length / TRANSCRIPT_CHUNK_SIZE),
      status: 'completed',
      lastAt: lines.length > 0 ? lines[lines.length - 1]!.at : endedAt,
    }
    for (let offset = 0; offset < lines.length; offset += TRANSCRIPT_CHUNK_SIZE) {
      const chunkIndex = Math.floor(offset / TRANSCRIPT_CHUNK_SIZE)
      await chrome.storage.local.set({
        [chunkKey(record.id, chunkIndex)]: lines.slice(offset, offset + TRANSCRIPT_CHUNK_SIZE),
      })
    }
    existingIds.add(record.id)
    records.push(record)
  }
  return records
}

/* ===== Active transcript writes ===== */

async function hydrateActive(record: TranscriptRecord): Promise<ActiveTranscript> {
  const chunkIndex = record.subtitleCount > 0
    ? Math.floor((record.subtitleCount - 1) / TRANSCRIPT_CHUNK_SIZE)
    : 0
  const key = chunkKey(record.id, chunkIndex)
  const got = await chrome.storage.local.get(key)
  const lines = Array.isArray(got[key])
    ? got[key].map(normalizeLine).filter((line: TranscriptLine | null): line is TranscriptLine => !!line)
    : []
  const entry: ActiveTranscript = {
    record,
    chunkIndex,
    lines,
    writing: false,
    pending: false,
    writePromise: null,
  }
  active.set(record.id, entry)
  return entry
}

/**
 * Repair a recording record whose index write may have lagged behind its
 * chunk write. Reads one chunk beyond the expected end to catch the rollover
 * window.
 */
async function repairRecord(record: TranscriptRecord): Promise<void> {
  if (record.status !== 'recording') return
  const expected = Math.max(
    1,
    record.chunkCount,
    Math.ceil(record.subtitleCount / TRANSCRIPT_CHUNK_SIZE),
  )
  const maxChunk = expected + 1
  const keys = Array.from({ length: maxChunk }, (_, index) => chunkKey(record.id, index))
  const got = await chrome.storage.local.get(keys)
  let subtitleCount = 0
  let chunkCount = 0
  let lastAt = record.lastAt
  for (let index = 0; index < maxChunk; index += 1) {
    const chunk = got[keys[index]]
    if (!Array.isArray(chunk) || chunk.length === 0) continue
    subtitleCount += chunk.length
    chunkCount = index + 1
    const last = chunk[chunk.length - 1]
    if (last && typeof last.at === 'number' && Number.isFinite(last.at)) {
      lastAt = Math.max(lastAt, last.at)
    }
  }
  if (subtitleCount !== record.subtitleCount || chunkCount !== record.chunkCount) {
    record.subtitleCount = subtitleCount
    record.chunkCount = chunkCount
    record.lastAt = lastAt
    await persistRecord(record)
  }
}

async function flushActive(recordId: string): Promise<void> {
  const entry = active.get(recordId)
  if (!entry) return
  if (entry.writing) {
    entry.pending = true
    if (entry.writePromise) await entry.writePromise
    return
  }

  entry.writing = true
  const run = (async () => {
    try {
      do {
        entry.pending = false
        const key = chunkKey(recordId, entry.chunkIndex)
        const lines = entry.lines.slice()
        if (lines.length > 0) {
          await chrome.storage.local.set({ [key]: lines })
          entry.record.chunkCount = Math.max(entry.record.chunkCount, entry.chunkIndex + 1)
        }
        await persistRecord(entry.record)
      } while (entry.pending)
    } catch (err) {
      console.warn('[RTTS] transcript chunk write failed:', err)
    }
  })()

  entry.writePromise = run
  await run
  entry.writing = false
  entry.writePromise = null
}

async function appendNow(recordId: string, line: TranscriptLine): Promise<void> {
  let entry = active.get(recordId)
  if (!entry) {
    const records = await getIndex()
    const record = records.find((item) => item.id === recordId)
    if (!record || record.status !== 'recording') return
    entry = await hydrateActive(record)
  }

  const nextChunk = Math.floor(entry.record.subtitleCount / TRANSCRIPT_CHUNK_SIZE)
  if (nextChunk !== entry.chunkIndex) {
    // The old chunk must reach storage before its buffer is replaced.
    await flushActive(recordId)
    entry.chunkIndex = nextChunk
    entry.lines = []
  }

  entry.lines.push(line)
  entry.record.subtitleCount += 1
  entry.record.lastAt = line.at || Date.now()
  entry.record.chunkCount = Math.max(entry.record.chunkCount, entry.chunkIndex + 1)
  void flushActive(recordId)
}

/* ===== Public lifecycle ===== */

async function beginNow(input: BeginTranscriptInput): Promise<TranscriptRecord> {
  const records = await getIndex()
  const existing = records.find(
    (record) =>
      record.status === 'recording' &&
      record.tabId === input.tabId &&
      record.generation === input.generation,
  )
  if (existing) return existing

  // A recording that was never finalized (missed CAPTURE_ENDED) must not
  // absorb the new session's lines.
  for (const stale of records.filter(
    (record) => record.status === 'recording' && record.tabId === input.tabId,
  )) {
    await finalizeTranscript(stale.id)
  }

  const now = input.startedAt ?? Date.now()
  const record: TranscriptRecord = {
    id: `tr_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    tabId: input.tabId,
    generation: input.generation,
    pageTitle: (input.pageTitle || '').slice(0, 300),
    url: (input.url || '').slice(0, 2048),
    startedAt: now,
    endedAt: null,
    sourceLang: input.sourceLang || 'auto',
    targetLang: input.targetLang || 'zh',
    subtitleCount: 0,
    chunkCount: 0,
    status: 'recording',
    lastAt: now,
  }

  records.unshift(record)
  active.set(record.id, {
    record,
    chunkIndex: 0,
    lines: [],
    writing: false,
    pending: false,
    writePromise: null,
  })

  const evicted = pruneCompleted(records)
  await writeIndexNow(records)
  if (evicted.length > 0) await removeChunks(evicted)
  return record
}

/** Idempotent for one `(tabId, generation)` pair. */
export function beginTranscript(input: BeginTranscriptInput): Promise<TranscriptRecord> {
  const key = `${input.tabId}:${input.generation}`
  const pending = beginAttempts.get(key)
  if (pending) return pending
  const run = beginNow(input).finally(() => {
    if (beginAttempts.get(key) === run) beginAttempts.delete(key)
  })
  beginAttempts.set(key, run)
  return run
}

/** Create the record lazily if START could not create it. */
export async function ensureTranscript(
  session: TranscriptSessionLike,
  meta: TranscriptMeta = {},
): Promise<string | null> {
  if (session.transcriptId) return session.transcriptId
  try {
    const record = await beginTranscript({
      tabId: session.tabId,
      generation: session.generation,
      sourceLang: meta.sourceLang || session.sourceLang,
      targetLang: meta.targetLang || session.targetLang,
      pageTitle: meta.pageTitle,
      url: meta.url,
      startedAt: meta.startedAt,
    })
    session.transcriptId = record.id
    return record.id
  } catch (err) {
    console.warn('[RTTS] transcript creation failed:', err)
    return null
  }
}

/** Append one final subtitle. Ordering is serialized per transcript. */
export function appendTranscriptLine(
  recordId: string,
  line: TranscriptLine,
): Promise<void> {
  if (!recordId) return Promise.resolve()
  const previous = appendQueues.get(recordId) || Promise.resolve()
  const next = previous
    .then(() => appendNow(recordId, line))
    .catch((err) => {
      console.warn('[RTTS] transcript append failed:', err)
    })
  appendQueues.set(recordId, next)
  void next.finally(() => {
    if (appendQueues.get(recordId) === next) appendQueues.delete(recordId)
  })
  return next
}

function pruneCompleted(records: TranscriptRecord[]): TranscriptRecord[] {
  const completed = records.filter((record) => record.status === 'completed')
  if (completed.length <= MAX_COMPLETED_TRANSCRIPTS) return []
  const keep = new Set(
    [...completed]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_COMPLETED_TRANSCRIPTS)
      .map((record) => record.id),
  )
  const evicted = completed.filter((record) => !keep.has(record.id))
  for (const record of evicted) {
    const index = records.indexOf(record)
    if (index >= 0) records.splice(index, 1)
  }
  return evicted
}

async function deleteRecord(record: TranscriptRecord): Promise<void> {
  active.delete(record.id)
  const records = await getIndex()
  const index = records.indexOf(record)
  if (index >= 0) records.splice(index, 1)
  await removeChunks([record])
  await writeIndexNow(records)
}

/**
 * Finalize a transcript and return whether a non-empty record remains.
 * Empty sessions are removed from history.
 */
export async function finalizeTranscript(recordId: string): Promise<boolean> {
  if (!recordId) return false

  const pending = appendQueues.get(recordId)
  if (pending) await pending.catch(() => {})

  const records = await getIndex()
  const record = records.find((item) => item.id === recordId)
  if (!record) {
    active.delete(recordId)
    return false
  }
  if (record.status === 'completed') return record.subtitleCount > 0

  const entry = active.get(recordId)
  if (entry) {
    await flushActive(recordId)
    active.delete(recordId)
  } else {
    // A restart may leave the index behind the last chunk write.
    await repairRecord(record)
  }

  if (record.subtitleCount === 0) {
    await deleteRecord(record)
    return false
  }

  record.status = 'completed'
  record.endedAt = Date.now()
  record.lastAt = record.lastAt || record.endedAt
  // Enforce the cap at finalization too: pruning only on the next begin
  // would briefly leave 101 completed records after the last one closes.
  const evicted = pruneCompleted(records)
  await writeIndexNow(records)
  if (evicted.length > 0) await removeChunks(evicted)
  return true
}

/** Finalize the current tab's transcript, if any. */
export async function finalizeSessionTranscript(
  session: TranscriptSessionLike & { subtitles: TranscriptLine[] },
): Promise<boolean> {
  let recordId = session.transcriptId
  if (!recordId) {
    // Legacy session that predates ADR-031: persist the visible window rather
    // than silently producing no history.
    if (!Array.isArray(session.subtitles) || session.subtitles.length === 0) return false
    const record = await beginTranscript({
      tabId: session.tabId,
      generation: session.generation,
      sourceLang: session.sourceLang,
      targetLang: session.targetLang,
    })
    recordId = record.id
    session.transcriptId = recordId
    for (const subtitle of session.subtitles) {
      await appendTranscriptLine(recordId, subtitle)
    }
  }
  const kept = await finalizeTranscript(recordId)
  if (!kept) session.transcriptId = null
  return kept
}

/* ===== Reads ===== */

export async function listTranscripts(): Promise<TranscriptSummary[]> {
  const records = await getIndex()
  return records.map(toSummary)
}

export async function getTranscriptRecord(id: string): Promise<TranscriptRecord | null> {
  const records = await getIndex()
  return records.find((record) => record.id === id) ?? null
}

export async function findLatestTranscriptIdForTab(tabId: number): Promise<string | null> {
  const records = await getIndex()
  const record = [...records]
    .sort((a, b) => b.startedAt - a.startedAt)
    .find((item) => item.tabId === tabId)
  return record?.id ?? null
}

export async function readTranscript(id: string): Promise<TranscriptLine[]> {
  if (!id) return []
  // Include appends that resolved but whose chunk flush is still queued.
  const pending = appendQueues.get(id)
  if (pending) await pending.catch(() => {})
  await flushActive(id)
  const record = await getTranscriptRecord(id)
  if (!record) return []
  const keys = chunkKeys(record)
  if (keys.length === 0) return []
  const got = await chrome.storage.local.get(keys)
  const lines: TranscriptLine[] = []
  for (const key of keys) {
    const chunk = got[key]
    if (!Array.isArray(chunk)) continue
    for (const raw of chunk) {
      const line = normalizeLine(raw)
      if (line) lines.push(line)
    }
  }
  return lines
}

export async function readTranscriptForTab(tabId: number): Promise<TranscriptLine[]> {
  const id = await findLatestTranscriptIdForTab(tabId)
  return id ? readTranscript(id) : []
}

/* ===== Deletion ===== */

export async function deleteTranscripts(
  ids: string[],
): Promise<{ deleted: number; skipped: number }> {
  const records = await getIndex()
  const wanted = new Set(ids.filter(Boolean))
  const removable = records.filter(
    (record) => wanted.has(record.id) && record.status !== 'recording',
  )
  const skipped = records.filter(
    (record) => wanted.has(record.id) && record.status === 'recording',
  ).length
  if (removable.length === 0) return { deleted: 0, skipped }

  await removeChunks(removable)
  for (const record of removable) {
    active.delete(record.id)
    const index = records.indexOf(record)
    if (index >= 0) records.splice(index, 1)
  }
  await writeIndexNow(records)
  return { deleted: removable.length, skipped }
}

export async function clearTranscripts(): Promise<{ deleted: number; skipped: number }> {
  const records = await getIndex()
  const removable = records.filter((record) => record.status !== 'recording')
  const skipped = records.length - removable.length
  if (removable.length === 0) return { deleted: 0, skipped }

  await removeChunks(removable)
  for (const record of removable) {
    active.delete(record.id)
    const index = records.indexOf(record)
    if (index >= 0) records.splice(index, 1)
  }
  await writeIndexNow(records)
  return { deleted: removable.length, skipped }
}

/* ===== Recovery ===== */

/**
 * Reconcile recording records after a service-worker restart.
 *
 * Returns the recording transcript ids that still have a live capture, keyed
 * by tab. Callers attach those ids to the recovered `SessionState` objects.
 */
export async function recoverTranscripts(
  liveGenerations: Record<string, number> = {},
): Promise<Map<number, string>> {
  const records = await getIndex()
  const liveByTab = new Map<number, string>()
  const now = Date.now()

  for (const record of [...records]) {
    if (record.status !== 'recording') continue
    const live = liveGenerations[String(record.tabId)]
    if (typeof live === 'number' && live === record.generation) {
      await repairRecord(record)
      await hydrateActive(record)
      liveByTab.set(record.tabId, record.id)
      continue
    }

    // No live capture: keep the persisted prefix, close the record.
    await repairRecord(record)
    if (record.subtitleCount === 0) {
      await deleteRecord(record)
      continue
    }
    record.status = 'completed'
    record.endedAt = record.lastAt || now
    await persistRecord(record)
  }

  const evicted = pruneCompleted(records)
  if (evicted.length > 0) {
    await writeIndexNow(records)
    await removeChunks(evicted)
  }

  return liveByTab
}

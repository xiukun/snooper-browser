import { legacySourceRef } from '../../lib/video-key'
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

import type { SourceRef } from '../../lib/knowledge-types'
import { sortByStart } from '../../lib/subtitle-order'

export const TRANSCRIPT_INDEX_KEY = 'snooper.extension.transcripts.v1'
export const TRANSCRIPT_CHUNK_PREFIX = 'snooper.extension.transcript.v1.'
export const LEGACY_HISTORY_KEY = 'snooper.extension.history.v1'

/** Rows per storage chunk. Also the maximum size of a single chunk write. */
export const TRANSCRIPT_CHUNK_SIZE = 200
/** Failed writes stay in memory until retried; capture stops before this limit. */
export const MAX_PENDING_TRANSCRIPT_LINES = 200

export type TranscriptStatus = 'recording' | 'completed'

export interface TranscriptLine {
  id?: string
  kind?: 'screen'
  sourceRef?: SourceRef
  at: number
  endedAt: number | null
  /** Video-timeline position (seconds) for `at` (ADR-033). */
  videoTime?: number | null
  source: string
  target: string
  latency: number
}

export interface TranscriptRecord {
  sourceEpoch?: string
  sourceRef?: SourceRef
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
  sourceEpoch?: string
  sourceRef?: SourceRef
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
  sourceEpoch?: string
  sourceRef?: SourceRef
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
  sourceEpoch?: string
  sourceRef?: SourceRef
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
    ...(raw.kind === 'screen' ? { kind: 'screen' as const } : {}),
    ...(raw.sourceRef && typeof raw.sourceRef === 'object' ? { sourceRef: raw.sourceRef } : {}),
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
    sourceEpoch: typeof raw.sourceEpoch === 'string' ? raw.sourceEpoch : undefined,
    sourceRef: raw.sourceRef || legacySourceRef(raw.url || '', raw.pageTitle || '', raw.id),
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
    sourceEpoch: record.sourceEpoch,
    sourceRef: record.sourceRef,
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

const DELETE_JOURNAL_KEY = 'snooper.extension.transcript-deletions.v1'
const pending = new Map<string, TranscriptLine[]>()
const knownIds = new Map<string, Set<string>>()
let queue: Promise<unknown> = Promise.resolve()

/** Failures unlock the queue but remain rejected for the original caller. */
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => {}).then(operation)
  queue = run.catch(() => {})
  return run
}
function chunkKey(id: string, index: number): string {
  return `${TRANSCRIPT_CHUNK_PREFIX}${id}.${index}`
}
function chunkKeys(record: TranscriptRecord): string[] {
  return Array.from({ length: record.chunkCount }, (_, i) => chunkKey(record.id, i))
}
function normalizeChunk(raw: unknown, id: string, index: number, sourceRef?: SourceRef): TranscriptLine[] {
  if (!Array.isArray(raw)) throw new Error(`转写正文缺块：${id} / ${index}，请重试或导出可用内容`)
  return raw.flatMap((value, offset) => {
    const line = normalizeLine(value)
    return line ? [{ ...line, sourceRef: line.sourceRef || sourceRef || legacySourceRef('', '', id), id: line.id || `${id}:${index}:${offset}` }] : []
  })
}
async function writeIndex(records: TranscriptRecord[]): Promise<void> {
  await chrome.storage.local.set({ [TRANSCRIPT_INDEX_KEY]: records })
}
async function loadIndex(): Promise<TranscriptRecord[]> {
  const got = await chrome.storage.local.get([TRANSCRIPT_INDEX_KEY, LEGACY_HISTORY_KEY, DELETE_JOURNAL_KEY])
  let records = normalizeIndex(got[TRANSCRIPT_INDEX_KEY])
  const deleting = normalizeIndex(got[DELETE_JOURNAL_KEY])
  if (deleting.length) {
    // The journal makes deletion retryable across worker restarts, including
    // a crash between deleting bodies and updating the index.
    await chrome.storage.local.remove(deleting.flatMap(chunkKeys))
    records = records.filter(r => !deleting.some(d => d.id === r.id))
    await writeIndex(records)
    await chrome.storage.local.remove(DELETE_JOURNAL_KEY)
  }
  const legacy = got[LEGACY_HISTORY_KEY]
  if (Array.isArray(legacy)) {
    for (const raw of legacy) {
      if (!raw?.id || records.some(r => r.id === raw.id)) continue
      const lines = Array.isArray(raw.subtitles) ? raw.subtitles.map(normalizeLine).filter(Boolean) as TranscriptLine[] : []
      const count = lines.length || (Array.isArray(raw.subtitles) ? 0 : Math.max(0, toNumber(raw.subtitleCount)))
      const record = normalizeRecord({ ...raw, tabId: -1, status: 'completed', subtitleCount: count, chunkCount: Math.ceil(count / TRANSCRIPT_CHUNK_SIZE) })!
      for (let i = 0; i < Math.ceil(lines.length / TRANSCRIPT_CHUNK_SIZE); i++) {
        await chrome.storage.local.set({ [chunkKey(record.id, i)]: lines.slice(i * TRANSCRIPT_CHUNK_SIZE, (i + 1) * TRANSCRIPT_CHUNK_SIZE) })
      }
      records.push(record)
    }
    await writeIndex(records)
    await chrome.storage.local.remove(LEGACY_HISTORY_KEY)
  }
  return records.sort((a, b) => b.startedAt - a.startedAt)
}
async function repair(record: TranscriptRecord, records: TranscriptRecord[]): Promise<void> {
  if (record.status !== 'recording') return
  const keys = Array.from({ length: Math.max(1, record.chunkCount) + 1 }, (_, i) => chunkKey(record.id, i))
  const got = await chrome.storage.local.get(keys)
  let count = 0
  let chunks = 0
  let lastAt = record.lastAt
  for (let i = 0; i < keys.length; i++) {
    if (got[keys[i]!] === undefined && i >= record.chunkCount) break
    const lines = normalizeChunk(got[keys[i]!], record.id, i, record.sourceRef)
    if (!lines.length) break
    count += lines.length
    chunks++
    for (const line of lines) lastAt = Math.max(lastAt, line.at)
  }
  if (count !== record.subtitleCount || chunks !== record.chunkCount) {
    Object.assign(record, { subtitleCount: count, chunkCount: chunks, lastAt })
    await writeIndex(records)
  }
}
async function readBody(record: TranscriptRecord): Promise<TranscriptLine[]> {
  const got = await chrome.storage.local.get(chunkKeys(record))
  return chunkKeys(record).flatMap((key, i) => normalizeChunk(got[key], record.id, i, record.sourceRef))
}
async function flushNow(id: string): Promise<void> {
  const waiting = pending.get(id)
  if (!waiting?.length) return
  const records = await loadIndex()
  const record = records.find(r => r.id === id)
  if (!record) throw new Error('转写记录不存在，未保存内容仍可导出')
  if (record.status === 'completed') { pending.delete(id); return }
  let seen = knownIds.get(id)
  if (!seen) {
    await repair(record, records)
    seen = new Set((await readBody(record)).map(l => l.id!))
    knownIds.set(id, seen)
  }
  while (waiting.length) {
    const line = waiting[0]!
    if (line.id && seen.has(line.id)) { waiting.shift(); continue }
    const chunkIndex = Math.floor(record.subtitleCount / TRANSCRIPT_CHUNK_SIZE)
    const offset = record.subtitleCount % TRANSCRIPT_CHUNK_SIZE
    const key = chunkKey(id, chunkIndex)
    const got = offset ? await chrome.storage.local.get(key) : {}
    const lines = offset ? normalizeChunk(got[key], id, chunkIndex, record.sourceRef).slice(0, offset) : []
    const savedLine = { ...line, id: line.id || `${id}:${chunkIndex}:${offset}` }
    // Keep waiting[0] until BOTH body and index succeed. Retrying overwrites
    // the same chunk/offset after an index failure, never duplicates a row.
    await chrome.storage.local.set({ [key]: [...lines, savedLine] })
    const next = { ...record, subtitleCount: record.subtitleCount + 1, chunkCount: chunkIndex + 1, lastAt: Math.max(record.lastAt, line.at) }
    await writeIndex(records.map(r => r.id === id ? next : r))
    Object.assign(record, next)
    seen.add(savedLine.id)
    waiting.shift()
  }
  pending.delete(id)
}
async function deleteNow(ids: string[]): Promise<{ deleted: number; skipped: number }> {
  const records = await loadIndex()
  const selected = records.filter(r => ids.includes(r.id))
  const removable = selected.filter(r => r.status !== 'recording' || r.subtitleCount === 0)
  if (removable.length) {
    await chrome.storage.local.set({ [DELETE_JOURNAL_KEY]: removable })
    await chrome.storage.local.remove(removable.flatMap(chunkKeys))
    await writeIndex(records.filter(r => !removable.some(d => d.id === r.id)))
    await chrome.storage.local.remove(DELETE_JOURNAL_KEY)
    removable.forEach(r => { pending.delete(r.id); knownIds.delete(r.id) })
  }
  return { deleted: removable.length, skipped: selected.length - removable.length }
}
async function finalizeNow(id: string): Promise<boolean> {
  await flushNow(id)
  const records = await loadIndex()
  const record = records.find(r => r.id === id)
  if (!record) return false
  if (record.status === 'completed') return record.subtitleCount > 0
  await repair(record, records)
  if (!record.subtitleCount) { await deleteNow([id]); return false }
  await writeIndex(records.map(r => r.id === id ? { ...r, status: 'completed', endedAt: Date.now() } : r))
  knownIds.delete(id)
  return true
}
/** Idempotent for a capture generation + lesson epoch; failed creates are never cached. */
export function beginTranscript(input: BeginTranscriptInput): Promise<TranscriptRecord> {
  return serial(async () => {
    let records = await loadIndex()
    const existing = records.find(r => r.status === 'recording' && r.tabId === input.tabId && r.generation === input.generation && r.sourceEpoch === input.sourceEpoch)
    if (existing) return existing
    for (const stale of records.filter(r => r.status === 'recording' && r.tabId === input.tabId && r.generation !== input.generation)) await finalizeNow(stale.id)
    records = await loadIndex()
    const now = input.startedAt ?? Date.now()
    const record = normalizeRecord({ ...input, id: `tr_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`, startedAt: now, status: 'recording' })!
    await writeIndex([record, ...records])
    return record
  })
}
export async function ensureTranscript(session: TranscriptSessionLike, meta: TranscriptMeta = {}): Promise<string> {
  if (session.transcriptId) return session.transcriptId
  const record = await beginTranscript({ ...session, pageTitle: session.sourceRef?.title, url: session.sourceRef?.url, ...meta })
  session.transcriptId = record.id
  return record.id
}
/** Retains a rejected row for explicit flush/retry; stable IDs make retries idempotent. */
export function appendTranscriptLine(id: string, line: TranscriptLine): Promise<void> {
  if (!id) return Promise.reject(new Error('缺少转写记录 ID'))
  const waiting = pending.get(id) || []
  if (!line.id || !waiting.some(l => l.id === line.id)) {
    if (waiting.length >= MAX_PENDING_TRANSCRIPT_LINES) return Promise.reject(new Error('未保存内容已达到缓存上限，请停止采集并重试或导出'))
    waiting.push(structuredClone(line))
    pending.set(id, waiting)
  }
  return serial(() => flushNow(id))
}
export function flushTranscript(id: string): Promise<void> { return serial(() => flushNow(id)) }
export function finalizeTranscript(id: string): Promise<boolean> { return serial(() => finalizeNow(id)) }
export async function finalizeSessionTranscript(session: TranscriptSessionLike & { subtitles: TranscriptLine[] }): Promise<boolean> {
  if (!session.transcriptId) {
    if (!session.subtitles.length) return false
    await ensureTranscript(session)
    for (const line of session.subtitles) await appendTranscriptLine(session.transcriptId!, line)
  }
  const kept = await finalizeTranscript(session.transcriptId!)
  if (!kept) session.transcriptId = null
  return kept
}
export function listTranscripts(): Promise<TranscriptSummary[]> { return serial(async () => (await loadIndex()).map(toSummary)) }
export function getTranscriptRecord(id: string): Promise<TranscriptRecord | null> { return serial(async () => (await loadIndex()).find(r => r.id === id) ?? null) }
export async function findLatestTranscriptIdForTab(tabId: number): Promise<string | null> {
  return serial(async () => (await loadIndex()).find(r => r.tabId === tabId)?.id ?? null)
}
export interface TranscriptPage {
  record: TranscriptRecord
  chunkIndex: number
  lines: TranscriptLine[]
  nextChunkIndex: number | null
}
/** Storage order, one chunk per call. IDs use persisted chunk/offset BEFORE sorting. Missing chunks reject. */
export function readTranscriptPage(id: string, chunkIndex: number): Promise<TranscriptPage> {
  return serial(async () => {
    const record = (await loadIndex()).find(r => r.id === id)
    if (!record) throw new Error('转写记录不存在')
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= Math.max(1, record.chunkCount)) throw new Error('无效的转写块索引')
    const key = chunkKey(id, chunkIndex)
    const got = record.chunkCount ? await chrome.storage.local.get(key) : {}
    return { record, chunkIndex, lines: record.chunkCount ? normalizeChunk(got[key], id, chunkIndex, record.sourceRef) : [], nextChunkIndex: chunkIndex + 1 < record.chunkCount ? chunkIndex + 1 : null }
  })
}
export function readTranscript(id: string): Promise<TranscriptLine[]> {
  return serial(async () => {
    await flushNow(id)
    const record = (await loadIndex()).find(r => r.id === id)
    return record ? sortByStart(await readBody(record)) : []
  })
}
/** Export rescue path: explicitly labels partial reads and includes failed in-memory writes. */
export function readAvailableTranscript(id: string): Promise<{ lines: TranscriptLine[]; complete: boolean; error?: string }> {
  return serial(async () => {
    let lines: TranscriptLine[] = []
    let error = ''
    try {
      const record = (await loadIndex()).find(r => r.id === id)
      if (!record) throw new Error('转写记录不存在，仅能导出当前可用内容')
      if (record) {
        for (let i = 0; i < record.chunkCount; i++) {
          try {
            const key = chunkKey(id, i)
            const got = await chrome.storage.local.get(key)
            lines.push(...normalizeChunk(got[key], id, i, record.sourceRef))
          } catch (err) { error = String(err) }
        }
      }
    } catch (err) { error = String(err) }
    const seen = new Set(lines.map(l => l.id))
    lines.push(...(pending.get(id) || []).filter(l => !l.id || !seen.has(l.id)))
    return { lines: sortByStart(lines), complete: !error, ...(error ? { error } : {}) }
  })
}
export async function readTranscriptForTab(tabId: number): Promise<TranscriptLine[]> {
  const id = await findLatestTranscriptIdForTab(tabId)
  return id ? readTranscript(id) : []
}
export function deleteTranscripts(ids: string[]): Promise<{ deleted: number; skipped: number }> {
  return serial(async () => {
    const records = await loadIndex()
    const protectedIds = new Set(records.filter(r => r.status === 'recording').map(r => r.id))
    const result = await deleteNow(ids.filter(id => !protectedIds.has(id)))
    return { ...result, skipped: ids.filter(id => protectedIds.has(id)).length }
  })
}
export async function clearTranscripts(): Promise<{ deleted: number; skipped: number }> {
  return deleteTranscripts((await listTranscripts()).map(r => r.id))
}
export function recoverTranscripts(liveGenerations: Record<string, number> = {}, pendingRecordIds: string[] = []): Promise<Map<number, string>> {
  return serial(async () => {
    const records = await loadIndex()
    const live = new Map<number, string>()
    for (const record of records.filter(r => r.status === 'recording')) {
      if (liveGenerations[String(record.tabId)] === record.generation || pendingRecordIds.includes(record.id)) {
        const current = await loadIndex()
        await repair(current.find(r => r.id === record.id)!, current)
        live.set(record.tabId, record.id)
      } else await finalizeNow(record.id)
    }
    return live
  })
}

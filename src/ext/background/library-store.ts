/** Saved references, confirmation snapshots and durable exact-scope deletion. */
import type { DeleteResult, DeleteSelection, DeleteSkipped, DeleteTarget, EntryRef, FavoriteEntry, LibraryEntry, SourceRef } from '../../lib/knowledge-types'
import type { NoteDocument, NoteEntry } from '../../lib/types'
import { refKey } from '../../lib/knowledge-search'
import { legacySourceRef } from '../../lib/video-key'
import { withLibraryOperation } from './library-queue'
import { notesUnderLibraryLock } from './notes-store'
import { deleteTranscripts, getTranscriptRecord, listTranscripts, readTranscriptPage, type TranscriptLine, type TranscriptRecord } from './transcript-store'
import { sessions, allSourceSessions } from './session-store'
import { openSource, type OpenSourceResult } from './source-opening'

export const FAVORITES_KEY = 'snooper.library.favorites.v1'
export const DELETIONS_KEY = 'snooper.library.deletions.v1'
const PREVIEW_PREFIX = 'snooper.library.delete-preview.v1.'
interface Preview {
  selection: DeleteSelection
  targets: DeleteTarget[]
  skipped: DeleteSkipped[]
  favorites: FavoriteEntry[]
  signature: string
  expiresAt: number
}
interface DeleteOperation extends DeleteResult { targets: DeleteTarget[]; createdAt: number }
export class LibraryError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
export function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 1024 }
export function validateRef(value: unknown): EntryRef {
  if (!value || typeof value !== 'object') throw new LibraryError('INVALID_INPUT', '条目引用无效')
  const ref = value as Record<string, unknown>
  if (ref.kind === 'transcript' && validId(ref.recordId) && validId(ref.lineId)) return { kind: 'transcript', recordId: ref.recordId, lineId: ref.lineId }
  if (ref.kind === 'note' && validId(ref.noteId) && validId(ref.entryId)) return { kind: 'note', noteId: ref.noteId, entryId: ref.entryId }
  throw new LibraryError('INVALID_INPUT', '条目引用无效')
}
function validateSelection(input: DeleteSelection): DeleteSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LibraryError('INVALID_INPUT', '删除范围无效')
  for (const values of [input.transcriptIds, input.noteIds]) if (values !== undefined && (!Array.isArray(values) || !values.every(validId))) throw new LibraryError('INVALID_INPUT', '删除 ID 无效')
  if (input.noteEntries !== undefined && (!Array.isArray(input.noteEntries) || !input.noteEntries.every(e => e && validId(e.noteId) && validId(e.entryId)))) throw new LibraryError('INVALID_INPUT', '笔记条目 ID 无效')
  return { transcriptIds: [...new Set(input.transcriptIds || [])].sort(), noteIds: [...new Set(input.noteIds || [])].sort(), noteEntries: [...new Map((input.noteEntries || []).map(e => [JSON.stringify([e.noteId, e.entryId]), { noteId: e.noteId, entryId: e.entryId }])).values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }
}
export function safeSource(source: SourceRef | undefined, url: string, title: string, fallback: string): SourceRef {
  if (source && typeof source.key === 'string' && typeof source.url === 'string' && typeof source.title === 'string' && ['exact', 'legacy', 'unknown'].includes(source.confidence)) return { key: source.key, url: source.url, title: source.title, confidence: source.confidence }
  return legacySourceRef(url, title, fallback)
}
export function transcriptEntry(record: TranscriptRecord, line: TranscriptLine): LibraryEntry {
  return { ref: { kind: 'transcript', recordId: record.id, lineId: line.id! }, sourceRef: safeSource(line.sourceRef || record.sourceRef, record.url, record.pageTitle, record.id), sourceEpoch: record.sourceEpoch, title: record.pageTitle, at: line.at, videoTime: line.videoTime ?? null, source: line.source, target: line.target, text: '', type: line.kind || 'subtitle' }
}
export function noteEntry(note: NoteDocument, entry: NoteEntry): LibraryEntry {
  return { ref: { kind: 'note', noteId: note.id, entryId: entry.id }, sourceRef: safeSource(entry.sourceRef, entry.videoUrl || '', note.title, note.id), title: note.title, at: entry.at, videoTime: entry.videoTime ?? null, source: entry.source || '', target: entry.target || '', text: entry.text || '', type: entry.type }
}
/** Internal reads require the shared outer lock; exports support bounded search. */
export async function favoritesUnderLibraryLock(): Promise<FavoriteEntry[]> {
  const raw = (await chrome.storage.local.get(FAVORITES_KEY))[FAVORITES_KEY]
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new LibraryError('STORAGE_ERROR', '收藏数据无法读取，请重试')
  return raw.map(item => ({ ref: validateRef(item.ref), createdAt: Number(item.createdAt) || 0 }))
}
async function operations(): Promise<DeleteOperation[]> {
  const value = (await chrome.storage.local.get(DELETIONS_KEY))[DELETIONS_KEY]
  if (value !== undefined && !Array.isArray(value)) throw new LibraryError('STORAGE_ERROR', '删除日志无法读取，请重试')
  return value || []
}
function affected(ref: EntryRef, target: DeleteTarget): boolean {
  return target.kind === 'transcript' ? ref.kind === 'transcript' && ref.recordId === target.recordId : ref.kind === 'note' && ref.noteId === target.noteId && target.entryIds.includes(ref.entryId)
}
async function assertAvailable(ref: EntryRef): Promise<void> {
  if ((await operations()).some(op => op.pending.some(p => affected(ref, p.target)))) throw new LibraryError('DELETE_PENDING', '条目正在删除，请完成或重试删除')
}
export function listFavorites(): Promise<FavoriteEntry[]> { return withLibraryOperation(favoritesUnderLibraryLock) }
async function resolveEntry(ref: EntryRef): Promise<{ entry: LibraryEntry; before: LibraryEntry[]; after: LibraryEntry[] }> {
  await assertAvailable(ref)
  if (ref.kind === 'note') {
    const note = (await notesUnderLibraryLock.list()).find(n => n.id === ref.noteId)
    const index = note?.entries.findIndex(e => e.id === ref.entryId) ?? -1
    if (!note || index < 0) throw new LibraryError('NOT_FOUND', '笔记条目不存在，请刷新资料库')
    return { entry: noteEntry(note, note.entries[index]!), before: note.entries.slice(Math.max(0,index-2),index).map(e=>noteEntry(note,e)), after: note.entries.slice(index+1,index+3).map(e=>noteEntry(note,e)) }
  }
  const record = await getTranscriptRecord(ref.recordId)
  if (!record) throw new LibraryError('NOT_FOUND', '转写条目不存在，请刷新资料库')
  // Context uses recording order, not lexical/hit order. Read only persisted
  // pages; never flush unsaved capture rows into a retrieval acknowledgement.
  const entries: LibraryEntry[] = []
  for (let i=0; i<record.chunkCount; i++) entries.push(...(await readTranscriptPage(record.id,i)).lines.map(line=>transcriptEntry(record,line)))
  entries.sort((a,b)=>a.at-b.at)
  const index = entries.findIndex(e=>refKey(e.ref)===refKey(ref))
  if (index<0) throw new LibraryError('NOT_FOUND', '转写条目不存在，请刷新资料库')
  return { entry: entries[index]!, before: entries.slice(Math.max(0,index-2),index), after: entries.slice(index+1,index+3) }
}
export function libraryContext(input: EntryRef): Promise<{ entry: LibraryEntry; before: LibraryEntry[]; after: LibraryEntry[]; source: SourceRef; favorite: boolean }> {
  return withLibraryOperation(async () => {
    const ref = validateRef(input)
    const result = await resolveEntry(ref)
    return { ...result, source: result.entry.sourceRef, favorite: (await favoritesUnderLibraryLock()).some(f=>refKey(f.ref)===refKey(ref)) }
  })
}
export function setFavorite(input: EntryRef, favorite: boolean): Promise<{ ref: EntryRef; favorite: boolean }> {
  return withLibraryOperation(async () => {
    const ref=validateRef(input)
    if(typeof favorite!=='boolean') throw new LibraryError('INVALID_INPUT','收藏状态无效')
    await resolveEntry(ref)
    const old=await favoritesUnderLibraryLock()
    const next=old.filter(f=>refKey(f.ref)!==refKey(ref))
    if(favorite) next.push(old.find(f=>refKey(f.ref)===refKey(ref)) || {ref,createdAt:Date.now()})
    await chrome.storage.local.set({[FAVORITES_KEY]:next})
    return {ref,favorite}
  })
}
async function preview(selection: DeleteSelection): Promise<Preview> {
  const records=await listTranscripts(), notes=await notesUnderLibraryLock.list()
  const targets: DeleteTarget[]=[], skipped: DeleteSkipped[]=[]
  for(const id of selection.transcriptIds || []) {
    const record=records.find(r=>r.id===id)
    if(!record || record.status==='recording') skipped.push({kind:'transcript',id,reason:record?'正在录制，已跳过':'记录不存在'})
    else targets.push({kind:'transcript',recordId:id})
  }
  const noteIds=[...new Set([...(selection.noteIds || []),...(selection.noteEntries || []).map(e=>e.noteId)])].sort()
  for(const id of noteIds) {
    const note=notes.find(n=>n.id===id)
    if(!note) {skipped.push({kind:'note',id,reason:'笔记不存在'});continue}
    const wholeDocument=!!selection.noteIds?.includes(id)
    const requested=selection.noteEntries?.filter(e=>e.noteId===id).map(e=>e.entryId) || []
    const entryIds=note.entries.filter(e=>wholeDocument || requested.includes(e.id)).map(e=>e.id).sort()
    for(const missing of requested.filter(e=>!entryIds.includes(e))) skipped.push({kind:'note',id:missing,reason:'笔记条目不存在'})
    if(wholeDocument || entryIds.length) targets.push({kind:'note',noteId:id,entryIds,wholeDocument})
  }
  const favorites=(await favoritesUnderLibraryLock()).filter(f=>targets.some(t=>affected(f.ref,t))).sort((a,b)=>refKey(a.ref).localeCompare(refKey(b.ref)))
  return {selection,targets,skipped,favorites,signature:JSON.stringify({targets,skipped,favorites}),expiresAt:Date.now()+10*60_000}
}
/** Bounded expendable session cache; never reads or removes source-body keys. */
export async function saveLibrarySessionCache<T extends { expiresAt: number }>(prefix: string, id: string, value: T): Promise<void> {
  const registryKey = `${prefix}index`
  const raw = (await chrome.storage.session.get(registryKey))[registryKey]
  const previous: { id: string; expiresAt: number }[] = Array.isArray(raw)
    ? raw.filter(item => item && typeof item.id === 'string' && /^[a-f\d-]{36}$/.test(item.id) && Number.isFinite(item.expiresAt)) : []
  const retained = previous.filter(item => item.id !== id && item.expiresAt > Date.now()).slice(-15)
  const expired = previous.filter(item => item.id !== id && !retained.some(kept => kept.id === item.id))
  if (expired.length) await chrome.storage.session.remove(expired.map(item => prefix + item.id))
  await chrome.storage.session.set({ [prefix + id]: value, [registryKey]: [...retained, { id, expiresAt: value.expiresAt }] })
}
export function prepareDelete(input: DeleteSelection): Promise<{ token: string; targets: DeleteTarget[]; favoriteCount: number; skipped: DeleteSkipped[]; expiresAt: number }> {
  return withLibraryOperation(async () => {
    const value=await preview(validateSelection(input)), token=crypto.randomUUID()
    await saveLibrarySessionCache(PREVIEW_PREFIX,token,value)
    return {token,targets:value.targets,favoriteCount:value.favorites.length,skipped:value.skipped,expiresAt:value.expiresAt}
  })
}
async function saveOperation(operation: DeleteOperation): Promise<void> {
  const all=await operations()
  await chrome.storage.local.set({[DELETIONS_KEY]:[...all.filter(o=>o.operationId!==operation.operationId),operation]})
}
async function execute(operation: DeleteOperation): Promise<DeleteResult> {
  for(const target of [...operation.pending.map(p=>p.target)]) {
    try {
      if(target.kind==='transcript') {
        const result=await deleteTranscripts([target.recordId])
        if(result.skipped) throw new Error('记录正在录制，尚未删除')
        if(await getTranscriptRecord(target.recordId)) throw new Error('转写删除尚未完成')
      } else await notesUnderLibraryLock.deleteSelection(target.noteId,target.entryIds,target.wholeDocument)
      // Body first. A failed reference write remains pending; queries resolve
      // the body again and cannot turn a dangling favorite into available text.
      const favorites=await favoritesUnderLibraryLock()
      await chrome.storage.local.set({[FAVORITES_KEY]:favorites.filter(f=>!affected(f.ref,target))})
      operation.pending=operation.pending.filter(p=>JSON.stringify(p.target)!==JSON.stringify(target))
      operation.completed.push(target)
    } catch(error) {
      const item=operation.pending.find(p=>JSON.stringify(p.target)===JSON.stringify(target))
      if(item) item.error=error instanceof Error ? error.message : String(error)
    }
    // If this fails, the original durable pending target still authorizes an
    // idempotent retry. Do not report an uncommitted completed status.
    try {await saveOperation(operation)} catch(error) {
      const durable=(await operations()).find(o=>o.operationId===operation.operationId)
      if(!durable) throw error
      return {operationId:durable.operationId,completed:durable.completed,pending:durable.pending.map(p=>({...p,error:'删除进度未能保存，请重试'})),skipped:durable.skipped}
    }
  }
  return {operationId:operation.operationId,completed:operation.completed,pending:operation.pending,skipped:operation.skipped}
}
export function confirmDelete(token: string): Promise<DeleteResult> {
  return withLibraryOperation(async () => {
    if(!validId(token)) throw new LibraryError('INVALID_INPUT','删除确认无效')
    const existing=(await operations()).find(o=>o.operationId===token)
    if(existing) return execute(existing)
    const saved=(await chrome.storage.session.get(PREVIEW_PREFIX+token))[PREVIEW_PREFIX+token] as Preview | undefined
    if(!saved || saved.expiresAt<Date.now()) throw new LibraryError('CONFIRMATION_STALE','删除确认已过期，请重新确认')
    if((await preview(saved.selection)).signature!==saved.signature) throw new LibraryError('CONFIRMATION_STALE','资料或收藏已变化，请重新确认删除范围')
    const operation: DeleteOperation={operationId:token,targets:saved.targets,createdAt:Date.now(),completed:[],pending:saved.targets.map(target=>({target,error:''})),skipped:saved.skipped}
    // Write authorization BEFORE any body changes. Recovery never re-expands IDs.
    await saveOperation(operation)
    await chrome.storage.session.remove(PREVIEW_PREFIX+token)
    return execute(operation)
  })
}
export function retryDelete(operationId: string): Promise<DeleteResult> {
  return withLibraryOperation(async () => {
    if(!validId(operationId)) throw new LibraryError('INVALID_INPUT','删除操作 ID 无效')
    const operation=(await operations()).find(o=>o.operationId===operationId)
    if(!operation) throw new LibraryError('NOT_FOUND','删除操作不存在，请刷新资料库')
    return execute(operation)
  })
}
export function recoverLibraryDeletions(): Promise<void> {
  return withLibraryOperation(async () => { for(const operation of await operations()) if(operation.pending.length) await execute(operation) })
}
export interface LibraryUsage {
  complete: boolean
  errors: { area: string; message: string }[]
  bytes: number | null
  transcriptCount: number | null
  noteCount: number | null
  noteEntryCount: number | null
  favoriteCount: number | null
  pendingWrites: { transcriptLines: number; sessions: number; noteMigration: boolean | null }
  pendingDeletes: DeleteResult[] | null
}
export function libraryUsage(): Promise<LibraryUsage> {
  return withLibraryOperation(async () => {
    const errors: LibraryUsage['errors'] = []
    async function stat<T>(area: string, read: () => Promise<T>): Promise<T | null> {
      try { return await read() }
      catch (error) { errors.push({ area, message: error instanceof Error ? error.message : String(error) }); return null }
    }
    // Read the outer journal independently: a persistent lower-level delete
    // failure must never hide the operation that the user needs to retry.
    const deletions = await stat('deletions', operations)
    const transcripts = await stat('transcripts', listTranscripts)
    const notes = await stat('notes', notesUnderLibraryLock.list)
    const favorites = await stat('favorites', favoritesUnderLibraryLock)
    const migration = await stat('noteMigration', async () => !!(await chrome.storage.local.get('snooper.notes.migration.v1'))['snooper.notes.migration.v1'])
    const pending = [...sessions.values()].flatMap(allSourceSessions).filter(s => s.pendingTranscriptLines?.length)
    const bytes = await stat('bytes', () => chrome.storage.local.getBytesInUse(null))
    return {
      complete: errors.length === 0, errors, bytes,
      transcriptCount: transcripts?.length ?? null,
      noteCount: notes?.length ?? null,
      noteEntryCount: notes ? notes.reduce((sum, note) => sum + note.entries.length, 0) : null,
      favoriteCount: favorites?.length ?? null,
      pendingWrites: { transcriptLines: pending.reduce((sum, s) => sum + s.pendingTranscriptLines.length, 0), sessions: pending.length, noteMigration: migration },
      pendingDeletes: deletions ? deletions.filter(o => o.pending.length).map(({ operationId, completed, pending, skipped }) => ({ operationId, completed, pending, skipped })) : null,
    }
  })
}
export function openLibrarySource(input: { ref?: EntryRef; recordId?: string; seconds?: number | null }, tabId?: number): Promise<OpenSourceResult & { degraded?: string }> {
  return withLibraryOperation(async () => {
    let source: SourceRef, seconds: number | null
    if(input.ref) {const result=await resolveEntry(validateRef(input.ref)); source=result.entry.sourceRef;seconds=result.entry.videoTime}
    else {
      if(!validId(input.recordId)) throw new LibraryError('INVALID_INPUT','缺少已保存的来源引用')
      const record=await getTranscriptRecord(input.recordId)
      if(!record) throw new LibraryError('NOT_FOUND','来源记录不存在')
      source=safeSource(record.sourceRef,record.url,record.pageTitle,record.id)
      if(input.seconds!=null && (typeof input.seconds!=='number' || !Number.isFinite(input.seconds) || input.seconds<0)) throw new LibraryError('INVALID_INPUT','来源时间无效')
      seconds=input.seconds ?? null
    }
    const result=await openSource(source,seconds,tabId)
    return {...result,...(source.confidence!=='exact' || seconds===null ? {degraded:'未保存可靠播放位置，已打开来源页面'} : {})}
  })
}

export async function deletingTargetsUnderLibraryLock(): Promise<DeleteTarget[]> {
  return (await operations()).flatMap(operation=>operation.pending.map(item=>item.target))
}
export function entryIsDeleting(ref: EntryRef, targets: DeleteTarget[]): boolean { return targets.some(target=>affected(ref,target)) }

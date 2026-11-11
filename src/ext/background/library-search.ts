/** Finite saved-body snapshots. Cursor state contains IDs/counts, never bodies. */
import type { LibrarySearchResult, LibraryScope, EntryRef } from '../../lib/knowledge-types'
import { highlightEntry, matchesQuery, refKey } from '../../lib/knowledge-search'
import { withLibraryOperation } from './library-queue'
import { notesUnderLibraryLock } from './notes-store'
import { listTranscripts, readTranscriptPage, TRANSCRIPT_CHUNK_SIZE } from './transcript-store'
import { deletingTargetsUnderLibraryLock, entryIsDeleting, favoritesUnderLibraryLock, LibraryError, noteEntry, transcriptEntry, saveLibrarySessionCache } from './library-store'

const PREFIX='snooper.library.search.v1.'
const WORK_UNITS=4
interface TranscriptScope extends LibraryScope {kind:'transcript'}
interface NoteScope extends LibraryScope {kind:'note';entryIds:string[];updatedAt:number}
interface Snapshot {
  query:string; favoritesOnly:boolean; favorites:string[]
  scopes:(TranscriptScope|NoteScope)[]
  scopeIndex:number; offset:number; scanned:number; step:number; changed:boolean; expiresAt:number
}
/** Chrome storage may reorder object properties; compare semantic fields only. */
function scopeSignature(scopes: (TranscriptScope | NoteScope)[]): string {
  return JSON.stringify(scopes.map(scope => scope.kind === 'note'
    ? [scope.kind, scope.id, scope.title, scope.count, scope.entryIds, scope.updatedAt]
    : [scope.kind, scope.id, scope.title, scope.count]))
}
function parseCursor(cursor:unknown):{id:string;step:number} {
  if(typeof cursor!=='string') throw new LibraryError('INVALID_INPUT','查询游标必须是文本')
  const match=/^([a-f\d-]{36}):(\d+)$/.exec(cursor)
  if(!match) throw new LibraryError('CURSOR_EXPIRED','查询游标无效或过期，请重新查询')
  return {id:match[1]!,step:Number(match[2])}
}
export function cancelSearch(cursor:string):Promise<void> {
  return withLibraryOperation(async()=>{const {id}=parseCursor(cursor);await chrome.storage.session.remove(PREFIX+id)})
}
export function searchLibrary(input:{query:string;favoritesOnly:boolean;cursor?:string}):Promise<LibrarySearchResult> {
  return withLibraryOperation(async()=>{
    if(!input || typeof input.query!=='string' || typeof input.favoritesOnly!=='boolean' || (input.cursor!==undefined && typeof input.cursor!=='string')) throw new LibraryError('INVALID_INPUT','查询参数无效')
    const query=input.query.trim()
    const records=await listTranscripts(), notes=await notesUnderLibraryLock.list()
    const favorites=(await favoritesUnderLibraryLock()).map(f=>refKey(f.ref)).sort()
    const deleting=await deletingTargetsUnderLibraryLock()
    const scopes:(TranscriptScope|NoteScope)[]=[...records.map(r=>({kind:'transcript' as const,id:r.id,title:r.pageTitle,count:r.subtitleCount})),...notes.map(n=>({kind:'note' as const,id:n.id,title:n.title,count:n.entries.length,entryIds:n.entries.map(e=>e.id),updatedAt:n.updatedAt}))]
    let id:string, state:Snapshot
    if(input.cursor) {
      const parsed=parseCursor(input.cursor);id=parsed.id
      state=(await chrome.storage.session.get(PREFIX+id))[PREFIX+id] as Snapshot
      if(!state || state.step!==parsed.step || state.expiresAt<Date.now()) throw new LibraryError('CURSOR_EXPIRED','查询已取消或游标过期，请重新查询')
      if(state.query!==query || state.favoritesOnly!==input.favoritesOnly) throw new LibraryError('CURSOR_MISMATCH','查询条件已变化，请重新查询')
      state.changed ||= scopeSignature(state.scopes)!==scopeSignature(scopes) || JSON.stringify(state.favorites)!==JSON.stringify(favorites)
    } else {
      id=crypto.randomUUID()
      state={query,favoritesOnly:input.favoritesOnly,favorites,scopes,scopeIndex:0,offset:0,scanned:0,step:0,changed:false,expiresAt:Date.now()+30*60_000}
    }
    const result:LibrarySearchResult={hits:[],cursor:null,complete:false,scanned:state.scanned,errors:[],changed:state.changed,scopes:state.scopes.map(({kind,id,title,count})=>({kind,id,title,count}))}
    if(!query) return {...result,complete:true}
    const favoriteSet=new Set(state.favorites)
    const include=(ref:EntryRef):boolean=>(!state.favoritesOnly || favoriteSet.has(refKey(ref))) && !entryIsDeleting(ref,deleting)
    for(let work=0;work<WORK_UNITS && state.scopeIndex<state.scopes.length;work++) {
      const scope=state.scopes[state.scopeIndex]!
      try {
        if(scope.kind==='transcript') {
          const current=records.find(r=>r.id===scope.id)
          if(!current || deleting.some(t=>t.kind==='transcript' && t.recordId===scope.id)) {state.changed=true;state.scopeIndex++;state.offset=0;continue}
          if(!scope.count) {state.scopeIndex++;state.offset=0;continue}
          const page=await readTranscriptPage(scope.id,Math.floor(state.offset/TRANSCRIPT_CHUNK_SIZE))
          const expected=Math.min(TRANSCRIPT_CHUNK_SIZE,scope.count-state.offset)
          if(page.lines.length<expected) throw new Error('转写正文不完整，请重试或导出可用内容')
          for(const line of page.lines.slice(0,expected)) {
            const entry=transcriptEntry(page.record,line)
            if(include(entry.ref) && matchesQuery(entry,query)) result.hits.push(highlightEntry({...entry,favorite:favoriteSet.has(refKey(entry.ref))},query))
          }
          state.scanned+=expected;state.offset+=expected
        } else {
          const note=notes.find(n=>n.id===scope.id)
          if(!note) {state.changed=true;state.scopeIndex++;state.offset=0;continue}
          const wanted=scope.entryIds.slice(state.offset,state.offset+TRANSCRIPT_CHUNK_SIZE)
          const byId=new Map(note.entries.map(e=>[e.id,e]))
          for(const entryId of wanted) {
            const value=byId.get(entryId)
            if(!value) {state.changed=true;state.offset++;continue}
            const entry=noteEntry(note,value)
            if(include(entry.ref) && matchesQuery(entry,query)) result.hits.push(highlightEntry({...entry,favorite:favoriteSet.has(refKey(entry.ref))},query))
            // Commit each consumed entry with its returned hit/count. If a
            // later entry is malformed, continuation starts at that entry.
            state.scanned++;state.offset++
          }
        }
        if(state.offset>=scope.count) {state.scopeIndex++;state.offset=0}
      } catch(error) {
        result.errors.push({kind:scope.kind,id:scope.id,message:error instanceof Error ? error.message : String(error)})
        break // Persist successful work; retry the failed page/entry next time.
      }
    }
    result.scanned=state.scanned;result.changed=state.changed
    result.complete=state.scopeIndex===state.scopes.length && !result.errors.length
    if(result.complete) await chrome.storage.session.remove(PREFIX+id)
    else {
      state.step++
      if(input.cursor) await chrome.storage.session.set({[PREFIX+id]:state})
      else await saveLibrarySessionCache(PREFIX,id,state)
      result.cursor=`${id}:${state.step}`
    }
    return result
  })
}

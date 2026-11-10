import assert from 'node:assert/strict'
import { harness, modules, noteEntry, recording } from './library-test-harness.mjs'
const h=harness(modules)
try {
let a=await h.load()
const ids=[]
for(let i=1;i<=150;i++) ids.push(await recording(a,i,i===1?451:1))
await a.notes.addNoteEntry({noteId:'n',entry:noteEntry('e','我的电脑',{imageUrl:'data:image/png;base64,SECRET_IMAGE'})})
async function collect(query,favoritesOnly=false) {
 let cursor, hits=[],scanned=0, batches=0,result
 do { result=await a.search.searchLibrary({query,favoritesOnly,cursor}); assert.deepEqual(result.errors,[]); hits.push(...result.hits); scanned=result.scanned; cursor=result.cursor; a=await h.load(); batches++; assert.ok(batches<300) } while(cursor)
 assert.equal(result.complete,true); assert.equal(new Set(hits.map(h=>JSON.stringify(h.ref))).size,hits.length)
 return {hits,scanned,batches}
}
const all=await collect('电脑')
assert.equal(all.hits.length,601)
assert.ok(all.batches>1)
for(const i of [0,199,200,450]) assert.ok(all.hits.some(h=>h.ref.recordId===ids[0]&&h.ref.lineId===`line-${i}`))
assert.equal((await collect('computer')).hits.length,600)
assert.equal((await collect('not present')).hits.length,0)
assert.equal(JSON.stringify(h.session).includes('SECRET_IMAGE'),false)
await a.library.setFavorite({kind:'transcript',recordId:ids[0],lineId:'line-0'},true)
await a.library.setFavorite({kind:'transcript',recordId:ids[0],lineId:'line-1'},true)
assert.equal((await collect('computer',true)).hits.length,2)
// Notes have independent text/source/target bodies and no per-document 200-row cap.
for(let i=0;i<451;i++) await a.notes.addNoteEntry({noteId:'long-note',entry:noteEntry(`n-${i}`,'',i===450?{target:'尾译文'}:{source:`note-source-${i}`})})
const noteSource=await collect('note-source')
assert.equal(noteSource.hits.length,450)
for(const i of [0,199,200]) assert.ok(noteSource.hits.some(h=>h.ref.entryId===`n-${i}`))
assert.equal((await collect('尾译文')).hits[0].ref.entryId,'n-450')
const scope=await a.search.searchLibrary({query:'',favoritesOnly:false})
assert.equal(scope.hits.length,0); assert.equal(scope.scopes.length,152)
let first=await a.search.searchLibrary({query:'电脑',favoritesOnly:false})
assert.equal(JSON.stringify(h.session).includes('SECRET_IMAGE'),false)
assert.equal(JSON.stringify(first).includes('SECRET_IMAGE'),false)
await a.search.cancelSearch(first.cursor)
await assert.rejects(a.search.searchLibrary({query:'电脑',favoritesOnly:false,cursor:first.cursor}),/过期|取消/)
first=await a.search.searchLibrary({query:'电脑',favoritesOnly:false})
let p=await a.library.prepareDelete({transcriptIds:[ids[100]]}); await a.library.confirmDelete(p.token)
let next=await a.search.searchLibrary({query:'电脑',favoritesOnly:false,cursor:first.cursor})
assert.equal(next.changed,true)
// Abandoned session cursors are bounded without changing any source bodies.
const abandoned=[]
for(let i=0;i<17;i++) abandoned.push((await a.search.searchLibrary({query:'电脑',favoritesOnly:false})).cursor)
await assert.rejects(a.search.searchLibrary({query:'电脑',favoritesOnly:false,cursor:abandoned[0]}),/过期|取消/)
assert.equal((await a.transcripts.listTranscripts()).length,149)
// A missing block is incomplete and resumable; restoring it never replays earlier hits.
const key=`${a.transcripts.TRANSCRIPT_CHUNK_PREFIX}${ids[0]}.1`, saved=h.local[key]
delete h.local[key]
let cursor,hits=[],result
for(let i=0;i<300;i++){ result=await a.search.searchLibrary({query:'电脑',favoritesOnly:false,cursor}); hits.push(...result.hits); cursor=result.cursor; if(result.errors.length)break; assert.ok(cursor) }
assert.equal(result.complete,false); assert.ok(cursor)
h.local[key]=saved
a=await h.load()
do { result=await a.search.searchLibrary({query:'电脑',favoritesOnly:false,cursor}); hits.push(...result.hits); cursor=result.cursor }while(cursor)
assert.equal(new Set(hits.map(h=>JSON.stringify(h.ref))).size,hits.length)
assert.ok(hits.some(h=>h.ref.lineId==='line-450'))
// Persist a live upper bound. Later growth must not restart or extend this query.
const live=await recording(a,999,451,false)
first=await a.search.searchLibrary({query:'电脑',favoritesOnly:false})
await a.transcripts.appendTranscriptLine(live,{id:'later',at:999,endedAt:null,source:'电脑',target:'',latency:0})
cursor=first.cursor; hits=[...first.hits]; let batches=0
while(cursor){result=await a.search.searchLibrary({query:'电脑',favoritesOnly:false,cursor});assert.equal(result.changed,true);hits.push(...result.hits);cursor=result.cursor;a=await h.load();assert.ok(++batches<300)}
assert.equal(hits.filter(h=>h.ref.recordId===live).length,451)
assert.equal(hits.some(h=>h.ref.lineId==='later'),false)
// Old count-only records are an incomplete source, not an empty successful scan.
for(const key of Object.keys(h.local)) delete h.local[key]
h.local[a.transcripts.LEGACY_HISTORY_KEY]=[{id:'count-only',subtitleCount:7,pageTitle:'legacy',startedAt:1}]
a=await h.load()
const missing=await a.search.searchLibrary({query:'电脑',favoritesOnly:false})
assert.equal(missing.complete,false);assert.equal(missing.errors.length,1);assert.ok(missing.cursor)
console.log('✅ library-search: 150 recordings, 451 rows, source/target/note coverage, restart per batch, missing-block retry, cancel/deletion and frozen live snapshot passed')
} finally {h.close()}
